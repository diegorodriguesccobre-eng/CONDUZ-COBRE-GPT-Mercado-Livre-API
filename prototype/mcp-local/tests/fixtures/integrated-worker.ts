import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { SyntheticAccountVault } from '../../vault/storage';
import type { ReadHooks } from '../../vault/read-core';
import { createVaultExtension, integratedFetch } from '../../integration/composition';
import { reject, type IntegrationEnv, type ControlState } from '../../integration/contracts';
import { requestSchema } from '../../vault/model';
export { RecoveryGuardian, RecoveryReference, RecoveryData, RecoveryPartition } from '../../recovery/storage';
export { IntegrationIdentity } from '../../integration/identity';

const stateSchema = z.strictObject({ revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  registryFault: z.enum(['', 'swap', 'corrupt']), pauseAt: z.string().max(64),
  deadlineMs: z.number().int().min(100).max(15000), streamFault: z.enum(['', 'broken', 'infinite']) });
const eventSchema = z.strictObject({ phase: z.string().regex(/^[a-z-]{1,64}$/), operationId: z.string().uuid(),
  account: z.enum(['account-a', 'account-b']).optional(), seq: z.number().int().nonnegative().optional() });
// Privileged local driver control. No HTTP route or MCP tool reaches this class.
export class IntegrationControl extends DurableObject<IntegrationEnv> {
  private readonly waiting = new Map<string, { release(): void }>();
  constructor(ctx: DurableObjectState, env: IntegrationEnv) {
    super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS integration_control (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS integration_events (id INTEGER PRIMARY KEY,event TEXT NOT NULL)');
  }
  async snapshot(): Promise<ControlState> {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM integration_control WHERE key=?', 'state').toArray()[0];
    return stateSchema.parse(row ? JSON.parse(row.value) : { revision: 1, registryFault: '', pauseAt: '', deadlineMs: 15000, streamFault: '' });
  }
  async event(input: unknown) {
    const value = eventSchema.parse(input);
    this.ctx.storage.sql.exec('INSERT INTO integration_events(event) VALUES(?)', JSON.stringify(value));
    await this.ctx.storage.sync();
  }
  async barrier(input: { phase: string; operationId: string; account: 'account-a' | 'account-b'; deadlineAt: number }) {
    await this.event({ phase: input.phase, operationId: input.operationId, account: input.account });
    const s = await this.snapshot(); if (s.pauseAt !== input.phase) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        new Promise<void>(release => this.waiting.set(input.operationId, { release })),
        new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new Error('INTEGRATION_DEPENDENCY_UNAVAILABLE')), Math.max(1, input.deadlineAt - Date.now())); })
      ]);
    } finally { if (timer) clearTimeout(timer); this.waiting.delete(input.operationId); }
  }
  async fixture(input: { kind: string; value?: unknown }) {
    if (input.kind === 'configure') {
      const state = stateSchema.parse({ ...await this.snapshot(), ...z.record(z.string(), z.unknown()).parse(input.value) });
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO integration_control VALUES(?,?)', 'state', JSON.stringify(state));
      await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'release') { for (const v of this.waiting.values()) v.release(); return; }
    if (input.kind === 'events') return this.ctx.storage.sql.exec<{ event: string }>('SELECT event FROM integration_events ORDER BY id').toArray().map(r => JSON.parse(r.event));
    if (input.kind === 'waiting') return [...this.waiting.keys()];
    return reject('INTEGRATION_BINDING_DENIED');
  }
}

export class IntegratedVault extends SyntheticAccountVault {
  private readonly extension: ReturnType<typeof createVaultExtension>;
  constructor(ctx: DurableObjectState, env: IntegrationEnv) {
    let extension: ReturnType<typeof createVaultExtension>;
    super(ctx, env, (request: z.infer<typeof requestSchema>): ReadHooks | undefined => extension.hooks(request));
    extension = createVaultExtension(ctx, env); this.extension = extension;
  }
  override async execute(input: unknown): Promise<unknown> {
    return this.extension.execute(input, request => super.execute(request));
  }
  async assertPrepared(input: unknown) { return this.extension.assertPrepared(input); }
}

// New, strictly loopback-only synthetic fixture. No existing Worker or deployment target is modified.
export default { fetch: integratedFetch };
