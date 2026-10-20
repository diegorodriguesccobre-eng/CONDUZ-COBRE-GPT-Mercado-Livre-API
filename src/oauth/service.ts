import { CryptoBox, digest, pkceChallenge, randomId } from '../crypto';
import { AppError, requireValue } from '../errors';
import { MercadoLivreClient, type TokenResponse } from '../mercado-livre/client';
import type { SyntheticTransport } from '../mercado-livre/synthetic-transport';
import { ACCOUNT_REF, SELLER_ID, type TokenRecord, type VaultStore } from '../types';

interface State { verifier: string; subject: string; expiresAt: number }
interface Cursor { offset: number; limit: number; account: string; expiresAt: number }

export class OAuthService {
  private renewal: Promise<TokenRecord> | undefined;
  private tail: Promise<unknown> = Promise.resolve();
  constructor(private readonly store: VaultStore, private readonly box: CryptoBox,
    private readonly client: MercadoLivreClient, private readonly provider: SyntheticTransport,
    private readonly redirect: string, private readonly now = Date.now) {}

  private exclusive<T>(work: () => Promise<T>): Promise<T> {
    const current = this.tail.then(work, work);
    this.tail = current.catch(() => undefined);
    return current;
  }

  async start(subject: string) {
    const state = randomId();
    const verifier = randomId();
    const challenge = await pkceChallenge(verifier);
    const expiresAt = this.now() + 300_000;
    this.store.putState(await digest(state), {
      ciphertext: await this.box.seal({ verifier, subject, expiresAt }, 'oauth-state'), expiresAt
    });
    const code = await this.provider.authorizationCode(challenge, this.redirect);
    // A deliberately non-resolving URL: B0 never redirects to a real authorization server.
    const params = new URLSearchParams({ response_type: 'code', client_id: 'SYNTHETIC_CLIENT_B0',
      redirect_uri: this.redirect, state, code_challenge: challenge, code_challenge_method: 'S256' });
    return { authorization_url: `https://oauth.synthetic.invalid/authorize?${params}`,
      synthetic_callback_path: `/internal/oauth/callback?${new URLSearchParams({ state, code })}`,
      expires_in: 300, pkce_method: 'S256' };
  }

  async complete(subject: string, state: string, code: string) {
    const row = this.store.takeState(await digest(state));
    if (!row || row.expiresAt <= this.now()) throw new AppError('STATE_INVALID', 400, 'State inválido, expirado ou já utilizado.');
    const flow = await this.box.open<State>(row.ciphertext, 'oauth-state');
    if (flow.subject !== subject || flow.expiresAt <= this.now()) throw new AppError('STATE_INVALID', 400, 'State inválido, expirado ou já utilizado.');
    return this.exclusive(async () => {
      const issued = await this.client.exchange(new URLSearchParams({ grant_type: 'authorization_code',
        code, redirect_uri: this.redirect, code_verifier: flow.verifier }));
      const account = await this.client.me(issued.access_token);
      requireValue(account.seller_id === SELLER_ID, 'SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
      const previous = await this.load(false);
      const record = this.record(issued, (previous?.generation ?? 0) + 1);
      await this.persist(record);
      return { connected: true, account_ref: ACCOUNT_REF, seller_id: SELLER_ID };
    });
  }

  private record(issued: TokenResponse, generation: number): TokenRecord {
    return { accessToken: issued.access_token, refreshToken: issued.refresh_token,
      expiresAt: this.now() + issued.expires_in * 1000, sellerId: SELLER_ID, generation };
  }
  private async persist(record: TokenRecord): Promise<void> {
    this.store.putTokens({ ciphertext: await this.box.seal(record, 'tokens'), status: 'ready' });
  }
  private async load(requireReady = true): Promise<TokenRecord | undefined> {
    const row = this.store.getTokens();
    if (!row) return undefined;
    if (requireReady && row.status !== 'ready') throw this.reconnect();
    const token = await this.box.open<TokenRecord>(row.ciphertext, 'tokens');
    requireValue(token.sellerId === SELLER_ID && Number.isSafeInteger(token.generation)
      && Number.isFinite(token.expiresAt) && typeof token.accessToken === 'string'
      && token.accessToken.startsWith('SYNTHETIC_ACCESS.') && typeof token.refreshToken === 'string'
      && token.refreshToken.startsWith('SYNTHETIC_REFRESH.'), 'TOKEN_INVALID', 409, 'Conexão sintética inválida.');
    return token;
  }
  private reconnect(): AppError { return new AppError('RECONNECT_REQUIRED', 409, 'Reconexão sintética necessária.'); }

  private refresh(observedGeneration: number): Promise<TokenRecord> {
    if (this.renewal) return this.renewal;
    this.renewal = this.exclusive(async () => {
      const current = await this.load();
      if (!current) throw this.reconnect();
      if (current.generation !== observedGeneration && current.expiresAt > this.now() + 30_000) return current;
      // Durable intent BEFORE exchange: a restart or uncertain result must not reuse an old refresh token.
      const row = this.store.getTokens();
      if (!row) throw this.reconnect();
      this.store.putTokens({ ciphertext: row.ciphertext, status: 'refreshing' });
      try {
        const issued = await this.client.exchange(new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refreshToken }));
        const next = this.record(issued, current.generation + 1);
        await this.persist(next);
        return next;
      } catch { throw this.reconnect(); } // Keep the durable refreshing marker. No blind retries.
    }).finally(() => { this.renewal = undefined; });
    return this.renewal;
  }

  async access<T>(use: (access: string) => Promise<T>): Promise<T> {
    let token = this.renewal ? await this.renewal : await this.load();
    if (!token) throw this.reconnect();
    if (token.expiresAt <= this.now() + 30_000) token = await this.refresh(token.generation);
    try { return await use(token.accessToken); }
    catch (error) {
      if (!(error instanceof AppError) || error.code !== 'UPSTREAM_UNAUTHORIZED') throw error;
      const renewed = await this.refresh(token.generation);
      return use(renewed.accessToken); // At most one replay of the read operation.
    }
  }

  account() { return this.access(token => this.client.me(token)); }
  listing(itemId: string) { return this.access(token => this.client.listing(token, itemId)); }
  async listings(limit: number, encodedCursor: string | null) {
    let offset = 0;
    if (encodedCursor) {
      try {
        const cursor = await this.box.open<Cursor>(decodeURIComponent(encodedCursor), 'listing-cursor');
        if (cursor.account !== ACCOUNT_REF || cursor.limit !== limit || cursor.expiresAt <= this.now()
          || !Number.isSafeInteger(cursor.offset) || cursor.offset < 0 || cursor.offset > 10000) throw new Error();
        offset = cursor.offset;
      } catch { throw new AppError('CURSOR_INVALID', 400, 'Cursor inválido ou expirado.'); }
    }
    return this.access(async token => {
      const page = await this.client.search(token, limit, offset);
      const listings = [];
      for (const id of page.ids) listings.push(await this.client.listing(token, id));
      const nextOffset = offset + page.ids.length;
      requireValue(page.ids.length > 0 || nextOffset >= page.total);
      const cursor = nextOffset < page.total ? encodeURIComponent(await this.box.seal({
        account: ACCOUNT_REF, offset: nextOffset, limit, expiresAt: this.now() + 300_000
      }, 'listing-cursor')) : null;
      return { items: listings, next_cursor: cursor, completeness: 'complete' };
    });
  }
}
