import { jwtVerify, createRemoteJWKSet, customFetch, type JWTVerifyGetKey } from 'jose';
import { digest } from '../crypto';
import { AppError } from '../errors';
import { validatePreparationConfig, type PreparationConfig } from './config';

export interface OperatorIdentity {
  subject: string;
  role: 'administrator' | 'viewer';
  expiresAt: number;
}

// Resolver is supplied explicitly: B1 tests use generated, ephemeral public JWKS and never fetch Access.
export class AccessIdentityVerifier {
  constructor(private readonly config: PreparationConfig, private readonly resolver: JWTVerifyGetKey = preparedAccessResolver(config),
    private readonly now = Date.now) { validatePreparationConfig(config); }
  async authenticate(request: Request): Promise<OperatorIdentity> {
    const token = request.headers.get('Cf-Access-Jwt-Assertion');
    if (!token || token.length > 16384) throw this.denied();
    try {
      const { payload } = await jwtVerify(token, this.resolver, {
        issuer: this.config.accessIssuer, audience: this.config.accessAudience, algorithms: ['RS256'],
        requiredClaims: ['sub', 'iss', 'aud', 'exp', 'iat'], currentDate: new Date(this.now()), clockTolerance: 0
      });
      if (typeof payload.sub !== 'string' || typeof payload.exp !== 'number' || typeof payload.iat !== 'number'
        || payload.iat > Math.floor(this.now() / 1000) || payload.exp <= payload.iat
        || payload.exp - payload.iat > 3600 || payload.type !== 'app') throw this.denied();
      const role = Object.hasOwn(this.config.operatorRoles, payload.sub) ? this.config.operatorRoles[payload.sub] : undefined;
      if (role !== 'administrator' && role !== 'viewer') throw this.denied();
      return { subject: await digest(`${this.config.accessIssuer}\0${payload.sub}`), role, expiresAt: payload.exp * 1000 };
    } catch { throw this.denied(); }
  }
  private denied() { return new AppError('ACCESS_DENIED', 403, 'Identidade individual não autorizada.'); }
}

export function preparedAccessResolver(config: PreparationConfig): JWTVerifyGetKey {
  validatePreparationConfig(config);
  return createRemoteJWKSet(new URL(`${config.accessIssuer}/cdn-cgi/access/certs`), {
    timeoutDuration: 5000, cacheMaxAge: 300000, cooldownDuration: 30000,
    // Even Access JWKS retrieval is explicitly blocked in B1. Tests inject local public keys.
    [customFetch]: async () => { throw new AppError('JWKS_NETWORK_DISABLED', 503, 'Consulta de chaves remotas desativada nesta fase.'); }
  });
}
