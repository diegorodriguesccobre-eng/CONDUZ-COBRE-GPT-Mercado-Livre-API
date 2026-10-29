import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { grantSchema } from '../src/persistent-model';
import { canonical, fingerprint, fail, RecoveryError, stateSchema, headSchema, requestSchema,
  identitySchema, mutationSchema, recoveryPlanSchema, ENVIRONMENT, ENROLLMENT, accounts,
  nextState, type ReferenceHead, type SecurityState } from './model';

interface RecoveryEnv {
  RECOVERY_REFERENCE: DurableObjectNamespace<RecoveryReference>;
  RECOVERY_DATA: DurableObjectNamespace<RecoveryData>;
  RECOVERY_PARTITIONS: DurableObjectNamespace<RecoveryPartition>;
}
// Test-only SQLite stores. No deployment configuration or production class is changed.
class Store extends DurableObject<RecoveryEnv> {
  private resume: (() => void) | undefined;
  constructor(ctx: DurableObjectState, env: RecoveryEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS recovery_kv (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS recovery_events (id INTEGER PRIMARY KEY AUTOINCREMENT, event TEXT NOT NULL)');
  }
  protected get(key: string): unknown {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM recovery_kv WHERE key=?', key).toArray()[0];
    return row === undefined ? undefined : JSON.parse(row.value);
  }
  protected put(key: string, value: unknown): void {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO recovery_kv VALUES(?,?)', key, JSON.stringify(value));
  }
  protected event(event: Record<string, unknown>): void {
    this.ctx.storage.sql.exec('INSERT INTO recovery_events(event) VALUES(?)', JSON.stringify(event));
  }
  protected async durable(stage: string): Promise<void> {
    await this.ctx.storage.sync();
    if (this.get('fault') === `pause:${stage}`) await new Promise<void>(resolve => { this.resume = resolve; });
    if (this.get('fault') === stage) fail(`INJECTED_${stage}`);
  }
  protected available(): void {
    const f = this.get('fault');
    if (f === 'unavailable' || f === 'quota') fail(f === 'quota' ? 'QUOTA' : 'UNAVAILABLE');
    if (f === 'ECONNRESET' || f === 'timeout') throw new Error(String(f));
  }
  async rpc(method: string, input?: unknown): Promise<unknown> {
    try { return { ok: true, value: await this.dispatch(method, input) }; }
    catch (error) {
      if (error instanceof RecoveryError) return { ok: false, code: error.code };
      if (error instanceof z.ZodError || error instanceof SyntaxError) return { ok: false, code: 'CORRUPT_OR_INVALID' };
      throw error; // Unknown runtime/transport errors must remain errors, not expected rejections.
    }
  }
  protected async dispatch(_method: string, _input: unknown): Promise<unknown> { return fail('UNKNOWN_TEST_RPC'); }
  // Privileged injection is available only through local driver stubs, never HTTP/MCP.
  async fixture(input: { kind: string; key?: string; value?: unknown }): Promise<unknown> {
    if (input.kind === 'fault') { this.put('fault', input.value); await this.ctx.storage.sync(); return; }
    if (input.kind === 'release') { this.resume?.(); this.resume = undefined; return; }
    if (input.kind === 'dump') return { rows: this.ctx.storage.sql.exec<{ key: string; value: string }>('SELECT key,value FROM recovery_kv').toArray(), events: await this.events() };
    if (input.kind === 'restore') {
      const { rows, events } = input.value as { rows: { key: string; value: string }[]; events: Record<string, unknown>[] };
      this.ctx.storage.transactionSync(() => {
        this.ctx.storage.sql.exec('DELETE FROM recovery_kv');
        for (const row of rows) this.ctx.storage.sql.exec('INSERT INTO recovery_kv VALUES(?,?)', row.key, row.value);
        this.ctx.storage.sql.exec('DELETE FROM recovery_events'); for (const event of events) this.event(event);
      }); await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'corrupt') {
      this.ctx.storage.sql.exec('INSERT OR REPLACE INTO recovery_kv VALUES(?,?)', input.key!, '{invalid'); await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'set') { this.put(input.key!, input.value); await this.ctx.storage.sync(); return; }
    return fail('UNKNOWN_FIXTURE');
  }
  async events(): Promise<unknown[]> {
    return this.ctx.storage.sql.exec<{ event: string }>('SELECT event FROM recovery_events ORDER BY id').toArray().map(r => JSON.parse(r.event));
  }
}

export class RecoveryData extends Store {
  async view(): Promise<SecurityState> { this.available(); return stateSchema.parse(this.get('state')); }
  async install(input: unknown): Promise<void> {
    this.available(); const s = stateSchema.parse(input); this.put('state', s); await this.durable('data');
  }
}
export class RecoveryPartition extends Store {
  async read(pair: { account: string; subject: string }): Promise<unknown> {
    this.available(); if (this.get('account') !== pair.account) return null;
    return this.get(pair.subject) ?? null;
  }
  async install(input: unknown): Promise<void> {
    this.available(); const grant = grantSchema.parse(input);
    const account = this.get('account'); if (account !== undefined && account !== grant.account) fail('PARTITION_MISMATCH');
    this.ctx.storage.transactionSync(() => { this.put('account', grant.account); this.put(grant.subject, grant); });
    await this.durable('projection');
  }
}

export class RecoveryReference extends Store {
  private head(): ReferenceHead { this.available(); return headSchema.parse(this.get('head')); }
  private record(h: ReferenceHead, event: string): void {
    this.put('head', h); this.event({ event, sequence: h.state.seq, gateRevision: h.gateRevision, root: h.root });
  }
  async current(): Promise<ReferenceHead> {
    for (let attempt = 0; attempt < 4; attempt++) {
      const h = this.head(); const root = await fingerprint(h.state);
      if (root !== h.root) fail('REFERENCE_CORRUPT');
      const fresh = this.head();
      if (fresh.root === root && fresh.gateRevision === h.gateRevision) return fresh;
    }
    return fail('REFERENCE_BUSY');
  }
  async hold(reason: string): Promise<void> {
    this.ctx.storage.transactionSync(() => {
      const h = this.head();
      if (h.gate !== 'HOLD') {
        h.gate = 'HOLD'; h.gateRevision++; h.reason = reason.slice(0, 80); this.record(h, 'hold');
      }
    }); await this.durable('hold');
  }
  protected override async dispatch(method: string, input: unknown): Promise<unknown> {
    if (method === 'current') return this.current();
    if (method === 'decision') { const v = input as { request: unknown; view: unknown; projection: unknown }; return this.decide(v.request, v.view, v.projection); }
    if (method === 'enroll') {
      if (this.get('head') !== undefined) fail('ALREADY_ENROLLED');
      const s = stateSchema.parse(input); if (s.seq !== 0 || s.anchors.length) fail('UNSAFE_BOOTSTRAP');
      const root = await fingerprint(s);
      if (this.get('head') !== undefined) fail('ALREADY_ENROLLED');
      this.ctx.storage.transactionSync(() => this.record({ state: s, root, gate: 'HOLD', gateRevision: 1,
        reason: 'INITIAL_ENROLLMENT', pending: null, adminCount: 2 }, 'enrollment-simulated'));
      await this.durable('enroll'); return this.current();
    }
    if (method === 'begin') {
      const m = mutationSchema.parse(input); const payload = await fingerprint(m);
      const h = await this.current(); const previous = this.get('op:' + m.operationId) as { hash: string; confirmed: boolean } | undefined;
      if (previous) {
        if (previous.hash !== payload) fail('IDEMPOTENCY_CONFLICT');
        return { created: false, confirmed: previous.confirmed, head: h };
      }
      if (h.gate !== 'ACTIVE' || h.pending) fail('RECOVERY_REQUIRED');
      const target = nextState(h, m); const root = await fingerprint(target);
      this.ctx.storage.transactionSync(() => {
        const fresh = this.head(); if (fresh.state.seq !== h.state.seq || fresh.gateRevision !== h.gateRevision) fail('REVISION_CONFLICT');
        this.put('op:' + m.operationId, { hash: payload, confirmed: false, sequence: target.seq });
        this.record({ ...fresh, state: target, root, gate: 'PENDING', gateRevision: fresh.gateRevision + 1,
          reason: m.kind, pending: m.operationId }, m.kind === 'revoke' ? 'revocation-fenced' : 'mutation-fenced');
      }); await this.durable('fence'); return { created: true, confirmed: false, head: await this.current() };
    }
    if (method === 'finish') {
      const { operationId, state } = input as { operationId: string; state: unknown };
      const s = stateSchema.parse(state); const root = await fingerprint(s);
      this.ctx.storage.transactionSync(() => {
        const h = this.head(); if (h.pending !== operationId || h.gate !== 'PENDING' || root !== h.root) fail('REVISION_CONFLICT');
        const op = this.get('op:' + operationId) as { hash: string; confirmed: boolean };
        this.put('op:' + operationId, { ...op, confirmed: true });
        this.record({ ...h, gate: 'ACTIVE', gateRevision: h.gateRevision + 1, reason: '', pending: null }, 'mutation-confirmed');
      }); await this.durable('confirmed'); return this.current();
    }
    if (method === 'recoveryStart') {
      const p = recoveryPlanSchema.parse(input); const h = await this.current();
      if (p.expectedSeq !== h.state.seq || p.expectedGate !== h.gateRevision || p.root !== h.root) fail('REVISION_CONFLICT');
      if (h.adminCount !== 2 || p.approvals[0]!.person === p.approvals[1]!.person ||
          !p.approvals.some(a => a.person === 'sim-proposer' && a.role === 'proposer') ||
          !p.approvals.some(a => a.person === 'sim-reviewer' && a.role === 'reviewer') ||
          p.approvals.some(a => Date.now() - a.at > 300000 || a.at > Date.now() + 1000)) fail('SIMULATED_QUORUM_REQUIRED');
      if (this.get('used:' + p.nonce) || this.get('recovery:' + p.operationId)) fail('REPLAY');
      const planHash = await fingerprint(p);
      this.ctx.storage.transactionSync(() => {
        const fresh = this.head(); if (fresh.root !== h.root || fresh.gateRevision !== h.gateRevision) fail('REVISION_CONFLICT');
        this.put('used:' + p.nonce, true); this.put('recovery:' + p.operationId, { planHash, root: h.root, gateRevision: h.gateRevision + 1, expires: Math.min(...p.approvals.map(a => a.at + 300000)) });
        this.record({ ...fresh, gate: 'HOLD', gateRevision: h.gateRevision + 1, reason: 'RECONCILING' }, 'recovery-started-simulated');
      }); await this.durable('recovery-start'); return this.current();
    }
    if (method === 'recoveryFinish') {
      const { operationId, state } = input as { operationId: string; state: unknown };
      const root = await fingerprint(stateSchema.parse(state));
      this.ctx.storage.transactionSync(() => {
        const h = this.head(); const ticket = this.get('recovery:' + operationId) as { root: string; gateRevision: number; expires: number } | undefined;
        if (!ticket || ticket.expires <= Date.now() || h.reason !== 'RECONCILING' || ticket.root !== root || h.root !== root || h.gateRevision !== ticket.gateRevision) fail('REVISION_CONFLICT');
        if (h.pending) {
          const op = this.get('op:' + h.pending) as { hash: string; confirmed: boolean };
          this.put('op:' + h.pending, { ...op, confirmed: true });
        }
        this.put('recovery:' + operationId, { ...ticket, gateRevision: -1 });
        this.record({ ...h, gate: 'ACTIVE', gateRevision: h.gateRevision + 1, reason: '', pending: null }, 'recovery-completed-simulated');
      }); await this.durable('recovered'); return this.current();
    }
    if (method === 'status') { return this.get('op:' + z.string().uuid().parse(input)) ?? null; }
    return fail('UNKNOWN_TEST_RPC');
  }
  async decide(input: unknown, view: unknown, projection: unknown): Promise<{ nonce: string; permissions: string[]; root: string }> {
    const r = requestSchema.parse(input); const s = stateSchema.parse(view); const root = await fingerprint(s);
    let permissions: string[] = []; let mismatch = false;
    this.ctx.storage.transactionSync(() => {
      const h = this.head();
      // PENDING/HOLD is already a deny fence; an old view during a mutation is not corruption.
      if (h.gate !== 'ACTIVE' || h.pending) { this.event({ event: 'deny-fenced', account: r.account, subject: r.subject, sequence: h.state.seq }); return; }
      if (canonical(h.state) !== canonical(s) || h.root !== root) {
        h.gate = 'HOLD'; h.gateRevision++; h.reason = 'STATE_DIVERGENCE'; this.record(h, 'hold'); mismatch = true; return;
      }
      if (this.get('decision:' + r.nonce)) fail('REPLAY');
      if (h.gate === 'ACTIVE' && !h.pending) {
        const a = s.anchors.find(a => a.account === r.account && a.subject === r.subject);
        const o = s.operators.find(o => o.subject === r.subject);
        if (a?.status === 'active') {
          if (!projection || canonical(grantSchema.parse(projection)) !== canonical(a.grant)) {
            h.gate = 'HOLD'; h.gateRevision++; h.reason = 'PROJECTION_DIVERGENCE'; this.record(h, 'hold'); mismatch = true; return;
          }
          const g = a.grant!; const now = Date.now();
          if (o?.enabled && g.validFrom <= now && now < g.validUntil && g.permissions.includes(r.required)) permissions = [...g.permissions];
        }
      }
      this.put('decision:' + r.nonce, true);
      this.event({ event: permissions.length ? 'allow' : 'deny', account: r.account, subject: r.subject,
        permission: r.required, sequence: s.seq, root });
    });
    await this.durable('decision');
    const fresh = this.head();
    const selected = fresh.state.anchors.find(a => a.account === r.account && a.subject === r.subject)?.grant;
    if (mismatch || fresh.root !== root || fresh.gate !== 'ACTIVE' || fresh.pending || !selected || selected.validUntil <= Date.now() || selected.validFrom > Date.now()) permissions = [];
    return { nonce: r.nonce, permissions, root };
  }
}

export class RecoveryGuardian extends Store {
  private reference() { return this.env.RECOVERY_REFERENCE.get(this.env.RECOVERY_REFERENCE.idFromName('trusted-reference')); }
  private data() { return this.env.RECOVERY_DATA.get(this.env.RECOVERY_DATA.idFromName('restorable-authority')); }
  private partition(account: string) {
    if (!accounts.includes(account as typeof accounts[number])) fail('UNKNOWN_ACCOUNT');
    return this.env.RECOVERY_PARTITIONS.get(this.env.RECOVERY_PARTITIONS.idFromName(account));
  }
  private async rpcReference(method: string, input?: unknown): Promise<unknown> {
    const r = await this.reference().rpc(method, input) as { ok: boolean; value?: unknown; code?: string };
    if (!r.ok) fail(r.code!); return r.value;
  }
  private async block(mode: 'RECOVERY_REQUIRED' | 'UNAVAILABLE', reason: string): Promise<void> {
    // Separate durable deny latch survives loss of process memory; never auto-seeds identity.
    this.put('latch', { mode, reason }); this.event({ event: 'guardian-blocked', reason }); await this.ctx.storage.sync();
  }
  private async install(state: SecurityState): Promise<void> {
    await this.data().install(state);
    for (const a of state.anchors) if (a.status === 'active') await this.partition(a.account).install(a.grant);
  }
  async permissions(input: unknown, required = 'read'): Promise<string[]> {
    try {
      this.available();
      const r = requestSchema.parse({ ...(input as object), required: required ?? 'read', nonce: crypto.randomUUID(),
        environment: ENVIRONMENT, enrollment: ENROLLMENT, protocol: 1 });
      const identity = identitySchema.parse(this.get('identity'));
      const latch = this.get('latch') as { mode: string } | undefined;
      if (latch?.mode === 'RECOVERY_REQUIRED') return [];
      const h = await this.rpcReference('current') as ReferenceHead;
      if (h.state.seq < identity.lastSeq || (h.state.seq === identity.lastSeq && h.root !== identity.root)) {
        await this.reference().hold('REFERENCE_REGRESSION'); await this.block('RECOVERY_REQUIRED', 'REFERENCE_REGRESSION'); return [];
      }
      const view = await this.data().view(); const projection = await this.partition(r.account).read(r);
      const decision = await this.rpcReference('decision', { request: r, view, projection }) as { nonce: string; permissions: string[]; root: string };
      if (decision.nonce !== r.nonce) { await this.block('RECOVERY_REQUIRED', 'RESPONSE_BINDING'); return []; }
      const after = await this.rpcReference('current') as ReferenceHead;
      if (after.gate !== 'ACTIVE') { await this.block('RECOVERY_REQUIRED', after.reason); return []; }
      this.put('identity', { ...identity, lastSeq: after.state.seq, root: after.root, mode: 'READY' });
      this.put('latch', { mode: 'READY', reason: '' }); await this.durable('guardian');
      // Persistent READY is diagnostic only; this entire path repeats on every call.
      const selected = after.state.anchors.find(a => a.account === r.account && a.subject === r.subject)?.grant;
      if (!selected || selected.validUntil <= Date.now() || selected.validFrom > Date.now()) return [];
      return decision.permissions;
    } catch (error) {
      const unavailable = error instanceof RecoveryError && ['UNAVAILABLE', 'QUOTA'].includes(error.code);
      try { await this.block(unavailable ? 'UNAVAILABLE' : 'RECOVERY_REQUIRED', unavailable ? error.code : 'UNVERIFIED_STATE'); }
      catch { /* A broken disk cannot promise a new persistent record; no allow is returned. */ }
      if (!unavailable) { try { await this.reference().hold('UNVERIFIED_STATE'); } catch { /* Reference may itself be unavailable/corrupt. */ } }
      return [];
    }
  }
  protected override async dispatch(method: string, input: unknown): Promise<unknown> {
    if (method === 'inspect') {
      let identity: unknown; try { identity = this.get('identity'); } catch { identity = 'CORRUPT'; }
      return { identity, latch: this.get('latch') };
    }
    if (method === 'enrollReference') {
      if (this.get('identity') !== undefined || this.get('latch') !== undefined) fail('UNSAFE_BOOTSTRAP');
      return this.rpcReference('enroll', input);
    }
    if (method === 'mutate') {
      const m = mutationSchema.parse(input);
      const started = await this.rpcReference('begin', m) as { created: boolean; confirmed: boolean; head: ReferenceHead };
      if (!started.created) { if (started.confirmed) return started.head; return fail('RECOVERY_REQUIRED'); }
      await this.install(started.head.state);
      const confirmed = await this.rpcReference('finish', { operationId: m.operationId, state: started.head.state }) as ReferenceHead;
      const identity = identitySchema.parse(this.get('identity'));
      this.put('identity', { ...identity, lastSeq: confirmed.state.seq, root: confirmed.root }); await this.durable('ack');
      return confirmed;
    }
    if (method === 'recover') {
      const p = recoveryPlanSchema.parse(input);
      let checkpoint: ReturnType<typeof identitySchema.parse> | undefined;
      try { checkpoint = identitySchema.parse(this.get('identity')); } catch { /* Missing/corrupt G can only be reconstructed from the assumed-current W. */ }
      const observed = await this.rpcReference('current') as ReferenceHead;
      if (checkpoint && (observed.state.seq < checkpoint.lastSeq || (observed.state.seq === checkpoint.lastSeq && observed.root !== checkpoint.root))) fail('REFERENCE_REGRESSION');
      const h = await this.rpcReference('recoveryStart', p) as ReferenceHead;
      await this.install(h.state);
      // G identity is reconstructed only after the simulated quorum accepted a current plan.
      this.put('identity', { environment: ENVIRONMENT, enrollment: ENROLLMENT, protocol: 1,
        lastSeq: h.state.seq, root: h.root, mode: 'VERIFYING' }); await this.durable('identity');
      const view = await this.data().view();
      for (const a of view.anchors) if (a.status === 'active' && canonical(await this.partition(a.account).read(a)) !== canonical(a.grant)) fail('INCOMPLETE_RECOVERY');
      const final = await this.rpcReference('recoveryFinish', { operationId: p.operationId, state: view });
      this.put('latch', { mode: 'VERIFYING', reason: '' }); await this.durable('recovery-local'); return final;
    }
    return fail('UNKNOWN_TEST_RPC');
  }
}
