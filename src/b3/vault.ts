import { DurableObject } from 'cloudflare:workers';
import { CryptoBox } from '../crypto';
import { SqliteStore } from '../vault/sqlite-store';
import { AccessIdentityVerifier } from '../preparation/access-identity';
import { BrowserOAuthService } from '../preparation/browser-oauth';
import { PreparedReadClient } from '../preparation/prepared-read-client';
import { productionBlock, validatePreparationConfig, type PreparationConfig } from '../preparation/config';
import { TokenKeyring } from './keyring';
import { TokenCoordinator, type TokenProvider } from './token-service';
import { localB3Router } from './router';

export interface B3Env {
  B3_CONFIG: PreparationConfig;
  B3_STATE_KEY: string;
  B3_ACTIVE_KEY_ID: string;
  B3_TOKEN_KEYS: Record<string, string>;
  B3_VAULT: DurableObjectNamespace<B3AccountVault>;
}
// New class => separate SQLite namespace, no B0/B1 migration or data reuse.
export class B3AccountVault extends DurableObject<B3Env> {
  private readonly handle: (request: Request) => Promise<Response>;
  constructor(ctx: DurableObjectState, env: B3Env) {
    super(ctx, env);
    validatePreparationConfig(env.B3_CONFIG);
    const config = env.B3_CONFIG;
    const store = new SqliteStore(ctx.storage);
    const context = `conduz_cobre:b3-local:${config.accountRef}`;
    const disabled: TokenProvider = { exchange: async () => productionBlock(), refresh: async () => productionBlock(), identity: async () => productionBlock() };
    this.handle = localB3Router(config, new AccessIdentityVerifier(config), {
      browser: new BrowserOAuthService(store, new CryptoBox(env.B3_STATE_KEY, `${context}:state`), config),
      tokens: new TokenCoordinator(store, new TokenKeyring(env.B3_ACTIVE_KEY_ID, env.B3_TOKEN_KEYS, context), disabled, config.expectedSellerId),
      reads: new PreparedReadClient(config.expectedSellerId), quota: subject => store.quota(subject)
    }, 'SYNTHETIC_B3_DISABLED_CLIENT');
  }
  fetch(request: Request) { return this.handle(request); }
}
