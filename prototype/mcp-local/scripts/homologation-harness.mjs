import { Miniflare } from 'miniflare';
import { generateKeyPair } from 'jose';
import { randomBytes, randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startLocal } from './local-harness.mjs';
import { subjects, grantFor, approvalPlan, value, pairA, pairB } from './vault-harness.mjs';
import { registry, LOCAL_MODE, createBoundPorts } from '../work/homologation/ports-library.mjs';
export { pairA, pairB };
const project = fileURLToPath(new URL('..', import.meta.url));
const plain = input => input === undefined ? null : JSON.parse(JSON.stringify(input));
const backendObjects = {
  SYNTHETIC_VAULTS: { className: 'IntegratedVault', useSQLite: true, unsafeUniqueKey: 'c3-synthetic-vaults' },
  INTEGRATED_VAULTS: { className: 'IntegratedVault', useSQLite: true, unsafeUniqueKey: 'c3-synthetic-vaults' },
  GRANT_AUTHORITY: { className: 'RecoveryGuardian', useSQLite: true, unsafeUniqueKey: 'c3-restorable-guardian' },
  RECOVERY_REFERENCE: { className: 'RecoveryReference', useSQLite: true, unsafeUniqueKey: 'c3-reference' },
  RECOVERY_DATA: { className: 'RecoveryData', useSQLite: true, unsafeUniqueKey: 'c3-restorable-authority' },
  RECOVERY_PARTITIONS: { className: 'RecoveryPartition', useSQLite: true, unsafeUniqueKey: 'c3-restorable-projections' },
  INTEGRATION_IDENTITY: { className: 'IntegrationIdentity', useSQLite: true, unsafeUniqueKey: 'c3-ephemeral-identities' },
  INTEGRATION_CONTROL: { className: 'IntegrationControl', useSQLite: true, unsafeUniqueKey: 'c3-driver-control' }
};
// Node-only privileged test driver. Never imported by the public Worker build.
// The existing simulated approvals are laboratory inputs, not evidence of MFA or real quorum.
export async function createHomologationFixture() {
  const keyPair = await generateKeyPair('RS256');
  const materials = Object.fromEntries(['a','b'].map(s => ['account-' + s, {
    key: randomBytes(32).toString('base64url'),
    access: 'SYNTHETIC_ACCESS_' + s.toUpperCase() + '_' + randomUUID(),
    refresh: 'SYNTHETIC_REFRESH_' + s.toUpperCase() + '_' + randomUUID()
  }]));
  function assertRedacted(value) {
    const text = typeof value === 'string' ? value : JSON.stringify(value);
    if (Object.values(materials).flatMap(Object.values).some(secret => text.includes(secret))
      || /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/i.test(text)) throw new Error('HOMOLOGATION_CANARY_LEAK');
  }
  async function open({ path, enabled = true } = {}) {
    if (!path || !resolve(path).startsWith(resolve(project, 'work') + '/')) throw new Error('LOCAL_PRIVATE_STATE_REQUIRED');
    let runtime; let front; let frontRuntime;
    const backend = await startLocal({}, {
      createKeyPair: async () => keyPair,
      configureRuntime: options => ({ ...options, scriptPath: resolve(project, 'work/homologation/backend.mjs'),
        resourcePersistencePath: path, durableObjects: backendObjects,
        bindings: { ...options.bindings, SYNTHETIC_POLICY: 'persistent', SYNTHETIC_VAULT_MATERIAL: materials } }),
      createRuntime: options => { runtime = new Miniflare(options); return runtime; }
    });
    try {
      const stub = async (binding, name) => {
        const ns = await runtime.getDurableObjectNamespace(binding); return ns.get(ns.idFromName(name));
      };
      const g = await stub('GRANT_AUTHORITY', 'synthetic-security-authority');
      const w = await stub('RECOVERY_REFERENCE', 'trusted-reference');
      const a = await stub('RECOVERY_DATA', 'restorable-authority');
      const pa = await stub('RECOVERY_PARTITIONS', 'account-a'), pb = await stub('RECOVERY_PARTITIONS', 'account-b');
      const ids = await stub('INTEGRATION_IDENTITY', 'local-identity-authority');
      const ctl = await stub('INTEGRATION_CONTROL', 'local-integration-control');
      const vaults = { 'account-a': await stub('INTEGRATED_VAULTS', 'synthetic-vault-a'),
        'account-b': await stub('INTEGRATED_VAULTS', 'synthetic-vault-b') };
      const stores = { guardian: g, reference: w, authority: a, 'account-a': pa, 'account-b': pb };
      const faults = new Map(), trace = [], tasks = new Set(), shutdown = new AbortController();
      let swapped = false;
      const account = value => { if (!Object.hasOwn(vaults, value)) throw new Error('UNREGISTERED_LOCAL_ACCOUNT'); return value; };
      const bindingsFor = async name => {
        const r = await registry(await ctl.snapshot()); const wanted = swapped && name === 'account-a' ? 'account-b' : account(name);
        return r.entries.find(e => e.account === wanted);
      };
      const methods = {
        identity: {
          issue: input => ids.issue(input),
          lookup: ({ input, consume }) => ids.lookup(input, consume),
          cancel: handle => ids.cancel(handle)
        },
        registry: {
          snapshot: async () => { const s = await ctl.snapshot(); return { revision: s.revision, deadlineMs: s.deadlineMs }; },
          resolve: bindingsFor, barrier: input => ctl.barrier(input), event: input => ctl.event(input)
        },
        reference: {
          current: () => w.current(),
          permissions: ({ pair, required }) => { account(pair.account); if (required !== 'read') throw new Error('READ_ONLY_PORT'); return g.permissions(pair, required); }
        },
        vaults: {
          execute: ({ account: name, command }) => vaults[account(name)].execute(command),
          assertPrepared: ({ account: name, prepared }) => vaults[account(name)].assertPrepared(prepared)
        }
      };
      const bridge = port => async request => {
        let record;
        const operation = (async () => {
          try {
            const u = new URL(request.url), parts = u.pathname.split('/');
            record = { port, method: parts[2] ?? 'invalid', origin: u.origin, started: Date.now(), durationMs: null, result: 'pending' };
            if (trace.length < 8192) trace.push(record);
            if (request.method !== 'POST' || u.origin !== 'https://m1-ports.invalid' || u.search
              || parts.length !== 3 || parts[1] !== port || !Object.hasOwn(methods[port], parts[2])) throw new Error('CLOSED_LOCAL_PORT');
            const body = await request.json();
            if (!body || Object.keys(body).join() !== 'args') throw new Error('CLOSED_LOCAL_ENVELOPE');
            const fault = faults.get(port);
            if (fault === 'timeout') await new Promise(resolve => {
              let timer; const done = () => { clearTimeout(timer); shutdown.signal.removeEventListener('abort', done); resolve(); };
              timer = setTimeout(done, 2000); shutdown.signal.addEventListener('abort', done, { once: true });
            });
            if (fault) throw new Error('PRIVATE_INJECTED_' + fault);
            const response = Response.json({ ok: true, value: plain(await methods[port][parts[2]](body.args)) });
            record.result = 'completed'; return response;
          } catch { if (record) record.result = 'unavailable'; return Response.json({ ok: false }, { status: 503 }); }
          finally { if (record) record.durationMs = Date.now() - record.started; }
        })();
        tasks.add(operation);
        try { return await operation; } finally { tasks.delete(operation); }
      };
      front = await startLocal({}, {
        createKeyPair: async () => keyPair,
        createRuntime: options => { frontRuntime = new Miniflare(options); return frontRuntime; },
        configureRuntime: options => ({ ...options, scriptPath: resolve(project, 'work/homologation/worker.mjs'),
          bindings: { HML_MODE: enabled ? LOCAL_MODE : 'DISABLED', HML_JWKS: backend.jwks, HML_MATERIAL: materials },
          serviceBindings: { HML_IDENTITY: bridge('identity'), HML_REGISTRY: bridge('registry'),
            HML_REFERENCE: bridge('reference'), HML_VAULTS: bridge('vaults') } })
      });
      const head = () => value(w.rpc('current'));
      const mutate = async (kind, pair = pairA, extra = {}) => {
        const h = await head(), anchor = h.state.anchors.find(x => x.account === pair.account && x.subject === pair.subject);
        return value(g.rpc('mutate', { operationId: randomUUID(), expectedSeq: h.state.seq,
          expectedRevision: anchor?.revision ?? 0, kind, ...pair, actor: 'sim-security', ...extra }));
      };
      const release = async () => { await ctl.fixture({ kind: 'configure', value: { pauseAt: '' } }); await ctl.fixture({ kind: 'release' }); };
      let closing;
      const close = () => closing ??= (async () => {
        shutdown.abort(); let releaseError;
        try { await release(); } catch (e) { releaseError = e; }
        const results = await Promise.allSettled([front.close(), backend.close(), ...tasks]);
        const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
        if (releaseError) errors.push(releaseError);
        if (errors.length) throw new AggregateError(errors, 'HOMOLOGATION_CLEANUP_FAILED');
      })();
      const driver = Object.freeze({
        configuration: async () => {
          const input = await frontRuntime.getBindings();
          try { createBoundPorts(input); return { valid: true, names: Object.keys(input) }; }
          catch (e) { return { valid: false, names: Object.keys(input), name: e.name,
            issues: e.issues?.map(v => ({ path: v.path, code: v.code })) }; }
        },
        administrativeEvidence: 'LOCAL_SIMULATION_NOT_REAL_MFA_OR_QUORUM',
        provision: async () => {
          await value(g.rpc('enrollReference', { environment: 'synthetic-r2', enrollment: 'synthetic-r2-enrollment-v1',
            protocol: 1, seq: 0, operators: subjects.map(subject => ({ subject, enabled: true, revision: 1 })),
            accounts: ['account-a','account-b'].map(account => ({ account, partition: account })), anchors: [] }));
          await value(g.rpc('recover', approvalPlan(await head())));
          await mutate('grant', pairA, { grant: grantFor('a') }); await mutate('grant', pairB, { grant: grantFor('b') });
        },
        seed: async () => { for (const name of ['account-a','account-b']) await vaults[name].fixture({ kind: 'seed', account: name }); },
        revoke: (pair = pairA) => mutate('revoke', pair),
        connectOnly: () => mutate('grant', pairA, { grant: grantFor('a', { revision: 2, permissions: ['connect'] }) }),
        configure: value => ctl.fixture({ kind: 'configure', value }), release,
        waiting: () => ctl.fixture({ kind: 'waiting' }), head,
        events: () => ctl.fixture({ kind: 'events' }),
        tokenState: (name = 'account-a') => vaults[account(name)].fixture({ kind: 'snapshot' }),
        tokenRecord: value => vaults['account-a'].fixture({ kind: 'record', value }),
        vaultFault: fault => vaults['account-a'].fixture({ kind: 'fault', value: fault }),
        swapRegistry: value => { swapped = value; },
        portFault: (port, fault) => {
          if (!Object.hasOwn(methods, port) || !['ECONNRESET','ETIMEDOUT','unavailable','timeout',''].includes(fault)) throw new Error('CLOSED_LOCAL_FAULT');
          fault ? faults.set(port, fault) : faults.delete(port);
        },
        snapshot: async (names = ['guardian','authority','account-a','account-b']) =>
          Object.fromEntries(await Promise.all(names.map(async n => [n, plain(await stores[n].fixture({ kind: 'dump' }))]))),
        restore: async dump => { for (const [n,v] of Object.entries(dump)) await stores[n].fixture({ kind: 'restore', value: v }); },
        trace: () => [...trace]
      });
      return { ...front, close, driver, assertRedacted, urls: [front.url, backend.url],
        resources: () => ({ front: front.resources(), backend: backend.resources(), portTasks: tasks.size }),
        outboundAttempts: () => front.outboundAttempts() + backend.outboundAttempts() };
    } catch (failure) {
      const results = await Promise.allSettled([front?.close(), backend.close()]);
      const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
      if (errors.length) throw new AggregateError([failure,...errors], 'HOMOLOGATION_START_CLEANUP_FAILED');
      throw failure;
    }
  }
  return Object.freeze({ open });
}
