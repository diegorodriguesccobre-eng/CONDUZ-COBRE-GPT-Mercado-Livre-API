import { AppError } from '../errors';
import type { TokenRecord, VaultStore } from '../types';
import type { AuthorizationGrant } from '../preparation/real-http-transport';
import type { TokenKeyring } from './keyring';

export interface CandidateTokens { accessToken: string; refreshToken: string; expiresIn: number; sellerId: string }
export interface TokenProvider {
  exchange(grant: AuthorizationGrant): Promise<CandidateTokens>;
  refresh(refreshToken: string): Promise<CandidateTokens>;
  identity(accessToken: string): Promise<{ sellerId: string }>;
}

// One instance per account DO. Persistent 'refreshing' is a write-ahead marker:
// a crash or ambiguous provider/storage failure requires reauthorization, never reuse.
export class TokenCoordinator {
  private tail: Promise<unknown> = Promise.resolve();
  private quarantined = false;
  constructor(private readonly store: VaultStore, private readonly keys: TokenKeyring,
    private readonly provider: TokenProvider, private readonly seller: string, private readonly now = Date.now) {
    if (!/^[1-9]\d{0,14}$/.test(seller)) throw this.unavailable();
  }
  private exclusive<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.catch(() => undefined);
    return result;
  }
  private async validate(tokens: CandidateTokens, generation: number): Promise<TokenRecord> {
    if (!tokens || tokens.sellerId !== this.seller) throw new AppError('SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
    if (![tokens.accessToken, tokens.refreshToken].every(t => typeof t === 'string' && t.length > 0 && t.length <= 8192 && !/[\r\n]/.test(t))
      || !Number.isSafeInteger(tokens.expiresIn) || tokens.expiresIn < 60 || tokens.expiresIn > 86400) throw this.unavailable();
    const receivedAt = this.now();
    if ((await this.provider.identity(tokens.accessToken)).sellerId !== this.seller) {
      throw new AppError('SELLER_MISMATCH', 403, 'Vendedor não autorizado.');
    }
    if (receivedAt + tokens.expiresIn * 1000 <= this.now() + 30000) throw this.unavailable();
    return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, sellerId: this.seller,
      expiresAt: receivedAt + tokens.expiresIn * 1000, generation };
  }
  connect(grant: AuthorizationGrant): Promise<void> {
    return this.exclusive(async () => {
      try {
        // Refuse replacing an account silently; disconnect/reconnect is a separate reviewed operation.
        if (this.store.getTokens()) throw new AppError('REAUTH_REQUIRED', 409, 'Reconexão exige revisão do cofre.');
        const record = await this.validate(await this.provider.exchange(grant), 1);
        await this.save(record);
      } catch (error) { this.safe(error); }
    });
  }
  withAccess<T>(operation: (access: string) => Promise<T>): Promise<T> {
    return this.exclusive(async () => {
      try {
        if (this.quarantined) throw this.unavailable();
        const row = this.store.getTokens();
        if (!row || row.status !== 'ready') throw this.unavailable();
        let record = await this.keys.open<TokenRecord>(row.ciphertext);
        if (record.sellerId !== this.seller || !Number.isSafeInteger(record.generation) || record.generation < 1
          || !Number.isSafeInteger(record.expiresAt) || typeof record.accessToken !== 'string' || !record.accessToken
          || typeof record.refreshToken !== 'string' || !record.refreshToken) throw this.unavailable();
        if (record.expiresAt <= this.now() + 30000) {
          // Commit before the first await to the provider; recovery must not retry the old refresh token.
          this.store.putTokens({ ciphertext: row.ciphertext, status: 'refreshing' });
          try {
            record = await this.validate(await this.provider.refresh(record.refreshToken), record.generation + 1);
            await this.save(record);
          } catch { this.quarantined = true; throw this.unavailable(); }
        }
        return await operation(record.accessToken);
      } catch (error) { return this.safe(error); }
    });
  }
  revokeLocally(): Promise<void> {
    return this.exclusive(async () => {
      this.quarantined = true;
      try {
        const row = this.store.getTokens();
        if (row) this.store.putTokens({ ciphertext: row.ciphertext, status: 'refreshing' });
      } catch { throw this.unavailable(); }
    });
  }
  rotate(): Promise<void> {
    return this.exclusive(async () => {
      try {
        const row = this.store.getTokens();
        if (this.quarantined || !row || row.status !== 'ready') throw this.unavailable();
        await this.save(await this.keys.open<TokenRecord>(row.ciphertext));
      } catch (error) { this.safe(error); }
    });
  }
  private async save(record: TokenRecord) {
    const ciphertext = await this.keys.seal(record);
    try { this.store.putTokens({ ciphertext, status: 'ready' }); }
    catch { this.quarantined = true; throw this.unavailable(); }
  }
  private safe(error: unknown): never {
    if (error instanceof AppError && ['SELLER_MISMATCH', 'REAUTH_REQUIRED'].includes(error.code)) throw error;
    throw this.unavailable();
  }
  private unavailable() { return new AppError('REAUTH_REQUIRED', 503, 'Conexão indisponível; revisão necessária.'); }
}
