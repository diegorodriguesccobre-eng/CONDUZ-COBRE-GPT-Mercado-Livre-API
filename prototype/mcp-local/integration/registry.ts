import { z } from 'zod';
import { digest } from '../../../src/crypto';
import { VAULTS, type Account } from '../vault/model';
import { SCOPE, canonical, reject, control, type IntegrationEnv, type ControlState } from './contracts';
const entry = z.strictObject({ account: z.enum(['account-a', 'account-b']), seller: z.string().regex(/^[1-9]\d{0,14}$/),
  vault: z.string().regex(/^[a-z0-9-]{1,64}$/), keyId: z.string().regex(/^[a-z0-9-]{1,32}$/),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1), policy: z.literal('synthetic-read-v1'),
  environment: z.literal('synthetic-r2') });
export type Binding = Readonly<z.infer<typeof entry>>;
export interface Registry { readonly revision: number; readonly digest: string; readonly entries: readonly Binding[] }
export async function registry(state: ControlState): Promise<Registry> {
  if (!Number.isSafeInteger(state.revision) || state.revision < 1) return reject('INTEGRATION_BINDING_DENIED');
  const source: { account: Account; seller: string; vault: string; keyId: string; revision: number; policy: string; environment: string }[] = Object.values(VAULTS).map(v => ({ account: v.account, seller: v.seller, vault: v.vault,
    keyId: v.keyId, revision: state.revision, policy: 'synthetic-read-v1', environment: SCOPE.environment }));
  // Privileged local fault input, never a client selector.
  if (state.registryFault === 'swap') source[0] = { ...source[1]!, account: 'account-a' };
  if (state.registryFault === 'corrupt') source[0] = { ...source[0]!, seller: 'invalid' };
  let entries: Binding[];
  try { entries = source.map(v => Object.freeze(entry.parse(v))); } catch { return reject('INTEGRATION_BINDING_DENIED'); }
  for (const field of ['account', 'seller', 'vault', 'keyId'] as const) if (new Set(entries.map(v => v[field])).size !== 2) return reject('INTEGRATION_BINDING_DENIED');
  for (const v of entries) { const expected = VAULTS[v.account];
    if (v.seller !== expected.seller || v.vault !== expected.vault || v.keyId !== expected.keyId) return reject('INTEGRATION_BINDING_DENIED'); }
  const frozen = Object.freeze([...entries]);
  return Object.freeze({ revision: state.revision, digest: await digest(canonical({ scope: SCOPE, revision: state.revision, entries: frozen })), entries: frozen });
}
export async function resolve(env: IntegrationEnv, account: Account) {
  const snapshot = await registry(await control(env).snapshot());
  const binding = snapshot.entries.find(e => e.account === account); if (!binding) return reject('INTEGRATION_BINDING_DENIED');
  return Object.freeze({ snapshot, binding, bindingDigest: await digest(canonical(binding)) });
}
