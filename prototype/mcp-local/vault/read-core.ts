// Shared local-only read core extracted from SyntheticAccountVault; no fixture or write operations.
import { z } from 'zod';
import { TokenKeyring } from '../../../src/b3/keyring';
import { TokenCoordinator, type TokenProvider } from '../../../src/b3/token-service';
import { CandidateAdapter } from '../../../src/b3/adapter';
import { digest } from '../../../src/crypto';
import type { TokenRecord, VaultStore } from '../../../src/types';
import type { HttpTransport } from '../../../src/mercado-livre/synthetic-transport';
import { VAULTS, materialSchema, requestSchema, type Account } from './model';
export class ReadTokenFailure extends Error { constructor() { super('SYNTHETIC_VAULT_DENIED'); } }
const fail = (): never => { throw new ReadTokenFailure(); };
const recordSchema = z.strictObject({ accessToken: z.string(), refreshToken: z.string(), sellerId: z.string(),
  expiresAt: z.number().int().positive(), generation: z.number().int().positive() });
export interface TokenCheckpoint { account: Account; keyId: string; rowDigest: string; generation: number; expiresAt: number }
export type ReadPhase = 'identity-checked' | 'token-opened' | 'before-provider' | 'after-provider' | 'prepared' | 'after-audit';
export class ReadDependencyFailure extends Error {
  constructor(readonly kind: 'transport' | 'timeout') { super('INTEGRATION_DEPENDENCY_UNAVAILABLE'); }
}
export interface ReadHooks { deadlineAt?: number; phase(name: ReadPhase, stamp?: TokenCheckpoint): Promise<void>; failed(error: unknown): void }
export async function tokenCheckpoint(store: VaultStore, keys: TokenKeyring, account: Account): Promise<TokenCheckpoint> {
  const row = store.getTokens(); if (!row || row.status !== 'ready') return fail();
  const record = recordSchema.parse(await keys.open<TokenRecord>(row.ciphertext));
  if (record.sellerId !== VAULTS[account].seller || record.expiresAt <= Date.now() + 30000) return fail();
  const rowDigest = await digest(JSON.stringify(row));
  if (JSON.stringify(row) !== JSON.stringify(store.getTokens())) return fail();
  return { account, keyId: VAULTS[account].keyId, rowDigest, generation: record.generation, expiresAt: record.expiresAt };
}
interface Ports {
  store: VaultStore; hooks: ReadHooks | undefined;
  checkStorage(): void; binding(account: Account): { account: Account; seller: string; vault: string; keyId: string; numeric: readonly string[]; legacy: readonly string[]; version: number };
  storedAccount(): unknown; storedIdentity(): unknown; keys(account: Account): TokenKeyring;
  authorize(request: z.infer<typeof requestSchema>): Promise<void>; consumeNonce(nonce: string): Promise<void>;
  materials(): unknown; transport(account: Account): HttpTransport;
}
export async function readVaultCore(r: z.infer<typeof requestSchema>, p: Ports): Promise<{ data: Record<string, unknown>; stamp: TokenCheckpoint | undefined }> {
  const account = r.account;
        p.checkStorage(); const expected = p.binding(account);
        if (p.storedAccount() !== account) fail();
        const keys = p.keys(account);
        const identity = await keys.open<unknown>(String(p.storedIdentity()));
        if (JSON.stringify(identity) !== JSON.stringify(expected)) fail();
        await p.authorize(r);
        if (p.hooks) await p.hooks.phase('identity-checked');
        await p.consumeNonce(r.nonce);
        p.checkStorage(); const row = p.store.getTokens(); if (!row || row.status !== 'ready') return fail();
        const record = recordSchema.parse(await keys.open<TokenRecord>(row.ciphertext));
        if (record.sellerId !== expected.seller || record.expiresAt <= Date.now() + 30000) fail();
        const m = materialSchema.parse(p.materials())[account];
        if (record.accessToken !== m.access || record.refreshToken !== m.refresh) fail();
        const stamp = p.hooks ? await tokenCheckpoint(p.store, keys, account) : undefined;
        if (p.hooks) await p.hooks.phase('token-opened', stamp);
        const transport = { send: async (request: Request) => {
          if (p.hooks) await p.hooks.phase('before-provider', stamp);
          let timer: ReturnType<typeof setTimeout> | undefined;
          let response: Response;
          try {
            if (!p.hooks) response = await p.transport(account).send(request);
            else response = await Promise.race([p.transport(account).send(request), new Promise<never>((_, reject) => {
              timer = setTimeout(() => reject(new ReadDependencyFailure('timeout')), Math.max(1, Math.min(10000, (p.hooks!.deadlineAt ?? Date.now() + 10000) - Date.now())));
            })]);
          } catch (error) {
            if (p.hooks) {
              const failure = error instanceof ReadDependencyFailure ? error : new ReadDependencyFailure('transport');
              // Capture a closed local cause before the inherited adapter sanitizes the exception.
              p.hooks.failed(failure); throw failure;
            }
            throw error;
          }
          finally { if (timer) clearTimeout(timer); }
          if (p.hooks) await p.hooks.phase('after-provider', stamp);
          return response;
        } };
        const readonlyStore: VaultStore = { getTokens: () => { p.checkStorage(); return p.store.getTokens(); },
          putTokens: () => fail(), putState: () => fail(), takeState: () => fail() };
        const adapter = new CandidateAdapter(expected.seller, 'SYNTHETIC_DISABLED', 'SYNTHETIC_DISABLED', transport);
        // withAccess may refresh by design in B3.1. The immutable facade rejects its write-ahead marker
        // before it can reach refresh; this prototype never offers connect/refresh/rotate to an operator.
        const disabled: TokenProvider = { exchange: async () => fail(), refresh: async () => fail(), identity: t => adapter.identity(t) };
        const coordinator = new TokenCoordinator(readonlyStore, keys, disabled, expected.seller);
        const data = await coordinator.withAccess(async token => {
          try {
          const me = await adapter.identity(token); // Search has no seller in its draft response: bind identity first.
          if (r.operation === 'account') return { account_ref: account, nickname: me.nickname, site: me.siteId };
          if (r.operation === 'listing') {
            const index = expected.legacy.findIndex(x => x === r.itemId); if (index < 0) return fail();
            const item = await adapter.reads.item(token, expected.numeric[index]!);
            if (item.status !== 'active') return fail();
            return { item_id: r.itemId!, title: item.title, status: 'active', price: item.price };
          }
          const found = await adapter.reads.listings(token, r.limit!, r.offset!);
          if (found.total > 2) return fail();
          const ids: string[] = [];
          for (const id of found.ids) {
            const index = expected.numeric.findIndex(x => x === id); if (index < 0) return fail();
            await adapter.reads.item(token, id); // Independently validates seller for every returned ID.
            ids.push(expected.legacy[index]!);
          }
          return { ids, total: found.total, next_offset: r.offset! + r.limit! < found.total ? r.offset! + r.limit! : null };
          } catch (error) {
            if (error instanceof ReadTokenFailure) p.hooks?.failed(error);
            throw error;
          }
        });
        p.checkStorage();
        if (JSON.stringify(p.store.getTokens()) !== JSON.stringify(row)) fail();
        await p.authorize(r); // Revocation/expiry while awaiting the adapter cannot release a result.
        const serialized = JSON.stringify(data);
        const secrets = Object.values(materialSchema.parse(p.materials())).flatMap(v => [v.key, v.access, v.refresh]);
        if (secrets.some(s => serialized.includes(s)) || /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/i.test(serialized)) fail();
        if (p.hooks) await p.hooks.phase('prepared', stamp);
        return { data, stamp };
}
