import { z } from 'zod';
import { createLocalJWKSet } from 'jose';
import { AccessIdentityVerifier } from '../../../src/preparation/access-identity';
import { PRODUCTION_ORIGIN, PRODUCTION_REDIRECT_URI } from '../../../src/preparation/config';
import { ISSUER, AUDIENCE } from '../src/synthetic';

export const IDENTITY_MODE = 'I2_IDENTITY_FICTIONAL_LOCAL_ONLY';
export const IDENTITY_NAME = 'local-identity-authority';
const publicKeys = z.strictObject({ keys: z.array(z.strictObject({
  kty: z.literal('RSA'), alg: z.literal('RS256'), use: z.literal('sig'),
  kid: z.literal('synthetic-ephemeral'), n: z.string().regex(/^[\w-]{300,1000}$/), e: z.literal('AQAB')
})).length(1) });
export function identityVerifier(input: unknown) {
  const value = z.strictObject({ I2_MODE: z.literal(IDENTITY_MODE), I2_JWKS: publicKeys,
    I2_IDENTITIES: z.custom<DurableObjectNamespace>(v => !!v && typeof v === 'object'
      && typeof (v as DurableObjectNamespace).idFromName === 'function'
      && typeof (v as DurableObjectNamespace).get === 'function') }).parse(input);
  // Same synthetic issuer, audience, operators and signature policy as I1.
  // No remote key resolver, new role, account selector or production switch.
  return new AccessIdentityVerifier({ stage: 'production-preparation', transport: 'disabled', tenant: 'conduz_cobre',
    publicOrigin: PRODUCTION_ORIGIN, redirectUri: PRODUCTION_REDIRECT_URI, accessIssuer: ISSUER, accessAudience: AUDIENCE,
    operatorRoles: { 'synthetic-operator-a': 'viewer', 'synthetic-operator-b': 'viewer' },
    accountRef: 'synthetic-local-only', expectedSellerId: '42'
  }, createLocalJWKSet(value.I2_JWKS));
}
