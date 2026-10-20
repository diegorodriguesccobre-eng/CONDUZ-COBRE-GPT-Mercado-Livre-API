import { DurableObject } from 'cloudflare:workers';
import { validateConfig } from '../config';
import { CryptoBox } from '../crypto';
import { failure } from '../errors';
import { MercadoLivreClient } from '../mercado-livre/client';
import { SyntheticTransport } from '../mercado-livre/synthetic-transport';
import { OAuthService } from '../oauth/service';
import { ACCOUNT_REF, type Action, type Env, type Result } from '../types';
import { SqliteStore } from './sqlite-store';

export class AccountVault extends DurableObject<Env> {
  private readonly store: SqliteStore;
  private readonly service: OAuthService;
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    validateConfig(env);
    const box = new CryptoBox(env.TOKEN_ENCRYPTION_KEY, `conduz_cobre:${env.APP_ENV}:${ACCOUNT_REF}`);
    this.store = new SqliteStore(ctx.storage);
    const transport = new SyntheticTransport(box);
    this.service = new OAuthService(this.store, box, new MercadoLivreClient(transport), transport, env.OAUTH_REDIRECT_URI);
  }
  async dispatch(action: Action): Promise<Result> {
    try {
      this.store.quota(action.subject);
      let data: unknown;
      switch (action.operation) {
        case 'oauth.start': data = await this.service.start(action.subject); break;
        case 'oauth.callback': data = await this.service.complete(action.subject, action.state, action.code); break;
        case 'account': data = await this.service.account(); break;
        case 'listings': data = await this.service.listings(action.limit, action.cursor); break;
        case 'listing': data = await this.service.listing(action.itemId); break;
      }
      return { ok: true, data: JSON.stringify(data) };
    } catch (error) { return { ok: false, error: failure(error) }; }
  }
}
