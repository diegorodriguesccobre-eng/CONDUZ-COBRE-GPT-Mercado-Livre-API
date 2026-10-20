import { DurableObject } from 'cloudflare:workers';
import { CryptoBox } from '../crypto';
import { SqliteStore } from '../vault/sqlite-store';
import type { OperatorIdentity } from './access-identity';
import { BrowserOAuthService, finishBrowserCallback } from './browser-oauth';
import { productionBlock, type PreparationConfig } from './config';

export interface PreparationEnv {
  PREPARATION_CONFIG: PreparationConfig;
  BROWSER_STATE_KEY_V1: string;
  BROWSER_OAUTH_VAULT: DurableObjectNamespace<BrowserOAuthVault>;
}
export class BrowserOAuthVault extends DurableObject<PreparationEnv> {
  private readonly store: SqliteStore;
  private readonly service: BrowserOAuthService;
  constructor(ctx: DurableObjectState, env: PreparationEnv) {
    super(ctx, env);
    this.store = new SqliteStore(ctx.storage);
    const config = env.PREPARATION_CONFIG;
    this.service = new BrowserOAuthService(this.store,
      new CryptoBox(env.BROWSER_STATE_KEY_V1, `${config.tenant}:${config.stage}:${config.accountRef}:browser-v1`), config);
  }
  async begin(request: Request, identity: OperatorIdentity) {
    this.store.quota(identity.subject);
    return this.service.begin(request, identity);
  }
  async callback(request: Request): Promise<Response> {
    this.store.quota('public-callback');
    return finishBrowserCallback(this.service, request, { exchangeAndValidate: async () => productionBlock() });
  }
}
