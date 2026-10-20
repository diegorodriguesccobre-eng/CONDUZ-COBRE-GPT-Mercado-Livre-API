import { AppError } from './errors';
import { SELLER_ID, type Env } from './types';

export function validateConfig(env: Env): void {
  // No live transport, seller selection or remote environment can be enabled in B0.
  if (env.TRANSPORT !== 'synthetic' || env.APP_ENV !== 'b0-local' || env.EXPECTED_SELLER_ID !== SELLER_ID
    || typeof env.INTERNAL_AUTH_KEY !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(env.INTERNAL_AUTH_KEY)
    || typeof env.TOKEN_ENCRYPTION_KEY !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(env.TOKEN_ENCRYPTION_KEY)
    || !/^http:\/\/(localhost|127\.0\.0\.1):8787\/internal\/oauth\/callback$/.test(env.OAUTH_REDIRECT_URI)) {
    throw new AppError('CONFIG_INVALID', 503, 'Configuração B0 inválida.');
  }
}
