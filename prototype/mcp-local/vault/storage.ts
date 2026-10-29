import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { TokenKeyring } from '../../../src/b3/keyring';
import { SqliteStore } from '../../../src/vault/sqlite-store';
import type { TokenRecord, TokenRow } from '../../../src/types';
import type { PersistentEnv } from '../src/persistent-policy';
import { VAULTS, accountSchema, requestSchema, materialSchema, context, type Account } from './model';
import { INJECTION_TEXT } from '../src/synthetic';
import { readVaultCore, type ReadHooks } from './read-core';

export interface VaultEnv extends PersistentEnv {
  SYNTHETIC_ONLY?: string;
  SYNTHETIC_VAULT_MATERIAL?: unknown;
  SYNTHETIC_VAULTS: DurableObjectNamespace<SyntheticAccountVault>;
}
const fail = (): never => { throw new Error('SYNTHETIC_VAULT_DENIED'); };


// New class/binding for the synthetic fixture only. Never replaces or migrates a B3.1 vault.
export class SyntheticAccountVault extends DurableObject<VaultEnv> {
  private readonly store: SqliteStore;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(ctx: DurableObjectState, env: VaultEnv, private readonly readHooks?: (request: z.infer<typeof requestSchema>) => ReadHooks | undefined) {
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
      if (fault === 'http-429' || fault === 'http-503') return new Response('SYNTHETIC_PROVIDER_UNAVAILABLE', { status: fault === 'http-429' ? 429 : 503 });
      if (fault === 'body-error') return new Response(new ReadableStream<Uint8Array>({
        start(c) { c.error(new Error('SYNTHETIC_PROVIDER_BODY_FAILURE')); }
      }), { headers: { 'Content-Type': 'application/json' } });
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
        const hooks = this.readHooks?.(r);
        const result = await readVaultCore(r, {
          store: this.store, hooks, checkStorage: () => this.checkStorage(), binding: a => this.binding(a),
          storedAccount: () => this.get('account'), storedIdentity: () => this.get('identity'), keys: a => this.keys(a),
          authorize: value => this.authorize(value), consumeNonce: async nonce => {
            this.ctx.storage.sql.exec('INSERT INTO isolation_nonces VALUES(?)', nonce); await this.ctx.storage.sync();
          }, materials: () => this.env.SYNTHETIC_VAULT_MATERIAL, transport: a => this.transport(a)
        });
        const data = result.data;
        this.ctx.storage.sql.exec('INSERT INTO isolation_audit(event) VALUES(?)', JSON.stringify({ account, subject: r.subject, operation: r.operation, result: 'allow' }));
        await this.ctx.storage.sync();
        if (hooks) await hooks.phase('after-audit', result.stamp);
        return { ok: true as const, data };
      } catch (error) {
        try { this.readHooks?.(requestSchema.parse(input))?.failed(error); } catch { /* Invalid input has no integration context. */ }
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
