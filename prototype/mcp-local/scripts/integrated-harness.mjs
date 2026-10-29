import { Miniflare } from 'miniflare';
import { startLocal } from './local-harness.mjs';
import { subjects, grantFor, approvalPlan, value, pairA, pairB } from './vault-harness.mjs';
export { subjects, grantFor, pairA, pairB };
const plain = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

// Privileged test driver. Registry/state/material are supplied explicitly; serving never calls provision/seed.
export async function startIntegration({ path, keyPair, materials, configure = {}, fetch } = {}) {
  if (!path || !keyPair || !materials) throw new Error('EXPLICIT_LOCAL_INTEGRATION_INPUT_REQUIRED');
  let runtime;
  const local = await startLocal({}, {
    ...(fetch ? { fetch } : {}), createKeyPair: async () => keyPair,
    configureRuntime: options => ({ ...options, scriptPath: 'work/integrated-worker.mjs', resourcePersistencePath: path,
      bindings: { ...options.bindings, SYNTHETIC_POLICY: 'persistent', SYNTHETIC_VAULT_MATERIAL: materials },
      durableObjects: {
        SYNTHETIC_VAULTS: { className: 'IntegratedVault', useSQLite: true, unsafeUniqueKey: 'c3-synthetic-vaults' },
        INTEGRATED_VAULTS: { className: 'IntegratedVault', useSQLite: true, unsafeUniqueKey: 'c3-synthetic-vaults' },
        GRANT_AUTHORITY: { className: 'RecoveryGuardian', useSQLite: true, unsafeUniqueKey: 'c3-restorable-guardian' },
        RECOVERY_REFERENCE: { className: 'RecoveryReference', useSQLite: true, unsafeUniqueKey: 'c3-reference' },
        RECOVERY_DATA: { className: 'RecoveryData', useSQLite: true, unsafeUniqueKey: 'c3-restorable-authority' },
        RECOVERY_PARTITIONS: { className: 'RecoveryPartition', useSQLite: true, unsafeUniqueKey: 'c3-restorable-projections' },
        INTEGRATION_IDENTITY: { className: 'IntegrationIdentity', useSQLite: true, unsafeUniqueKey: 'c3-ephemeral-identities' },
        INTEGRATION_CONTROL: { className: 'IntegrationControl', useSQLite: true, unsafeUniqueKey: 'c3-driver-control' }
      } }), createRuntime: options => { runtime = new Miniflare(options); return runtime; }
  });
  try {
    const stub = async (binding, name) => { const n = await runtime.getDurableObjectNamespace(binding); return n.get(n.idFromName(name)); };
    const g = await stub('GRANT_AUTHORITY', 'synthetic-security-authority');
    const w = await stub('RECOVERY_REFERENCE', 'trusted-reference');
    const a = await stub('RECOVERY_DATA', 'restorable-authority');
    const pa = await stub('RECOVERY_PARTITIONS', 'account-a'), pb = await stub('RECOVERY_PARTITIONS', 'account-b');
    const ctl = await stub('INTEGRATION_CONTROL', 'local-integration-control');
    const ids = await stub('INTEGRATION_IDENTITY', 'local-identity-authority');
    const raw = { guardian: g, reference: w, authority: a, 'account-a': pa, 'account-b': pb };
    const stores = Object.fromEntries(Object.entries(raw).map(([name, store]) => [name, Object.fromEntries(
      ['fixture', 'events', 'rpc', 'view', 'install', 'read', 'hold', 'permissions'].map(method => [method, async (...args) => plain(await store[method](...args))]))]));
    const vaults = { 'account-a': await stub('INTEGRATED_VAULTS', 'synthetic-vault-a'), 'account-b': await stub('INTEGRATED_VAULTS', 'synthetic-vault-b') };
    const oldNames = await runtime.getDurableObjectNamespace('SYNTHETIC_VAULTS');
    const newNames = await runtime.getDurableObjectNamespace('INTEGRATED_VAULTS');
    if (oldNames.idFromName('synthetic-vault-a').toString() !== newNames.idFromName('synthetic-vault-a').toString()) throw new Error('VAULT_ALIAS_MISMATCH');
    const vault = account => {
      if (!Object.hasOwn(vaults, account)) throw new Error('UNREGISTERED_SYNTHETIC_ACCOUNT');
      const v = vaults[account]; return { execute: async input => plain(await v.execute(input)),
        fixture: async input => plain(await v.fixture(input)), assertPrepared: async input => plain(await v.assertPrepared(input)) };
    };
    const head = () => value(w.rpc('current'));
    const recover = async plan => value(g.rpc('recover', plan ?? approvalPlan(await head())));
    const change = async (kind, pair = pairA, overrides = {}) => {
      const h = await head(); const anchor = h.state.anchors.find(v => v.account === pair.account && v.subject === pair.subject);
      return value(g.rpc('mutate', { operationId: crypto.randomUUID(), expectedSeq: h.state.seq,
        expectedRevision: kind === 'operator' ? h.state.operators.find(o => o.subject === pair.subject).revision : anchor?.revision ?? 0,
        kind, ...pair, actor: 'sim-security', ...overrides }));
    };
    const provision = async () => {
      await value(g.rpc('enrollReference', { environment: 'synthetic-r2', enrollment: 'synthetic-r2-enrollment-v1', protocol: 1,
        seq: 0, operators: subjects.map(subject => ({ subject, enabled: true, revision: 1 })),
        accounts: ['account-a', 'account-b'].map(account => ({ account, partition: account })), anchors: [] }));
      await recover(); await change('grant', pairA, { grant: grantFor('a') }); await change('grant', pairB, { grant: grantFor('b') });
    };
    const snapshot = async (names = ['guardian', 'authority', 'account-a', 'account-b']) => {
      const dump = {}; for (const name of names) dump[name] = await stores[name].fixture({ kind: 'dump' }); return dump;
    };
    const restore = async dump => { for (const [name, body] of Object.entries(dump)) await stores[name].fixture({ kind: 'restore', value: body }); };
    const configureControl = async value => { await ctl.fixture({ kind: 'configure', value }); };
    await configureControl(configure);
    return { ...local, stores, head, recover, change, provision, snapshot, restore, vault,
      seedVaults: async () => { for (const account of ['account-a', 'account-b']) await vault(account).fixture({ kind: 'seed', account }); },
      fault: async (name, value) => { await stores[name].fixture({ kind: 'fault', value }); },
      configure: configureControl,
      release: async () => { await configureControl({ pauseAt: '' }); await ctl.fixture({ kind: 'release' }); },
      waiting: async () => plain(await ctl.fixture({ kind: 'waiting' })),
      events: async () => plain(await ctl.fixture({ kind: 'events' })),
      identityFixture: async input => plain(await ids.fixture(input)),
      issueIdentity: async (assertion, commandDigest) => plain(await ids.issue({ assertion, commandDigest })),
      inspect: () => value(g.rpc('inspect')), status: id => value(w.rpc('status', id))
    };
  } catch (error) {
    try { await local.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'INTEGRATION_START_CLEANUP_FAILED'); }
    throw error;
  }
}
