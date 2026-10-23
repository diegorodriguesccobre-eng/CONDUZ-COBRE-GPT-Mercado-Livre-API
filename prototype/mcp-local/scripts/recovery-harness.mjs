import { Miniflare } from 'miniflare';
import { randomUUID } from 'node:crypto';
import { startLocal } from './local-harness.mjs';
import { subjects, grantFor } from './persistent-harness.mjs';
export { subjects, grantFor };
export const pairA = { account: 'account-a', subject: subjects[0] };
export const pairB = { account: 'account-b', subject: subjects[1] };
export const environment = 'synthetic-r2';
export const enrollment = 'synthetic-r2-enrollment-v1';
const expectedCodes = /^(REVISION_CONFLICT|INVALID_MUTATION|UNREGISTERED_PAIR|COUNTER_EXHAUSTED|TERMINAL_REVOCATION|RECOVERY_REQUIRED|SIMULATED_QUORUM_REQUIRED|IDEMPOTENCY_CONFLICT|REPLAY|CORRUPT_OR_INVALID|ALREADY_ENROLLED|UNSAFE_BOOTSTRAP|INCOMPLETE_RECOVERY|REFERENCE_CORRUPT|REFERENCE_REGRESSION|REFERENCE_BUSY|UNAVAILABLE|QUOTA|INJECTED_[a-z-]+)$/;
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
export async function value(promise) {
  const r = await promise; // Transport errors propagate without normalization.
  if (r?.ok === true && Object.keys(r).every(k => ['ok', 'value'].includes(k))) return plain(r.value);
  if (r?.ok === false && Object.keys(r).sort().join(',') === 'code,ok' && expectedCodes.test(r.code)) {
    const error = new Error(r.code); error.name = 'SyntheticRecoveryError'; error.code = r.code; throw error;
  }
  throw new Error('INVALID_RECOVERY_ENVELOPE');
}
export function approvalPlan(head, overrides = {}) {
  return { operationId: randomUUID(), nonce: randomUUID(), expectedSeq: head.state.seq, expectedGate: head.gateRevision,
    root: head.root, environment, enrollment, approvals: [
      { person: 'sim-proposer', role: 'proposer', simulatedMfa: true, at: Date.now() },
      { person: 'sim-reviewer', role: 'reviewer', simulatedMfa: true, at: Date.now() }
    ], ...overrides };
}
export async function startRecovery({ path, keyPair } = {}) {
  if (!path) throw new Error('EXPLICIT_RECOVERY_PATH_REQUIRED');
  let mf;
  const local = await startLocal({}, {
    ...(keyPair ? { createKeyPair: async () => keyPair } : {}),
    configureRuntime: options => ({ ...options, scriptPath: 'work/recovery-worker.mjs',
      bindings: { ...options.bindings, SYNTHETIC_POLICY: 'persistent' }, resourcePersistencePath: path,
      durableObjects: {
        GRANT_AUTHORITY: { className: 'RecoveryGuardian', useSQLite: true, unsafeUniqueKey: 'r2-restorable-guardian' },
        RECOVERY_REFERENCE: { className: 'RecoveryReference', useSQLite: true, unsafeUniqueKey: 'r2-trusted-reference' },
        RECOVERY_DATA: { className: 'RecoveryData', useSQLite: true, unsafeUniqueKey: 'r2-restorable-authority' },
        RECOVERY_PARTITIONS: { className: 'RecoveryPartition', useSQLite: true, unsafeUniqueKey: 'r2-restorable-projections' }
      } }),
    createRuntime: options => { mf = new Miniflare(options); return mf; }
  });
  try {
    const stub = async (binding, name) => { const ns = await mf.getDurableObjectNamespace(binding); return ns.get(ns.idFromName(name)); };
    const g = await stub('GRANT_AUTHORITY', 'synthetic-security-authority');
    const w = await stub('RECOVERY_REFERENCE', 'trusted-reference');
    const a = await stub('RECOVERY_DATA', 'restorable-authority');
    const pa = await stub('RECOVERY_PARTITIONS', 'account-a'); const pb = await stub('RECOVERY_PARTITIONS', 'account-b');
    const rawStores = { guardian: g, reference: w, authority: a, 'account-a': pa, 'account-b': pb };
    // Miniflare returns live RPC proxies; fixture edits must use detached JSON snapshots.
    const stores = Object.fromEntries(Object.entries(rawStores).map(([name, raw]) => [name, Object.fromEntries(
      ['fixture', 'events', 'rpc', 'view', 'install', 'read', 'hold', 'permissions'].map(method => [method, async (...args) => plain(await raw[method](...args))]))]));
    const head = () => value(w.rpc('current'));
    const recover = async (plan) => value(g.rpc('recover', plan ?? approvalPlan(await head())));
    const mutate = input => value(g.rpc('mutate', input));
    const change = async (kind, pair = pairA, overrides = {}) => {
      const h = await head(); const anchor = h.state.anchors.find(a => a.account === pair.account && a.subject === pair.subject);
      return mutate({ operationId: randomUUID(), expectedSeq: h.state.seq,
        expectedRevision: kind === 'operator' ? h.state.operators.find(o => o.subject === pair.subject).revision : anchor?.revision ?? 0,
        kind, ...pair, actor: 'sim-security', ...overrides });
    };
    async function provision() {
      const state = { environment, enrollment, protocol: 1, seq: 0,
        operators: subjects.map(subject => ({ subject, enabled: true, revision: 1 })),
        accounts: ['account-a', 'account-b'].map(account => ({ account, partition: account })), anchors: [] };
      await value(g.rpc('enrollReference', state)); await recover();
      for (const suffix of ['a', 'b']) await change('grant', suffix === 'a' ? pairA : pairB, { grant: grantFor(suffix) });
    }
    const snapshot = async (names = ['guardian', 'authority', 'account-a', 'account-b']) => {
      const dump = {}; for (const name of names) dump[name] = await stores[name].fixture({ kind: 'dump' }); return dump;
    };
    const restore = async dump => { for (const [name, body] of Object.entries(dump)) await stores[name].fixture({ kind: 'restore', value: body }); };
    const fault = (name, setting) => stores[name].fixture({ kind: 'fault', value: setting });
    return { ...local, stores, head, recover, mutate, change, provision, snapshot, restore, fault,
      inspect: () => value(g.rpc('inspect')), status: id => value(w.rpc('status', id)),
      proof: (pair = pairA, overrides = {}) => ({ ...pair, required: 'read', nonce: randomUUID(), environment, enrollment, protocol: 1, ...overrides }) };
  } catch (failure) {
    try { await local.close(); } catch (cleanup) { throw new AggregateError([failure, cleanup], 'RECOVERY_START_CLEANUP_FAILED'); }
    throw failure;
  }
}
