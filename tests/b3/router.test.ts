import { beforeAll, describe, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AccessIdentityVerifier } from '../../src/preparation/access-identity';
import { localB3Router } from '../../src/b3/router';
import { CandidateAdapter } from '../../src/b3/adapter';
import { TokenCoordinator } from '../../src/b3/token-service';
import { TokenKeyring } from '../../src/b3/keyring';
import { pkceChallenge } from '../../src/crypto';
import b3Worker from '../../src/b3/entrypoint';
import b2Worker from '../../src/preparation/entrypoint';
import { browserHarness, preparationConfig } from '../b1/helpers';
import { TEST_KEY } from '../helpers';
const PRIVATE = 'SYNTHETIC_PRIVATE_MARKER';
let privateKey: CryptoKey; let resolver: JWTVerifyGetKey;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'b3-test' }] });
});
function harness() {
  const h = browserHarness(); let challenge = ''; let exchanges = 0;
  const transport = { send: vi.fn(async (request: Request) => {
    const url = new URL(request.url);
    if (url.pathname === '/oauth/token') {
      exchanges++;
      const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
      if (await pkceChallenge(form.get('code_verifier') ?? '') !== challenge || form.get('code') !== 'SYNTHETIC_CODE') {
        return Response.json({ error: PRIVATE }, { status: 400 });
      }
      return Response.json({ access_token: PRIVATE, refresh_token: 'SYNTHETIC_REFRESH', expires_in: 3600, user_id: 42, token_type: 'Bearer' });
    }
    if (url.pathname === '/users/me') return Response.json({ id: 42, nickname: 'SYNTHETIC', site_id: 'MLB', email: PRIVATE });
    if (url.pathname.includes('/items/search')) return Response.json({ results: ['MLB1234'], paging: { total: 1, limit: 20, offset: 0 } });
    return Response.json({ id: 'MLB1234', seller_id: 42, title: 'SYNTHETIC', status: 'active', price: 10, currency_id: 'BRL', private: PRIVATE });
  }) };
  const adapter = new CandidateAdapter('42', 'SYNTHETIC_CLIENT', 'SYNTHETIC_SECRET', transport);
  const tokens = new TokenCoordinator(h.store, new TokenKeyring('v1', { v1: TEST_KEY }, 'b3-test'), adapter, '42', () => h.clock.now);
  const router = localB3Router(preparationConfig, new AccessIdentityVerifier(preparationConfig, resolver, () => h.clock.now),
    { browser: h.service, tokens, reads: adapter.reads, quota: vi.fn() }, 'SYNTHETIC_CLIENT');
  async function jwt(role = 'administrator', claims: Record<string, unknown> = {}) {
    return new SignJWT({ iss: preparationConfig.accessIssuer, aud: preparationConfig.accessAudience,
      sub: role === 'administrator' ? 'synthetic-admin' : 'synthetic-viewer', iat: h.clock.now / 1000 - 1,
      exp: h.clock.now / 1000 + 300, type: 'app', ...claims }).setProtectedHeader({ alg: 'RS256', kid: 'b3-test' }).sign(privateKey);
  }
  async function request(path: string, method = 'GET', role = 'administrator', claims: Record<string, unknown> = {}) {
    return router(new Request(preparationConfig.publicOrigin + path, { method,
      headers: { 'Cf-Access-Jwt-Assertion': await jwt(role, claims), Origin: preparationConfig.publicOrigin } }));
  }
  async function start() {
    const response = await request('/oauth/start', 'POST'); expect(response.status).toBe(200);
    const body = await response.json() as { authorizationUrl: string };
    const url = new URL(body.authorizationUrl); challenge = url.searchParams.get('code_challenge')!;
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    const state = url.searchParams.get('state')!; const cookie = response.headers.get('Set-Cookie')!;
    expect(cookie).toContain('HttpOnly; Secure; SameSite=Lax');
    return { state, cookie, callback: () => h.callback(state, cookie) };
  }
  return { ...h, transport, tokens, adapter, router, request, jwt, start,
    exchanges: () => exchanges, setChallenge: (value: string) => { challenge = value; } };
}
describe('B3 composição OAuth e rotas individuais', () => {
  it('executa PKCE e callback público, persiste cifrado e consulta sem PII/tokens', async () => {
    const h = harness(); const flow = await h.start();
    const response = await h.router(flow.callback());
    expect(response.status).toBe(303); expect(response.headers.get('Location')).toBe(h.service.successUrl());
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(h.store.tokens?.ciphertext).not.toContain(PRIVATE);
    for (const path of ['/internal/account', '/internal/listings', '/internal/listings/MLB1234']) {
      const result = await h.request(path, 'GET', 'viewer'); expect(result.status).toBe(200);
      expect(await result.text()).not.toContain(PRIVATE); expect(result.headers.get('Cache-Control')).toBe('no-store');
    }
    expect(h.exchanges()).toBe(1); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('viewer não inicia OAuth nem alcança o provedor', async () => {
    const h = harness(); expect((await h.request('/oauth/start', 'POST', 'viewer')).status).toBe(403);
    expect(h.transport.send).not.toHaveBeenCalled();
  });
  it.each([{ iss: 'https://other.cloudflareaccess.com' }, { aud: 'other' }, { exp: 1 }, { sub: 'unknown' }, { type: 'service' }])(
    'JWT inválido bloqueia rota interna %j', async claims => {
      const h = harness(); expect((await h.request('/internal/health', 'GET', 'administrator', claims)).status).toBe(403);
      expect(h.transport.send).not.toHaveBeenCalled();
    });
  it('ausência de JWT e assinatura inválida não são substituídas por cabeçalhos de identidade', async () => {
    const h = harness();
    for (const token of ['', (await h.jwt()).replace(/\.[^.]+$/, '.AAAA')]) {
      const response = await h.router(new Request(preparationConfig.publicOrigin + '/internal/health', {
        headers: { 'Cf-Access-Jwt-Assertion': token, 'Cf-Access-Authenticated-User-Email': 'synthetic@example.invalid' }
      })); expect(response.status).toBe(403);
    }
  });
  it.each(['PUT', 'PATCH', 'DELETE', 'POST'])('bloqueia escrita comercial %s', async method => {
    const h = harness(); const flow = await h.start(); await h.router(flow.callback());
    expect((await h.request('/internal/listings/MLB1234', method)).status).toBe(405);
    expect(h.exchanges()).toBe(1);
    expect(h.transport.send.mock.calls.every(([r]) => r.method === 'GET' || new URL(r.url).pathname === '/oauth/token')).toBe(true);
  });
  it.each(['/internal/proxy?url=https://evil.invalid', '/internal/listings?limit=20&limit=1', '/internal/listings?seller_id=99', '/internal/account?access_token=bad'])('recusa rota/query %s', async path => {
    const h = harness(); expect((await h.request(path)).status).toBeGreaterThanOrEqual(400);
    expect(h.transport.send).not.toHaveBeenCalled();
  });
  it('origem divergente no início e método errado no callback não consomem state', async () => {
    const h = harness();
    expect((await h.router(new Request(preparationConfig.publicOrigin + '/oauth/start', { method: 'POST',
      headers: { 'Cf-Access-Jwt-Assertion': await h.jwt(), Origin: 'https://evil.invalid' } }))).status).toBe(403);
    const flow = await h.start();
    expect((await h.router(new Request(flow.callback(), { method: 'POST' }))).status).toBe(405);
    expect((await h.router(flow.callback())).status).toBe(303);
  });
  it.each(['expired', 'different-session', 'duplicate-state', 'tampered-state', 'no-cookie', 'wrong-pkce', 'provider-error'])('callback recusa %s sem vazamento', async mode => {
    const h = harness(); const flow = await h.start(); let callback = flow.callback();
    if (mode === 'expired') h.clock.now += 300001;
    if (mode === 'different-session') callback = h.callback(flow.state, '__Host-conduz_oauth=' + 'x'.repeat(43));
    if (mode === 'duplicate-state') callback = new Request(callback.url + '&state=' + flow.state, callback);
    if (mode === 'tampered-state') callback = h.callback('a'.repeat(43), flow.cookie);
    if (mode === 'no-cookie') callback = new Request(callback.url);
    if (mode === 'wrong-pkce') h.setChallenge('WRONG');
    if (mode === 'provider-error') callback = new Request(preparationConfig.redirectUri + '?state=' + flow.state + '&error=access_denied', callback);
    const response = await h.router(callback); expect(response.status).toBe(400);
    const body = await response.text(); expect(body).not.toContain(PRIVATE); expect(body).not.toContain('SYNTHETIC_CODE');
    expect(h.store.tokens).toBeUndefined();
    if (mode !== 'wrong-pkce') expect(h.exchanges()).toBe(0);
  });
  it('replay e callbacks concorrentes executam troca uma única vez', async () => {
    const h = harness(); const flow = await h.start();
    const results = await Promise.all([h.router(flow.callback()), h.router(flow.callback())]);
    expect(results.map(r => r.status).sort()).toEqual([303, 400]); expect(h.exchanges()).toBe(1);
    expect((await h.router(flow.callback())).status).toBe(400);
  });
  it('falha de armazenamento no state não revela exceção nem chama provedor', async () => {
    const h = harness(); const flow = await h.start();
    vi.spyOn(h.store, 'takeState').mockImplementation(() => { throw new Error(PRIVATE); });
    const response = await h.router(flow.callback()); expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(PRIVATE); expect(h.exchanges()).toBe(0);
  });
  it('B2 e entrada B3 permanecem inertes para qualquer rota', async () => {
    const h = harness();
    for (const path of ['/internal/health', '/oauth/mercadolivre/callback?code=' + PRIVATE, '/oauth/start']) {
      const b2 = await b2Worker.fetch(new Request(preparationConfig.publicOrigin + path));
      const b3 = await b3Worker.fetch();
      for (const response of [b2, b3]) {
        expect(response.status).toBe(503); expect(await response.text()).toContain('PRODUCTION_DISABLED');
      }
    }
    expect(h.transport.send).not.toHaveBeenCalled(); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
