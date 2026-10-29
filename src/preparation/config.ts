import { AppError } from '../errors';

// Source-level interlock: neither environment variables nor a saved template can enable real traffic.
export const PRODUCTION_ORIGIN = 'https://conduz-cobre-ml-api.conduz-cobre.workers.dev';
export const CALLBACK_PATH = '/oauth/mercadolivre/callback';
export const PRODUCTION_REDIRECT_URI = `${PRODUCTION_ORIGIN}${CALLBACK_PATH}`;
export const LIVE_TRANSPORT_ENABLED = false;
export const PRODUCTION_OAUTH_ENABLED = false;
export interface PreparationConfig {
  stage: 'production-preparation';
  transport: 'disabled';
  tenant: 'conduz_cobre';
  publicOrigin: string;
  redirectUri: string;
  accessIssuer: string;
  accessAudience: string;
  operatorRoles: Readonly<Record<string, 'administrator' | 'viewer'>>;
  accountRef: string;
  expectedSellerId: string;
}
export function validatePreparationConfig(config: PreparationConfig): void {
  const invalid = () => new AppError('PREPARATION_CONFIG_INVALID', 503, 'Configuração de preparação inválida.');
  if (config.stage !== 'production-preparation' || config.transport !== 'disabled' || config.tenant !== 'conduz_cobre') throw invalid();
  let origin: URL; let callback: URL; let issuer: URL;
  try { origin = new URL(config.publicOrigin); callback = new URL(config.redirectUri); issuer = new URL(config.accessIssuer); }
  catch { throw invalid(); }
  if (origin.protocol !== 'https:' || origin.origin !== config.publicOrigin || origin.username || origin.password
    || origin.origin !== PRODUCTION_ORIGIN || origin.port || origin.hostname === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(origin.hostname)
    || origin.hostname.includes(':') || callback.href !== `${origin.origin}${CALLBACK_PATH}`
    || issuer.protocol !== 'https:' || issuer.origin !== config.accessIssuer || issuer.port || issuer.username || issuer.password
    || !/^[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer.hostname)
    || !/^[A-Za-z0-9_-]{8,128}$/.test(config.accessAudience)
    || !/^[a-z0-9-]{3,64}$/.test(config.accountRef)
    || !/^[1-9]\d{0,14}$/.test(config.expectedSellerId)
    || !config.operatorRoles || Object.keys(config.operatorRoles).length < 1
    || Object.entries(config.operatorRoles).some(([sub, role]) => !/^[A-Za-z0-9_-]{3,128}$/.test(sub)
      || !['administrator', 'viewer'].includes(role))) throw invalid();
}
export function productionBlock(): never {
  throw new AppError('PRODUCTION_DISABLED', 503, 'OAuth de produção bloqueado nesta fase.');
}
