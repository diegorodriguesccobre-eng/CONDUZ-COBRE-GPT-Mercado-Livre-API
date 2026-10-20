import { beforeAll, describe, expect, it } from 'vitest';
import { createLocalJWKSet, exportJWK, generateKeyPair, SignJWT, type JWTVerifyGetKey } from 'jose';
import { AccessIdentityVerifier } from '../../src/preparation/access-identity';
import { preparationConfig } from './helpers';
let privateKey: CryptoKey; let resolver: JWTVerifyGetKey;
const now = 1800000000000;
beforeAll(async () => {
  const pair = await generateKeyPair('RS256'); privateKey = pair.privateKey;
  resolver = createLocalJWKSet({ keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', use: 'sig', kid: 'synthetic-key' }] });
});
async function assertion(overrides: Record<string, unknown> = {}) {
  return new SignJWT({ iss: preparationConfig.accessIssuer, aud: [preparationConfig.accessAudience], sub: 'synthetic-admin',
    iat: now / 1000 - 1, exp: now / 1000 + 300, type: 'app', ...overrides })
    .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-key' }).sign(privateKey);
}
const request = (token?: string) => new Request(preparationConfig.publicOrigin + '/internal/health', {
  headers: token ? { 'Cf-Access-Jwt-Assertion': token } : { Authorization: 'Bearer SYNTHETIC_SHARED_KEY_IS_NOT_AN_IDENTITY' }
});
describe('B1 identidade individual Cloudflare Access', () => {
  it('verifica assinatura, issuer, audience, tempo e role por sub', async () => {
    const verifier = new AccessIdentityVerifier(preparationConfig, resolver, () => now);
    const identity = await verifier.authenticate(request(await assertion()));
    expect(identity.role).toBe('administrator'); expect(identity.subject).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(identity.subject).not.toBe('synthetic-admin'); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('separa operadores e permite viewer sem elevá-lo a administrador', async () => {
    const verifier = new AccessIdentityVerifier(preparationConfig, resolver, () => now);
    const admin = await verifier.authenticate(request(await assertion()));
    const viewer = await verifier.authenticate(request(await assertion({ sub: 'synthetic-viewer' })));
    expect(viewer.role).toBe('viewer'); expect(viewer.subject).not.toBe(admin.subject);
  });
  it.each([
    { iss: 'https://other.cloudflareaccess.com' }, { aud: ['OTHER'] }, { exp: now / 1000 },
    { iat: now / 1000 + 1 }, { sub: 'not-in-policy' }, { type: 'service' }, { exp: now / 1000 + 7200 }, { exp: undefined }
  ])('recusa claims inválidos %j', async overrides => {
    await expect(new AccessIdentityVerifier(preparationConfig, resolver, () => now).authenticate(request(await assertion(overrides))))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('recusa assinatura alterada e ausência de JWT, sem confiar em Bearer compartilhado', async () => {
    const verifier = new AccessIdentityVerifier(preparationConfig, resolver, () => now);
    await expect(verifier.authenticate(request())).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const token = await assertion(); const parts = token.split('.'); parts[2] = (parts[2]![0] === 'A' ? 'B' : 'A') + parts[2]!.slice(1);
    await expect(verifier.authenticate(request(parts.join('.')))).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
  it('não aceita algoritmo none', async () => {
    const token = btoa(JSON.stringify({ alg: 'none' })) + '.' + btoa(JSON.stringify({ sub: 'synthetic-admin' })) + '.';
    await expect(new AccessIdentityVerifier(preparationConfig, resolver, () => now).authenticate(request(token)))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' });
  });
});

describe('B1 resolvedor preparado permanece offline', () => {
  it('resolvedor padrão nunca consulta JWKS remoto', async () => {
    await expect(new AccessIdentityVerifier(preparationConfig, undefined, () => now).authenticate(request(await assertion())))
      .rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
