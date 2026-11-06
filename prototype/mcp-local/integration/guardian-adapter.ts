import { headSchema, fingerprint, type ReferenceHead } from '../recovery/core';
import { commandHash, current, reject, IntegrationFailure } from './contracts';
import { control, type Command, type IntegrationEnv, type Principal } from './contracts';
import { resolve } from './registry';

export interface GuardPin { seq: number; root: string; gateRevision: number }
export const pinOf = (h: ReferenceHead): GuardPin => ({ seq: h.state.seq, root: h.root, gateRevision: h.gateRevision });
export async function check(env: IntegrationEnv, c: Command, principal: Principal, expected?: GuardPin): Promise<GuardPin> {
  current(c);
  if (principal.subject !== c.subject || principal.expiresAt !== c.identityExpiresAt || await commandHash(c) !== c.commandDigest) return reject('INTEGRATION_BINDING_DENIED');
  const reg = await resolve(env, c.account);
  if (reg.snapshot.digest !== c.registryDigest || reg.bindingDigest !== c.bindingDigest) return reject('INTEGRATION_REVISION_CHANGED');
  const w = env.RECOVERY_REFERENCE.get(env.RECOVERY_REFERENCE.idFromName('trusted-reference'));
  const ns = env.GRANT_AUTHORITY; if (!ns) return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
  let before: ReferenceHead, after: ReferenceHead, permissions: readonly string[];
  try {
    before = headSchema.parse(await w.current());
    if (before.root !== await fingerprint(before.state)) return reject('INTEGRATION_RECOVERY_REQUIRED');
    permissions = await ns.get(ns.idFromName('synthetic-security-authority')).permissions({ account: c.account, subject: c.subject }, 'read');
    after = headSchema.parse(await w.current());
    if (after.root !== await fingerprint(after.state)) return reject('INTEGRATION_RECOVERY_REQUIRED');
  } catch (e) { if (e instanceof IntegrationFailure) throw e; return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE'); }
  if (before.gate !== 'ACTIVE' || after.gate !== 'ACTIVE' || before.pending || after.pending) return reject('INTEGRATION_RECOVERY_REQUIRED');
  const pin = pinOf(after);
  if (JSON.stringify(pinOf(before)) !== JSON.stringify(pin) || (expected && JSON.stringify(expected) !== JSON.stringify(pin))) return reject('INTEGRATION_REVISION_CHANGED');
  current(c);
  const operator = after.state.operators.find(o => o.subject === c.subject);
  const anchor = after.state.anchors.find(a => a.subject === c.subject && a.account === c.account);
  const grant = anchor?.status === 'active' ? anchor.grant : undefined;
  if (!operator?.enabled || !grant || grant.validFrom > Date.now() || grant.validUntil <= Date.now() || !grant.permissions.includes('read')) return reject('INTEGRATION_READ_DENIED');
  if (!permissions.includes('read')) return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
  await control(env).event({ phase: 'guard-allow', operationId: c.operationId, account: c.account, seq: pin.seq });
  // Audit is before the final check. A mutation during the audit must not relabel an old allow.
  const finalRegistry = await resolve(env, c.account);
  if (finalRegistry.snapshot.digest !== c.registryDigest || finalRegistry.bindingDigest !== c.bindingDigest) return reject('INTEGRATION_REVISION_CHANGED');
  const final = headSchema.parse(await w.current());
  if (final.gate !== 'ACTIVE' || JSON.stringify(pinOf(final)) !== JSON.stringify(pin)) return reject('INTEGRATION_REVISION_CHANGED');
  current(c);
  if (grant.validUntil <= Date.now() || grant.validFrom > Date.now()) return reject('INTEGRATION_READ_DENIED');
  return pin;
}
