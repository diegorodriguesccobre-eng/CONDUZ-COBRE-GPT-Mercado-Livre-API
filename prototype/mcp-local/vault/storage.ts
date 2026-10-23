import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { TokenKeyring } from '../../../src/b3/keyring';
import { TokenCoordinator, type TokenProvider } from '../../../src/b3/token-service';
import { CandidateAdapter } from '../../../src/b3/adapter';
import { SqliteStore } from '../../../src/vault/sqlite-store';
import type { TokenRecord, VaultStore, TokenRow } from '../../../src/types';
import type { PersistentEnv } from '../src/persistent-policy';
import { VAULTS, accountSchema, requestSchema, materialSchema, context, type Account } from './model';
import { INJECTION_TEXT } from '../src/synthetic';

export interface VaultEnv extends PersistentEnv {
  SYNTHETIC_ONLY?: string;
  SYNTHETIC_VAULT_MATERIAL?: unknown;
  SYNTHETIC_VAULTS: DurableObjectNamespace<SyntheticAccountVault>;
}
const fail = (): never => { throw new Error('SYNTHETIC_VAULT_DENIED'); };
const recordSchema = z.strictObject({ accessToken: z.string(), refreshToken: z.string(), sellerId: z.string(),
  expiresAt: z.number().int().positive(), generation: z.number().int().positive() });

// New class/binding for the synthetic fixture only. Never replaces or migrates a B3.1 vault.
export class SyntheticAccountVault extends DurableObject<VaultEnv> {
  private readonly store: SqliteStore;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: VaultEnv) {
    super(ctx, env); this.store = new SqliteStore(ctx.storage);
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS isolation_meta (key TEXT PRIMARY KEY,value TEXT NOT NULL)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS isolation_nonces (nonce TEXT PRIMARY KEY)');
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS isolation_audit (id INTEGER PRIMARY KEY,event TEXT NOT NULL)');
  }
  private get(key: string): unknown {
    const row = this.ctx.storage.sql.exec<{ value: string }>('SELECT value FROM isolation_meta WHERE key=?', key).toArray()[0];
    return row ? JSON.parse(row.value) : undefined;
  }
  private put(key: string, value: unknown) { this.ctx.storage.sql.exec('INSERT OR REPLACE INTO isolation_meta VALUES(?,?)', key, JSON.stringify(value)); }
  private checkStorage() { if (['storage', 'corrupt'].includes(String(this.get('fault')))) fail(); }
  private keys(account: Account) {
    const m = materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL); const v = VAULTS[account];
    return new TokenKeyring(v.keyId, { [v.keyId]: m[account].key }, context(account));
  }
  private binding(account: Account) {
    const v = VAULTS[account];
    if (this.env.SYNTHETIC_ONLY !== 'B4_MCP_LOCAL_ONLY' || this.ctx.id.toString() !== this.env.SYNTHETIC_VAULTS.idFromName(v.vault).toString()) fail();
    return { ...v, version: 1 };
  }
  private async authorize(r: z.infer<typeof requestSchema>) {
    if (r.identityExpiresAt <= Date.now()) fail();
    const ns = this.env.GRANT_AUTHORITY; if (!ns) return fail();
    if (!(await ns.get(ns.idFromName('synthetic-security-authority')).permissions({ account: r.account, subject: r.subject }, 'read')).includes('read')) fail();
    if (r.identityExpiresAt <= Date.now()) fail();
  }
  private transport(account: Account) {
    const v = VAULTS[account], materials = materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL), m = materials[account];
    return { send: async (request: Request): Promise<Response> => {
      // This port constructs responses; it never calls fetch or a real network transport.
      const u = new URL(request.url), fault = this.get('fault');
      if (request.method !== 'GET' || request.headers.get('Authorization') !== `Bearer ${m.access}`) fail();
      if (fault === 'transport') throw new Error(m.access); // Canary: adapter must sanitize arbitrary provider errors.
      if (fault === 'pause') {
        this.put('paused', true);
        await new Promise<void>(resolve => { this.release = resolve; });
      }
      if (u.pathname === '/users/me') return Response.json({ id: Number(fault === 'wrong-identity' ? VAULTS[account === 'account-a' ? 'account-b' : 'account-a'].seller : v.seller),
        nickname: fault === 'leak-identity' ? m.access : `SYNTHETIC ACCOUNT ${account.at(-1)!.toUpperCase()}`, site_id: 'MLB', access_token: m.access });
      if (u.pathname === `/users/${v.seller}/items/search`) {
        const limit = Number(u.searchParams.get('limit')), offset = Number(u.searchParams.get('offset'));
        return Response.json({ results: fault === 'wrong-search' ? [VAULTS[account === 'account-a' ? 'account-b' : 'account-a'].numeric[0]] : v.numeric.slice(offset, offset + limit),
          paging: { total: 2, limit, offset }, refresh_token: m.refresh });
      }
      if (u.pathname.startsWith('/items/')) {
        const id = u.pathname.slice(7), index = v.numeric.findIndex(x => x === id); if (index < 0) fail();
        return Response.json({ id: fault === 'wrong-item-id' ? v.numeric[1 - index]! : id,
          seller_id: Number(fault === 'wrong-item-seller' ? VAULTS[account === 'account-a' ? 'account-b' : 'account-a'].seller : v.seller),
          title: fault === 'leak-title' ? materials['account-b'].refresh : account === 'account-a' && index === 0 ? INJECTION_TEXT : `SYNTHETIC ${account} ITEM ${index + 1}`,
          status: 'active', price: 10 * (index + 1), currency_id: 'BRL', access_token: m.access });
      }
      return fail();
    } };
  }
  private release: (() => void) | undefined;
  async execute(input: unknown): Promise<unknown> {
    const work = this.tail.then(async () => {
      let account: Account | undefined;
      try {
        const r = requestSchema.parse(input); account = r.account;
        this.checkStorage(); const expected = this.binding(account);
        if (this.get('account') !== account) fail();
        const keys = this.keys(account);
        const identity = await keys.open<unknown>(String(this.get('identity')));
        if (JSON.stringify(identity) !== JSON.stringify(expected)) fail();
        await this.authorize(r);
        this.ctx.storage.sql.exec('INSERT INTO isolation_nonces VALUES(?)', r.nonce); await this.ctx.storage.sync();
        this.checkStorage(); const row = this.store.getTokens(); if (!row || row.status !== 'ready') return fail();
        const record = recordSchema.parse(await keys.open<TokenRecord>(row.ciphertext));
        if (record.sellerId !== expected.seller || record.expiresAt <= Date.now() + 30000) fail();
        const m = materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL)[account];
        if (record.accessToken !== m.access || record.refreshToken !== m.refresh) fail();
        const readonlyStore: VaultStore = { getTokens: () => { this.checkStorage(); return this.store.getTokens(); },
          putTokens: () => fail(), putState: () => fail(), takeState: () => fail() };
        const adapter = new CandidateAdapter(expected.seller, 'SYNTHETIC_DISABLED', 'SYNTHETIC_DISABLED', this.transport(account));
        // withAccess may refresh by design in B3.1. The immutable facade rejects its write-ahead marker
        // before it can reach refresh; this prototype never offers connect/refresh/rotate to an operator.
        const disabled: TokenProvider = { exchange: async () => fail(), refresh: async () => fail(), identity: t => adapter.identity(t) };
        const coordinator = new TokenCoordinator(readonlyStore, keys, disabled, expected.seller);
        const data = await coordinator.withAccess(async token => {
          const me = await adapter.identity(token); // Search has no seller in its draft response: bind identity first.
          if (r.operation === 'account') return { account_ref: account, nickname: me.nickname, site: me.siteId };
          if (r.operation === 'listing') {
            const index = expected.legacy.findIndex(x => x === r.itemId); if (index < 0) return fail();
            const item = await adapter.reads.item(token, expected.numeric[index]!);
            if (item.status !== 'active') return fail();
            return { item_id: r.itemId!, title: item.title, status: 'active', price: item.price };
          }
          const found = await adapter.reads.listings(token, r.limit!, r.offset!);
          if (found.total > 2) return fail();
          const ids: string[] = [];
          for (const id of found.ids) {
            const index = expected.numeric.findIndex(x => x === id); if (index < 0) return fail();
            await adapter.reads.item(token, id); // Independently validates seller for every returned ID.
            ids.push(expected.legacy[index]!);
          }
          return { ids, total: found.total, next_offset: r.offset! + r.limit! < found.total ? r.offset! + r.limit! : null };
        });
        this.checkStorage();
        if (JSON.stringify(this.store.getTokens()) !== JSON.stringify(row)) fail();
        await this.authorize(r); // Revocation/expiry while awaiting the adapter cannot release a result.
        const serialized = JSON.stringify(data);
        const secrets = Object.values(materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL)).flatMap(v => [v.key, v.access, v.refresh]);
        if (secrets.some(s => serialized.includes(s)) || /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/i.test(serialized)) fail();
        this.ctx.storage.sql.exec('INSERT INTO isolation_audit(event) VALUES(?)', JSON.stringify({ account, subject: r.subject, operation: r.operation, result: 'allow' }));
        await this.ctx.storage.sync(); return { ok: true as const, data };
      } catch {
        // Never relay arbitrary exceptions, ciphertexts, tokens or key material to MCP or runtime logs.
        try { this.ctx.storage.sql.exec('INSERT INTO isolation_audit(event) VALUES(?)', JSON.stringify({ account, result: 'deny' })); await this.ctx.storage.sync(); } catch { /* Still deny. */ }
        return { ok: false as const, code: 'SYNTHETIC_VAULT_DENIED' };
      }
    });
    this.tail = work.catch(() => undefined); return work;
  }
  // Explicit privileged test injection. No HTTP route or MCP tool dispatches here.
  async fixture(input: { kind: string; account?: unknown; value?: unknown }): Promise<unknown> {
    if (input.kind === 'release') { this.release?.(); this.release = undefined; this.put('fault', ''); return; }
    if (input.kind === 'paused') return this.get('paused') === true;
    if (input.kind === 'fault') { this.put('fault', input.value); await this.ctx.storage.sync(); return; }
    if (input.kind === 'seed') {
      const account = accountSchema.parse(input.account), expected = this.binding(account), m = materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL)[account];
      if (this.get('account') !== undefined || this.store.getTokens()) return fail();
      const keys = this.keys(account), identity = await keys.seal(expected), ciphertext = await keys.seal({ accessToken: m.access,
        refreshToken: m.refresh, sellerId: expected.seller, expiresAt: Date.now() + 600000, generation: 1 });
      this.ctx.storage.transactionSync(() => { this.put('account', account); this.put('identity', identity); this.store.putTokens({ ciphertext, status: 'ready' }); });
      await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'snapshot') return { row: this.store.getTokens(), account: this.get('account'), identity: this.get('identity'),
      events: this.ctx.storage.sql.exec<{ event: string }>('SELECT event FROM isolation_audit ORDER BY id').toArray().map(x => JSON.parse(x.event)) };
    if (input.kind === 'replace') {
      const v = input.value as { row: TokenRow; account: Account; identity: string };
      this.store.putTokens(v.row); this.put('account', v.account); this.put('identity', v.identity); await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'record') {
      const account = accountSchema.parse(this.get('account')); const v = input.value as Partial<TokenRecord>;
      const row = this.store.getTokens()!; const record = await this.keys(account).open<TokenRecord>(row.ciphertext);
      this.store.putTokens({ ciphertext: await this.keys(account).seal({ ...record, ...v }), status: 'ready' }); await this.ctx.storage.sync(); return;
    }
    if (input.kind === 'crypto-probe') {
      // Deliberately reuse a key but change AAD, proving context is also checked (not just key mismatch).
      const m = materialSchema.parse(this.env.SYNTHETIC_VAULT_MATERIAL)['account-a'];
      const a = new TokenKeyring('same-key', { 'same-key': m.key }, context('account-a'));
      const b = new TokenKeyring('same-key', { 'same-key': m.key }, context('account-b'));
      const cipher = await a.seal({ synthetic: true });
      try { await b.open(cipher); return { crossContextDenied: false }; } catch { return { crossContextDenied: true }; }
    }
    return fail();
  }
}
