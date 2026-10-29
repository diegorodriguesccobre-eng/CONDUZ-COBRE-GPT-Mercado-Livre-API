import worker from '../../src/worker';
import { GrantAuthority as Authority, GrantPartition as Partition } from '../../src/persistent-storage';
import { grantSchema } from '../../src/persistent-model';

const EXPECTED_ERRORS = new Set(['REVISION_CONFLICT', 'GRANT_FENCED', 'PARTITION_MISMATCH',
  'UNREGISTERED_PAIR', 'PROJECTION_CONFLICT', 'SYNTHETIC_PROJECTION_UNAVAILABLE',
  'SYNTHETIC_AFTER_DURABLE_revoked', 'SYNTHETIC_AFTER_DURABLE_grant-pending']);
async function managementResult(operation: () => Promise<unknown>) {
  try { return { ok: true as const, value: await operation() }; }
  catch (error) {
    if (error instanceof Error && EXPECTED_ERRORS.has(error.message)) return { ok: false as const, code: error.message };
    if (error instanceof Error && error.name === 'ZodError') return { ok: false as const, code: 'INVALID_INPUT' };
    throw error; // Unexpected runtime/transport failures never become expected administrative rejections.
  }
}

// Faults/restoration are privileged test RPC only. The HTTP handler remains the same /mcp boundary.
export class GrantAuthority extends Authority {
  private resume: (() => void) | undefined;
  private fault(): string | undefined { return this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM test_fault WHERE id=1').toArray()[0]?.value; }
  protected available(): void { if (this.fault() === 'unavailable') throw new Error('SYNTHETIC_AUTHORITY_UNAVAILABLE'); }
  protected async afterPersist(stage: string): Promise<void> {
    if (stage === 'grant-pending' && this.fault() === 'pause-pending') {
      await new Promise<void>(resolve => { this.resume = resolve; });
    }
    if (this.fault() === stage) throw new Error('SYNTHETIC_AFTER_DURABLE_' + stage);
  }
  release(): void { this.resume?.(); this.resume = undefined; }
  async localAdmin(operation: string, input: unknown) {
    // Avoid the pinned Miniflare Node proxy's rejected-promise decoding bug. The actual
    // mutation/error still runs in workerd; only known errors receive a typed envelope.
    if (operation === 'update') return managementResult(() => this.update(input));
    if (operation === 'revoke') return managementResult(() => this.revoke(input));
    if (operation === 'setOperator') return managementResult(() => this.setOperator(input));
    throw new Error('UNKNOWN_LOCAL_ADMIN_OPERATION');
  }
  async setFault(value: string): Promise<void> {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO test_fault VALUES(1,?)', value); await this.ctx.storage.sync();
  }
  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Authority>[1]) {
    super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_fault(id INTEGER PRIMARY KEY, value TEXT)');
  }
}
export class GrantPartition extends Partition {
  constructor(ctx: DurableObjectState, env: ConstructorParameters<typeof Partition>[1]) {
    super(ctx, env); ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS test_fault(id INTEGER PRIMARY KEY, value TEXT)');
  }
  protected available(operation: string): void {
    const fault = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM test_fault WHERE id=1').toArray()[0]?.value;
    if (fault === operation || fault === 'all') throw new Error('SYNTHETIC_PROJECTION_UNAVAILABLE');
  }
  async setFault(value: string): Promise<void> { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO test_fault VALUES(1,?)', value); await this.ctx.storage.sync(); }
  async localPut(input: unknown) { return managementResult(() => this.put(input)); }
  // Restore/tamper a projection only. No method can restore/overwrite authoritative tombstones.
  async restoreProjection(input: unknown): Promise<void> {
    const grant = grantSchema.parse(input);
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO grants VALUES(?,?)', grant.subject, JSON.stringify(grant));
    await this.ctx.storage.sync();
  }
  async removeProjection(subject: string): Promise<void> {
    this.ctx.storage.sql.exec('DELETE FROM grants WHERE subject=?', subject); await this.ctx.storage.sync();
  }
}
export default {
  fetch(request: Request, env: Parameters<typeof worker.fetch>[1]) {
    if (env.SYNTHETIC_POLICY !== 'persistent') return new Response(null, { status: 503 });
    return worker.fetch(request, env);
  }
};
