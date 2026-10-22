import { beforeAll, expect, it, vi } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AccountAccess, localB4Router, syntheticReadMcp, type Permission } from '../../src/b4/local';
import { AccessIdentityVerifier } from '../../src/preparation/access-identity';
import { browserHarness, preparationConfig as config } from '../b1/helpers';
import type { LocalAccount } from '../../src/b3/router';
let key: CryptoKey; let resolver: JWTVerifyGetKey;
const now = 1800000000000;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); key = pair.privateKey;
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', kid: 'b4' }] });
});
async function request(claims: Record<string, unknown> = {}, path = '/internal/health', method = 'GET') {
  const token = await new SignJWT({ iss: config.accessIssuer, aud: config.accessAudience, sub: 'synthetic-admin',
    iat: now / 1000 - 1, exp: now / 1000 + 300, type: 'app', ...claims })
    .setProtectedHeader({ alg: 'RS256', kid: 'b4' }).sign(key);
  return new Request(config.publicOrigin + path, { method, headers: { 'Cf-Access-Jwt-Assertion': token, Origin: config.publicOrigin } });
}
function harness() {
  const grants = new Map<string, readonly Permission[]>();
  const verifier = new AccessIdentityVerifier(config, resolver, () => now);
  const policy = { permissions: vi.fn(async (account: string, subject: string) => grants.get(account + ':' + subject) ?? []) };
  const access = new AccountAccess(verifier, policy, () => now);
  const a = vi.fn(async () => ({ account: 'a' })); const b = vi.fn(async () => ({ account: 'b' }));
  const mcp = syntheticReadMcp(access, new Map([['a', a], ['b', b]]));
  async function allow(account: string, permissions: readonly Permission[] = ['read', 'connect']) {
    const identity = await verifier.authenticate(await request()); grants.set(account + ':' + identity.subject, permissions);
  }
  return { grants, verifier, policy, access, a, b, mcp, allow };
}
it('nega por padrão sem invocar leitura', async () => {
  const h = harness(); await expect(h.mcp(await request(), 'a', 'account')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(h.a).not.toHaveBeenCalled();
});
it('isola contas e identidades; não aceita conta indicada em query como concessão', async () => {
  const h = harness(); await h.allow('a');
  expect(await h.mcp(await request(), 'a', 'account')).toEqual({ account: 'a' });
  await expect(h.mcp(await request({}, '/internal/account?account=a'), 'b', 'account')).rejects.toThrow();
  await expect(h.mcp(await request({ sub: 'synthetic-viewer' }), 'a', 'account')).rejects.toThrow();
  expect(h.b).not.toHaveBeenCalled();
});
it('revoga imediatamente JWT ainda válido e falha de policy fecha acesso', async () => {
  const h = harness(); await h.allow('a'); const req = await request();
  await h.mcp(req, 'a', 'listings'); h.grants.clear();
  await expect(h.mcp(req, 'a', 'listings')).rejects.toThrow();
  h.policy.permissions.mockRejectedValueOnce(new Error('private'));
  await expect(h.mcp(req, 'a', 'listings')).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  expect(h.a).toHaveBeenCalledTimes(1);
});
it.each(['delete', 'write', 'proxy', 'oauth', '__proto__'])('nega ferramenta %s mesmo para administrador', async tool => {
  const h = harness(); await h.allow('a'); await expect(h.mcp(await request(), 'a', tool)).rejects.toThrow();
  expect(h.a).not.toHaveBeenCalled();
});
it.each([{ iss: 'https://other.cloudflareaccess.com' }, { aud: 'other' }, { exp: 1 }, { sub: 'unknown' }, { type: 'service' }])(
  'nega JWT inválido %j antes da policy', async claims => {
    const h = harness(); await expect(h.mcp(await request(claims), 'a', 'account')).rejects.toThrow();
    expect(h.policy.permissions).not.toHaveBeenCalled();
  });
it('nega cabeçalhos forjados, token adulterado e Bearer compartilhado', async () => {
  const h = harness(); await h.allow('a');
  for (const token of ['', 'invalid.jwt.signature']) {
    const req = new Request(config.publicOrigin, { headers: { 'Cf-Access-Jwt-Assertion': token,
      'Cf-Access-Authenticated-User-Email': 'admin@example.invalid', Authorization: 'Bearer synthetic' } });
    await expect(h.mcp(req, 'a', 'account')).rejects.toThrow();
  }
});
it('read não concede connect e conta desconhecida nunca recebe leitura', async () => {
  const h = harness(); await h.allow('a', ['read']);
  await expect(h.access.authenticate(await request(), 'a', 'connect')).rejects.toThrow();
  await h.allow('unknown'); await expect(h.mcp(await request(), 'unknown', 'account')).rejects.toThrow();
});
it.each(['success', 'revoke', 'wrong-cookie', 'other-account'])('callback B4 preserva consumo único e policy: %s', async mode => {
  const h = harness(); await h.allow(config.accountRef);
  const browser = browserHarness(); const connect = vi.fn(async () => {});
  const account = { browser: browser.service, tokens: { connect }, quota: vi.fn() } as unknown as LocalAccount;
  const router = localB4Router(config, h.verifier, h.access, account, 'SYNTHETIC_CLIENT');
  const identity = await h.verifier.authenticate(await request());
  const flow = await browser.service.begin(browser.startRequest(), identity);
  if (mode === 'revoke') h.grants.clear();
  if (mode === 'other-account') { h.grants.clear(); await h.allow('b'); }
  const callback = browser.callback(flow.state, mode === 'wrong-cookie' ? '__Host-conduz_oauth=' + 'x'.repeat(43) : flow.cookie);
  const response = await router(callback);
  expect(response.status).toBe(mode === 'success' ? 303 : 400);
  expect(connect).toHaveBeenCalledTimes(mode === 'success' ? 1 : 0);
  expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
  expect((await router(callback)).status).toBe(400);
  expect(globalThis.fetch).not.toHaveBeenCalled();
});
it('camada B4 protege saúde, OAuth e rotas desconhecidas antes dos serviços', async () => {
  const h = harness(); const account = {} as LocalAccount;
  const router = localB4Router(config, h.verifier, h.access, account, 'SYNTHETIC_CLIENT');
  for (const path of ['/internal/health', '/oauth/result', '/oauth/start', '/mcp', '/unknown']) {
    expect((await router(await request({}, path))).status).toBe(403);
  }
});
