import type { AccountVault } from './vault/account-vault';

export const SELLER_ID = 'SELLER_CONDUZ_SYNTHETIC';
export const ACCOUNT_REF = 'conduz-cobre-b0';
export const SCHEMA_VERSION = '1.0.0';

export interface Env {
  TRANSPORT: string;
  APP_ENV: string;
  EXPECTED_SELLER_ID: string;
  OAUTH_REDIRECT_URI: string;
  INTERNAL_AUTH_KEY: string;
  TOKEN_ENCRYPTION_KEY: string;
  ACCOUNT_VAULT: DurableObjectNamespace<AccountVault>;
}

export interface TokenRecord {
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  sellerId: string;
  generation: number;
}

export interface TokenRow { ciphertext: string; status: 'ready' | 'refreshing' }
export interface StateRow { ciphertext: string; expiresAt: number }

export interface VaultStore {
  putState(hash: string, value: StateRow): void;
  takeState(hash: string): StateRow | undefined;
  getTokens(): TokenRow | undefined;
  putTokens(row: TokenRow): void;
}

export type Action =
  | { operation: 'oauth.start'; subject: string }
  | { operation: 'oauth.callback'; subject: string; state: string; code: string }
  | { operation: 'account'; subject: string }
  | { operation: 'listings'; subject: string; limit: number; cursor: string | null }
  | { operation: 'listing'; subject: string; itemId: string };

export type Failure = { code: string; message: string; retryable: boolean; status: number };
export type Result = { ok: true; data: string } | { ok: false; error: Failure };

export interface Listing {
  item_id: string;
  title: string;
  status: 'active' | 'paused';
  price: { amount: string; currency: 'BRL' };
  available_quantity: number;
}
