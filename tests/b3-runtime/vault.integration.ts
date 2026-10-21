import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, runInDurableObject } from 'cloudflare:test';
import { describe, expect, it, vi } from 'vitest';
import type { B3Env } from '../../src/b3/vault';
import { SqliteStore } from '../../src/vault/sqlite-store';
import { TokenKeyring } from '../../src/b3/keyring';
import { TokenCoordinator } from '../../src/b3/token-service';
import { BrowserOAuthService } from '../../src/preparation/browser-oauth';
import { CryptoBox } from '../../src/crypto';
import { preparationConfig } from '../b1/helpers';
import { TEST_KEY } from '../helpers';

const b3Env = env as unknown as B3Env;
const vault = (id: string) => b3Env.B3_VAULT.get(b3Env.B3_VAULT.idFromName('b3-local:' + id));
describe('B3 Durable Object SQLite separado (workerd local)', () => {
  it('entrada B3 recusa mesmo configuração completa e não acessa rede', async () => {
    for (const path of ['/internal/health', '/oauth/start', '/oauth/mercadolivre/callback']) {
      const response = await exports.default.fetch('https://local.invalid' + path);
      expect(response.status).toBe(503); expect(await response.text()).toContain('PRODUCTION_DISABLED');
    }
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('state SQLite sobrevive eviction e DELETE RETURNING só permite um consumo', async () => {
    const stub = vault('state');
    await runInDurableObject(stub, (_instance, state) => {
      const store = new SqliteStore(state.storage);
      store.putState('test-hash', { ciphertext: 'SYNTHETIC_CIPHERTEXT', expiresAt: Date.now() + 60000 });
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, (_instance, state) => {
      const store = new SqliteStore(state.storage);
      expect(store.takeState('test-hash')?.ciphertext).toBe('SYNTHETIC_CIPHERTEXT');
      expect(store.takeState('test-hash')).toBeUndefined();
    });
  });
  it('callbacks concorrentes em SQLite consomem state uma vez', async () => {
    await runInDurableObject(vault('callback'), async (_instance, state) => {
      const store = new SqliteStore(state.storage);
      const service = new BrowserOAuthService(store, new CryptoBox(TEST_KEY, 'b3-runtime-state'), preparationConfig);
      const start = await service.begin(new Request(preparationConfig.publicOrigin + '/oauth/start', {
        method: 'POST', headers: { Origin: preparationConfig.publicOrigin }
      }), { role: 'administrator', subject: 'synthetic-admin', expiresAt: Date.now() + 600000 });
      const request = () => new Request(preparationConfig.redirectUri + '?state=' + start.state + '&code=SYNTHETIC_CODE', {
        headers: { Cookie: start.cookie.split(';')[0]! }
      });
      const results = await Promise.allSettled([service.consume(request()), service.consume(request())]);
      expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
    });
  });
  it('marcador refresh persistente bloqueia reutilização após eviction', async () => {
    const stub = vault('refresh');
    await runInDurableObject(stub, async (_instance, state) => {
      const store = new SqliteStore(state.storage); const keys = new TokenKeyring('v1', { v1: TEST_KEY }, 'runtime');
      const clock = { now: Date.now() };
      const provider = { exchange: async () => ({ accessToken: 'SYNTHETIC_ACCESS', refreshToken: 'SYNTHETIC_REFRESH', expiresIn: 60, sellerId: '42' }),
        refresh: async () => { throw new Error('SYNTHETIC_AMBIGUOUS_NETWORK'); }, identity: async () => ({ sellerId: '42' }) };
      const tokens = new TokenCoordinator(store, keys, provider, '42', () => clock.now);
      await tokens.connect({ code: 'SYNTHETIC_CODE', verifier: 'x'.repeat(43), redirectUri: preparationConfig.redirectUri });
      clock.now += 31000;
      await expect(tokens.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
      const rows = state.storage.sql.exec<{ ciphertext: string; status: string }>('SELECT ciphertext,status FROM tokens').toArray();
      expect(rows[0]!.status).toBe('refreshing'); expect(rows[0]!.ciphertext).not.toContain('SYNTHETIC_');
    });
    await evictDurableObject(stub);
    await runInDurableObject(stub, async (_instance, state) => {
      const refresh = vi.fn(async () => { throw new Error('MUST_NOT_CALL'); });
      const tokens = new TokenCoordinator(new SqliteStore(state.storage), new TokenKeyring('v1', { v1: TEST_KEY }, 'runtime'),
        { exchange: refresh, refresh, identity: async () => ({ sellerId: '42' }) }, '42');
      await expect(tokens.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
      expect(refresh).not.toHaveBeenCalled();
    });
  });
  it('quota e rollback SQL mantêm falhas fechadas', async () => {
    await runInDurableObject(vault('quota'), (_instance, state) => {
      const store = new SqliteStore(state.storage);
      for (let i = 0; i < 30; i++) store.quota('synthetic-operator');
      expect(() => store.quota('synthetic-operator')).toThrow();
      expect(() => state.storage.transactionSync(() => {
        store.putTokens({ ciphertext: 'SYNTHETIC_ROLLED_BACK', status: 'ready' }); throw new Error('SQL_ROLLBACK');
      })).toThrow();
      expect(store.getTokens()).toBeUndefined();
    });
  });
});
