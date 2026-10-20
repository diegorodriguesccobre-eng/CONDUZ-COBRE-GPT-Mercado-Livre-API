import { CryptoBox, base64url } from '../src/crypto';
import { MercadoLivreClient } from '../src/mercado-livre/client';
import { SyntheticTransport, type HttpTransport } from '../src/mercado-livre/synthetic-transport';
import { OAuthService } from '../src/oauth/service';
import { ACCOUNT_REF, type StateRow, type TokenRow, type VaultStore } from '../src/types';

// Deterministic TEST-ONLY local key; never a real credential.
export const TEST_KEY = base64url(new Uint8Array(32).fill(7));
export const TEST_AUTH = 'SYNTHETIC_TEST_OPERATOR_NOT_A_REAL_CREDENTIAL_0001';
export const REDIRECT = 'http://localhost:8787/internal/oauth/callback';
export const CONTEXT = `conduz_cobre:b0-local:${ACCOUNT_REF}`;
export class MemoryStore implements VaultStore {
  states = new Map<string, StateRow>();
  tokens: TokenRow | undefined;
  putState(key: string, row: StateRow) { this.states.set(key, { ...row }); }
  takeState(key: string) { const row = this.states.get(key); this.states.delete(key); return row; }
  getTokens() { return this.tokens ? { ...this.tokens } : undefined; }
  putTokens(row: TokenRow) { this.tokens = { ...row }; }
}
export function harness(wrap: (provider: SyntheticTransport) => HttpTransport = p => p) {
  const clock = { now: 1_800_000_000_000 };
  const now = () => clock.now;
  const store = new MemoryStore();
  const box = new CryptoBox(TEST_KEY, CONTEXT);
  const provider = new SyntheticTransport(box, now);
  const client = new MercadoLivreClient(wrap(provider));
  const service = new OAuthService(store, box, client, provider, REDIRECT, now);
  const connect = async () => {
    const start = await service.start('test-operator');
    const callback = new URL(start.synthetic_callback_path, 'http://localhost');
    return service.complete('test-operator', callback.searchParams.get('state')!, callback.searchParams.get('code')!);
  };
  return { clock, store, box, provider, client, service, connect, now };
}
