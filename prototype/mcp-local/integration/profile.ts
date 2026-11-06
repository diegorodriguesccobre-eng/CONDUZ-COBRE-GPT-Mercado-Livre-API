import { createLocalJWKSet } from 'jose';
import { AccessIdentityVerifier } from '../../../src/preparation/access-identity';
import { AppError } from '../../../src/errors';
import { PRODUCTION_ORIGIN, PRODUCTION_REDIRECT_URI } from '../../../src/preparation/config';
import { ISSUER, AUDIENCE } from '../src/synthetic';
import { reject, IntegrationFailure, type IntegrationEnv, type Principal } from './contracts';

// An internal capability, never a JWT claim, binding string or MCP argument.
export type VerifiedIdentityPort = (request: Request, env: IntegrationEnv) => Promise<Principal>;
export interface IntegrationProfile {
  readonly mode: 'B4_I1_FICTIONAL_LOCAL_ONLY';
  readonly acceptsIngress: (request: Request) => boolean;
  readonly authenticate: VerifiedIdentityPort;
}
const profiles = new WeakSet<object>();
export function localVerifier(env: IntegrationEnv, now = Date.now) {
  return new AccessIdentityVerifier({ stage: 'production-preparation', transport: 'disabled', tenant: 'conduz_cobre',
    publicOrigin: PRODUCTION_ORIGIN, redirectUri: PRODUCTION_REDIRECT_URI, accessIssuer: ISSUER, accessAudience: AUDIENCE,
    operatorRoles: { 'synthetic-operator-a': 'viewer', 'synthetic-operator-b': 'viewer' }, accountRef: 'synthetic-local-only', expectedSellerId: '42'
  }, createLocalJWKSet(env.SYNTHETIC_JWKS), now);
}
// I1 provides a local seam only. HTTPS/remote identity profiles need a later authorization.
export function createLocalIntegrationProfile(authenticate: VerifiedIdentityPort = (request, env) => localVerifier(env).authenticate(request)): IntegrationProfile {
  if (typeof authenticate !== 'function') return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
  const profile: IntegrationProfile = Object.freeze({
    mode: 'B4_I1_FICTIONAL_LOCAL_ONLY',
    authenticate: async (request: Request, env: IntegrationEnv) => {
      try { return await authenticate(request, env); }
      catch (error) {
        if (error instanceof AppError && error.code === 'ACCESS_DENIED') return reject('INTEGRATION_IDENTITY_DENIED');
        if (error instanceof IntegrationFailure) throw error;
        return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
      }
    },
    acceptsIngress: (request: Request) => {
      const url = new URL(request.url);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && request.headers.get('Host') === url.host && !url.hash
        && (!request.headers.has('Origin') || request.headers.get('Origin') === url.origin);
    }
  });
  profiles.add(profile); return profile;
}
export function requireIntegrationProfile(profile: IntegrationProfile): void {
  if (!profile || !profiles.has(profile) || !Object.isFrozen(profile)) reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
}
export const LOCAL_INTEGRATION_PROFILE = createLocalIntegrationProfile();
