import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { digest } from '../../../src/crypto';
import type { Permission } from '../../../src/b4/local';
import { ISSUER, SUBJECTS } from './synthetic';
import { PARTITIONS, pairSchema, grantSchema, updateSchema, revokeSchema, subjectSchema, revisionSchema,
  fingerprint, type Grant, type Pair, type Anchor } from './persistent-model';

interface StorageEnv { GRANT_PARTITIONS: DurableObjectNamespace<GrantPartition> }
type AuditRow = { sequence: number; time: number; event: string; account: string; subject: string; revision: number; permission: string; actor: string };

// Separate SQLite DO per internal account. A restored projection is never sufficient to authorize.
export class GrantPartition extends DurableObject<StorageEnv> {
  constructor(ctx: DurableObjectState, env: StorageEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS grants (subject TEXT PRIMARY KEY, payload TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS partition_identity (id INTEGER PRIMARY KEY CHECK(id=1), account TEXT NOT NULL)');
  }
  protected available(_operation: string): void {}
  async put(input: unknown): Promise<void> {
    this.available('write'); const grant = grantSchema.parse(input);
    this.ctx.storage.transactionSync(() => {
      const bound = this.ctx.storage.sql.exec<{ account: string }>('SELECT account FROM partition_identity WHERE id=1').toArray()[0];
      if (bound && bound.account !== grant.account) throw new Error('PARTITION_MISMATCH');
      const previous = this.ctx.storage.sql.exec<{ payload: string }>('SELECT payload FROM grants WHERE subject=?', grant.subject).toArray()[0];
      if (previous && grantSchema.parse(JSON.parse(previous.payload)).revision >= grant.revision) throw new Error('PROJECTION_CONFLICT');
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO partition_identity VALUES(1,?)', grant.account);
      this.ctx.storage.sql.exec('INSERT INTO grants VALUES(?,?) ON CONFLICT(subject) DO UPDATE SET payload=excluded.payload', grant.subject, JSON.stringify(grant));
    });
    await this.ctx.storage.sync();
  }
  read(input: unknown): Grant | null {
    this.available('read'); const pair = pairSchema.parse(input);
    const bound = this.ctx.storage.sql.exec<{ account: string }>('SELECT account FROM partition_identity WHERE id=1').toArray()[0];
    if (bound?.account !== pair.account) return null;
    const row = this.ctx.storage.sql.exec<{ payload: string }>('SELECT payload FROM grants WHERE subject=?', pair.subject).toArray()[0];
    return row ? grantSchema.parse(JSON.parse(row.payload)) : null;
  }
}

// Independent authoritative ledger: never restored together with grant projections.
// All provisioning/mutations below are trusted local DO RPC, unreachable through HTTP/MCP.
export class GrantAuthority extends DurableObject<StorageEnv> {
  constructor(ctx: DurableObjectState, env: StorageEnv) {
    super(ctx, env);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS operators (subject TEXT PRIMARY KEY, enabled INTEGER NOT NULL, revision INTEGER NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS accounts (account TEXT PRIMARY KEY, partition_name TEXT NOT NULL UNIQUE)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS anchors (account TEXT NOT NULL, subject TEXT NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL CHECK(state IN (\'pending\',\'active\',\'revoked\')), fingerprint TEXT NOT NULL, PRIMARY KEY(account,subject))');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS audit (sequence INTEGER PRIMARY KEY AUTOINCREMENT, time INTEGER NOT NULL, event TEXT NOT NULL, account TEXT NOT NULL, subject TEXT NOT NULL, revision INTEGER NOT NULL, permission TEXT NOT NULL, actor TEXT NOT NULL)');
  }
  // Overridden only in the local fault-injection fixture, never configured through MCP.
  protected async afterPersist(_stage: string): Promise<void> {}
  protected available(): void {}
  private async persisted(stage: string): Promise<void> {
    await this.ctx.storage.sync(); await this.afterPersist(stage);
  }
  private event(event: string, pair: { account: string; subject: string }, revision: number, permission = ''): void {
    this.ctx.storage.sql.exec('INSERT INTO audit(time,event,account,subject,revision,permission,actor) VALUES(?,?,?,?,?,?,?)',
      Date.now(), event, pair.account, pair.subject, revision, permission,
      permission === 'policy-query' ? 'local-policy-inspection' : permission ? 'verified-operator' : 'local-administration');
  }
  private anchor(pair: Pair): Anchor | undefined {
    return this.ctx.storage.sql.exec<Anchor>('SELECT account,subject,revision,state,fingerprint FROM anchors WHERE account=? AND subject=?', pair.account, pair.subject).toArray()[0];
  }
  private registered(pair: Pair): boolean {
    const operator = this.ctx.storage.sql.exec<{ enabled: number }>('SELECT enabled FROM operators WHERE subject=?', pair.subject).toArray()[0];
    const account = this.ctx.storage.sql.exec<{ partition_name: string }>('SELECT partition_name FROM accounts WHERE account=?', pair.account).toArray()[0];
    return operator?.enabled === 1 && account?.partition_name === PARTITIONS[pair.account];
  }
  private partition(pair: Pair) {
    const ns = this.env.GRANT_PARTITIONS;
    return ns.get(ns.idFromName(PARTITIONS[pair.account]));
  }
  async initializeSyntheticRegistry(): Promise<void> {
    this.available();
    const subjects = await Promise.all(SUBJECTS.map(sub => digest(`${ISSUER}\0${sub}`)));
    this.ctx.storage.transactionSync(() => {
      // INSERT OR IGNORE never re-enables an operator or recreates any grant.
      for (const subject of subjects) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO operators VALUES(?,1,1)', subject);
      for (const [account, partition] of Object.entries(PARTITIONS)) this.ctx.storage.sql.exec('INSERT OR IGNORE INTO accounts VALUES(?,?)', account, partition);
    });
    await this.persisted('registry');
  }
  async setOperator(input: unknown): Promise<number> {
    this.available();
    // Explicit administrative RPC, NOT a read/connect privilege.
    const schema = z.object({ subject: subjectSchema, enabled: z.boolean(), expectedRevision: revisionSchema }).strict();
    const value = schema.parse(input);
    const revision = this.ctx.storage.transactionSync(() => {
      const old = this.ctx.storage.sql.exec<{ revision: number }>('SELECT revision FROM operators WHERE subject=?', value.subject).toArray()[0];
      if (!old || old.revision !== value.expectedRevision) throw new Error('REVISION_CONFLICT');
      this.ctx.storage.sql.exec('UPDATE operators SET enabled=?,revision=revision+1 WHERE subject=?', Number(value.enabled), value.subject);
      this.event(value.enabled ? 'operator-enabled' : 'operator-disabled', { account: '', subject: value.subject }, old.revision + 1);
      return old.revision + 1;
    });
    await this.persisted('operator'); return revision;
  }
  async update(input: unknown): Promise<number> {
    this.available(); const { grant, expectedRevision } = updateSchema.parse(input);
    const hash = await fingerprint(grant);
    this.ctx.storage.transactionSync(() => {
      const old = this.anchor(grant);
      if (!this.registered(grant)) throw new Error('UNREGISTERED_PAIR');
      if ((old?.revision ?? 0) !== expectedRevision || grant.revision !== expectedRevision + 1) throw new Error('REVISION_CONFLICT');
      // Revocation is terminal for this pair in this phase. Regrant/recovery requires a later design.
      if (old && old.state !== 'active') throw new Error('GRANT_FENCED');
      this.ctx.storage.sql.exec('INSERT INTO anchors VALUES(?,?,?,\'pending\',?) ON CONFLICT(account,subject) DO UPDATE SET revision=excluded.revision,state=excluded.state,fingerprint=excluded.fingerprint',
        grant.account, grant.subject, grant.revision, hash);
      this.event('grant-pending', grant, grant.revision);
    });
    await this.persisted('grant-pending');
    await this.partition(grant).put(grant);
    this.ctx.storage.transactionSync(() => {
      const current = this.anchor(grant);
      if (current?.state !== 'pending' || current.revision !== grant.revision || current.fingerprint !== hash) throw new Error('REVISION_CONFLICT');
      this.ctx.storage.sql.exec('UPDATE anchors SET state=\'active\' WHERE account=? AND subject=?', grant.account, grant.subject);
      this.event('grant-active', grant, grant.revision);
    });
    await this.persisted('grant-active'); return grant.revision;
  }
  async revoke(input: unknown): Promise<number> {
    this.available(); const pair = revokeSchema.parse(input);
    const revision = this.ctx.storage.transactionSync(() => {
      const old = this.anchor(pair);
      if ((old?.revision ?? 0) !== pair.expectedRevision) throw new Error('REVISION_CONFLICT');
      this.ctx.storage.sql.exec('INSERT INTO anchors VALUES(?,?,?,\'revoked\',\'\') ON CONFLICT(account,subject) DO UPDATE SET revision=excluded.revision,state=excluded.state,fingerprint=excluded.fingerprint',
        pair.account, pair.subject, pair.expectedRevision + 1);
      this.event('revoked', pair, pair.expectedRevision + 1);
      return pair.expectedRevision + 1;
    });
    // No success acknowledgment before the authoritative tombstone + audit are durably flushed.
    await this.persisted('revoked'); return revision;
  }
  async permissions(input: unknown, required?: Permission): Promise<Permission[]> {
    this.available(); const pair = pairSchema.parse(input);
    if (required !== undefined) z.enum(['read', 'connect']).parse(required);
    let projection: Grant | null = null; let hash = '';
    try { projection = await this.partition(pair).read(pair); if (projection) hash = await fingerprint(projection); }
    catch { /* Missing/unavailable/corrupt projection never authorizes. */ }
    // Final read after all awaits is the authorization linearization point. No allow cache.
    return this.ctx.storage.transactionSync(() => {
      const anchor = this.anchor(pair); const now = Date.now();
      const allowed = this.registered(pair) && projection?.account === pair.account && projection.subject === pair.subject
        && projection.validFrom <= now && now < projection.validUntil && anchor?.state === 'active'
        && anchor.revision === projection.revision && anchor.fingerprint === hash
        && (required === undefined || projection.permissions.includes(required));
      this.event(allowed ? 'authorized' : 'denied', pair, anchor?.revision ?? 0, required ?? 'policy-query');
      return allowed ? [...projection!.permissions] : [];
    });
  }
  inspect(input: unknown): Anchor | null { this.available(); return this.anchor(pairSchema.parse(input)) ?? null; }
  audit(): AuditRow[] { this.available(); return this.ctx.storage.sql.exec<AuditRow>('SELECT * FROM audit ORDER BY sequence DESC LIMIT 200').toArray(); }
}
