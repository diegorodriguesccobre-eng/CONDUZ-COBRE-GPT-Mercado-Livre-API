import { env, exports } from 'cloudflare:workers';
import { evictDurableObject, reset, runInDurableObject } from 'cloudflare:test';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import worker from '../src/index';
import { ACCOUNT_REF, SELLER_ID } from '../src/types';
import { TEST_AUTH } from './helpers';

const headers = { Authorization: `Bearer ${TEST_AUTH}` };
const request = (path: string, init: RequestInit = {}) => exports.default.fetch(`http://localhost${path}`, { headers, ...init });
async function connect() {
  const start = await request('/internal/oauth/start', { method: 'POST' });
  const body = await start.json() as { data: { synthetic_callback_path: string } };
  const response = await request(body.data.synthetic_callback_path);
  expect(response.status).toBe(200);
  return body.data.synthetic_callback_path;
}
const vault = () => env.ACCOUNT_VAULT.get(env.ACCOUNT_VAULT.idFromName(`conduz_cobre:${env.APP_ENV}:${ACCOUNT_REF}`));
beforeEach(async () => { await reset(); });

describe('Worker e SQLite reais no runtime local', () => {
  it('health exige autenticação e retorna modo sintético', async () => {
    expect((await request('/internal/health', { headers: {} })).status).toBe(401);
    const health = await request('/internal/health');
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ source: 'synthetic', data: { status: 'ok', transport: 'synthetic' } });
  });
  it('executa OAuth, identidade, página e detalhe sem qualquer fetch de rede', async () => {
    await connect();
    const account = await request('/internal/account');
    expect(account.status).toBe(200);
    expect(await account.json()).toMatchObject({ data: { seller_id: SELLER_ID } });
    const listings = await request('/internal/listings?limit=1');
    const page = await listings.json() as { data: { next_cursor: string; items: unknown[] } };
    expect(page.data.items).toHaveLength(1);
    const second = await request(`/internal/listings?limit=1&cursor=${encodeURIComponent(page.data.next_cursor)}`);
    expect(await second.json()).toMatchObject({ data: { next_cursor: null } });
    expect((await request('/internal/listings/MLB_SYNTH_001')).status).toBe(200);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('persiste ciphertext em SQLite e conserva conexão após eviction', async () => {
    await connect();
    await runInDurableObject(vault(), (_instance, state) => {
      const rows = state.storage.sql.exec<{ ciphertext: string; status: string }>('SELECT ciphertext,status FROM tokens').toArray();
      expect(rows).toHaveLength(1);
      expect(rows[0]?.status).toBe('ready');
      expect(rows[0]?.ciphertext).not.toContain('SYNTHETIC_ACCESS.');
      expect(rows[0]?.ciphertext).not.toContain('SYNTHETIC_REFRESH.');
      expect(JSON.parse(rows[0]!.ciphertext).v).toBe(1);
      expect(state.storage.sql.exec<{ n: number }>('SELECT count(*) AS n FROM oauth_states').one().n).toBe(0);
    });
    await evictDurableObject(vault());
    expect((await request('/internal/account')).status).toBe(200);
  });
  it('state não pode ser repetido após persistência e eviction', async () => {
    const path = await connect(); await evictDurableObject(vault());
    expect((await request(path)).status).toBe(400);
  });
  it('SQL protege consumo atômico de state concorrente', async () => {
    const start = await request('/internal/oauth/start', { method: 'POST' });
    const { data } = await start.json() as { data: { synthetic_callback_path: string } };
    const statuses = await Promise.all([request(data.synthetic_callback_path), request(data.synthetic_callback_path)]);
    expect(statuses.map(r => r.status).sort()).toEqual([200, 400]);
  });
  it('recupera falha de refresh sem reutilizar token após eviction', async () => {
    await connect();
    await runInDurableObject(vault(), (_instance, state) => { state.storage.sql.exec("UPDATE tokens SET status='refreshing'"); });
    await evictDurableObject(vault());
    const result = await request('/internal/account');
    expect(result.status).toBe(409);
    expect(await result.json()).toMatchObject({ error: { code: 'RECONNECT_REQUIRED' } });
    await connect();
    expect((await request('/internal/account')).status).toBe(200);
  });
  it('renova tokens concorrentes com persistência SQL e uma geração nova', async () => {
    await connect();
    // Test-only storage access: expire the encrypted record while preserving its synthetic contents.
    const { CryptoBox } = await import('../src/crypto');
    const { TEST_KEY, CONTEXT } = await import('./helpers');
    await runInDurableObject(vault(), async (_instance, state) => {
      const row = state.storage.sql.exec<{ ciphertext: string }>('SELECT ciphertext FROM tokens').one();
      const box = new CryptoBox(TEST_KEY, CONTEXT);
      const record = await box.open<import('../src/types').TokenRecord>(row.ciphertext, 'tokens');
      record.expiresAt = 0;
      state.storage.sql.exec('UPDATE tokens SET ciphertext=?', await box.seal(record, 'tokens'));
    });
    const results = await Promise.all(Array.from({ length: 8 }, () => request('/internal/account')));
    expect(results.every(r => r.status === 200)).toBe(true);
    await runInDurableObject(vault(), async (_instance, state) => {
      const row = state.storage.sql.exec<{ ciphertext: string }>('SELECT ciphertext FROM tokens').one();
      const box = new CryptoBox(TEST_KEY, CONTEXT);
      const record = await box.open<import('../src/types').TokenRecord>(row.ciphertext, 'tokens');
      expect(record.generation).toBe(2);
    });
  });
});

describe('segurança das rotas', () => {
  it('aceita POST vazio com stream e rejeita qualquer conteúdo', async () => {
    const empty = await request('/internal/oauth/start', { method: 'POST', body: '' });
    expect(empty.status).toBe(200);
    const content = await request('/internal/oauth/start', { method: 'POST', body: 'synthetic-unexpected-body' });
    expect(content.status).toBe(400);
  });
  it.each(['/internal/account', '/internal/listings', '/internal/listings/MLB_SYNTH_001',
    '/internal/oauth/start', '/internal/oauth/callback?state=a&code=b', '/proxy?url=https://example.com'])
  ('exige autenticação para %s', async path => {
    const result = await request(path, { headers: {} });
    expect(result.status).toBe(401);
  });
  it.each(['Bearer invalid', 'Basic synthetic', `Bearer ${'A'.repeat(45)}`])('rejeita autenticação inválida %s', async Authorization => {
    expect((await request('/internal/health', { headers: { Authorization } })).status).toBe(401);
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('rejeita método comercial %s', async method => {
    expect((await request('/internal/listings/MLB_SYNTH_001', { method })).status).toBe(405);
  });
  it.each(['/internal/listings?seller_id=OTHER', '/internal/listings?limit=1&limit=2',
    '/internal/listings?limit=21', '/internal/listings?limit=NaN', '/internal/account?url=https://example.com'])
  ('rejeita parâmetros não autorizados %s', async path => {
    expect((await request(path)).status).toBe(400);
  });
  it('bloqueia browser cross-origin e rotas de proxy', async () => {
    expect((await request('/internal/health', { headers: { ...headers, Origin: 'https://attacker.invalid' } })).status).toBe(403);
    expect((await request('/proxy')).status).toBe(404);
    expect((await request('/internal/listings/REAL_LISTING')).status).toBe(404);
  });
  it('recusa configuração live e vendedor não sintético antes de acessar o cofre', async () => {
    for (const override of [{ TRANSPORT: 'live' }, { EXPECTED_SELLER_ID: 'REAL_SELLER' }, { APP_ENV: 'production' }]) {
      const response = await worker.fetch(new Request('http://localhost/internal/account', { headers }), { ...env, ...override });
      expect(response.status).toBe(503);
    }
  });
  it('limita chamadas autenticadas no SQLite', async () => {
    for (let i = 0; i < 30; i++) expect((await request('/internal/account')).status).toBe(409);
    const result = await request('/internal/account');
    expect(result.status).toBe(429);
    expect(await result.json()).toMatchObject({ error: { code: 'RATE_LIMITED' } });
  });
  it('não registra tokens, code, state, queries ou headers', async () => {
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const path = await connect();
    await request('/internal/account');
    const serialized = JSON.stringify(logs.mock.calls);
    const url = new URL(path, 'http://localhost');
    expect(serialized).not.toContain(TEST_AUTH);
    expect(serialized).not.toContain(url.searchParams.get('code'));
    expect(serialized).not.toContain(url.searchParams.get('state'));
    expect(serialized).not.toContain('SYNTHETIC_ACCESS.');
    expect(serialized).not.toContain('SYNTHETIC_REFRESH.');
    for (const [line] of logs.mock.calls) {
      expect(Object.keys(JSON.parse(String(line))).sort()).toEqual(['duration_ms', 'event', 'operation', 'request_id', 'source', 'status']);
    }
  });
  it('respostas OAuth não permitem cache nem referrer', async () => {
    const result = await request('/internal/oauth/start', { method: 'POST' });
    expect(result.headers.get('Cache-Control')).toBe('no-store');
    expect(result.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(result.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
});
