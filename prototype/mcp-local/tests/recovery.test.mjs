import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile, readdir, cp } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { generateKeyPair } from 'jose';
import { startRecovery, pairA, pairB, subjects, grantFor, approvalPlan, value } from '../scripts/recovery-harness.mjs';
import { dataOf } from '../scripts/local-harness.mjs';
import { expectReadDenied, expectInvalidArguments, expectUnknownTool } from '../scripts/rejections.mjs';
import { expectSingleCasWinner } from './fixtures/concurrency-assertions.mjs';
await import('../scripts/build-recovery.mjs');
const coverage = [];
const raceEvidence = [];
async function portClosed(url) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    const timer = setTimeout(() => finish(new Error('RECOVERY_PORT_PROBE_TIMEOUT')), 1000);
    const finish = error => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(); };
    socket.once('connect', () => finish(new Error('RECOVERY_PORT_LEFT_OPEN')));
    socket.once('error', e => finish(e.code === 'ECONNREFUSED' ? undefined : e));
  });
}
async function setup(t, provision = true) {
  const directory = await mkdtemp(resolve('work/recovery-')); const path = join(directory, 'state');
  const keyPair = await generateKeyPair('RS256'); const handles = new Set();
  const open = async () => { const h = await startRecovery({ path, keyPair }); handles.add(h); return h; };
  t.after(async () => {
    try {
      await Promise.all([...handles].map(h => h.close()));
      for (const h of handles) {
        assert.equal(h.outboundAttempts(), 0); assert.deepEqual(h.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
        await portClosed(h.url);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const h = await open(); if (provision) await h.provision(); return { h, open, directory };
}
async function read(h, account = 'account-a', suffix = 'a', mode = { pin: '2026-07-28' }) {
  const c = await h.connect(`synthetic-operator-${suffix}`, mode);
  try { const r = await c.callTool({ name: 'account', arguments: { account_ref: account } });
    assert.equal(r.isError, undefined); assert.equal(dataOf(r).data.account_ref, account); return r;
  } finally { await c.close(); }
}
async function denied(h, account = 'account-a', suffix = 'a') {
  const c = await h.connect(`synthetic-operator-${suffix}`);
  try { await expectReadDenied(c, 'account', { account_ref: account }); } finally { await c.close(); }
}
const rejects = (op, code) => assert.rejects(op, e => e.name === 'SyntheticRecoveryError' && e.code === code);
const latch = async (h, mode) => assert.equal((await h.inspect()).latch?.mode, mode);
async function setHead(h, change) {
  const head = await h.head(); change(head); await h.stores.reference.fixture({ kind: 'set', key: 'head', value: head });
}
async function liveProof(h, overrides = {}) {
  const request = h.proof(pairA, overrides); const view = await h.stores.authority.view(); const projection = await h.stores['account-a'].read(pairA);
  return { request, view, projection };
}
const referenceDecision = (h, proof) => value(h.stores.reference.rpc('decision', proof));
// Assertions inspect the durable result as well as the Promise result. They do not mutate the model.
async function assertCommittedRace(h, before, requests, outcome, results) {
  const after = await h.head(); const winner = requests[outcome.winner]; const decisions = [];
  assert.equal(after.state.seq, before.state.seq + 1);
  assert.equal(after.gate, 'ACTIVE'); assert.equal(after.pending, null);
  assert.deepEqual(results[outcome.winner].value.state, after.state);
  const status = await h.status(winner.operationId);
  assert.equal(status.confirmed, true); assert.equal(status.sequence, after.state.seq);
  assert.equal(await h.status(requests[outcome.loser].operationId), null, 'Losing operation must not reserve or commit state');
  assert.deepEqual(await h.stores.authority.view(), after.state);
  for (const pair of [pairA, pairB]) {
    const anchor = after.state.anchors.find(a => a.account === pair.account && a.subject === pair.subject);
    const previous = before.state.anchors.find(a => a.account === pair.account && a.subject === pair.subject);
    if (pair.account === winner.account && pair.subject === winner.subject) {
      assert.equal(anchor.revision, winner.expectedRevision + 1);
      assert.equal(anchor.status, winner.kind === 'revoke' ? 'revoked' : 'active');
      assert.deepEqual(anchor.grant, winner.kind === 'revoke' ? null : winner.grant);
    } else assert.deepEqual(anchor, previous, 'Unrelated account grant must remain intact');
    const permissions = anchor.status === 'active' ? anchor.grant.permissions : [];
    if (anchor.status === 'active') assert.deepEqual(await h.stores[pair.account].read(pair), anchor.grant);
    for (const permission of ['read', 'connect']) {
      const observed = await h.stores.guardian.permissions(pair, permission);
      assert.deepEqual(observed, permissions.includes(permission) ? permissions : []);
      decisions.push({ account: pair.account, required: permission, granted: observed });
    }
    const suffix = pair.account.at(-1);
    if (permissions.includes('read')) await read(h, pair.account, suffix); else await denied(h, pair.account, suffix);
  }
  await denied(h, 'account-b', 'a'); await denied(h, 'account-a', 'b');
  assert.deepEqual((await h.head()).state, after.state, 'Authorization queries must not create another security revision');
  raceEvidence.push({ caseId: outcome.caseId, kind: winner.kind, winnerAccount: winner.account,
    winnerRevision: winner.expectedRevision + 1, losingResult: outcome.conflict,
    beforeSequence: before.state.seq, persistedSequence: after.state.seq, root: after.root,
    confirmed: status.confirmed, losingOperationAbsent: true, authoritativeViewMatches: true, decisions });
  return after;
}
function updateRace(before) {
  const grant = grantFor('a', { revision: 2 });
  return [['read'], ['connect']].map(permissions => ({ operationId: randomUUID(), expectedSeq: before.state.seq,
    expectedRevision: 1, kind: 'grant', ...pairA, actor: 'sim-security', grant: { ...grant, permissions } }));
}
function revokeRace(before) {
  return [pairA, pairB].map(pair => ({ operationId: randomUUID(), expectedSeq: before.state.seq,
    expectedRevision: 1, kind: 'revoke', ...pair, actor: 'sim-security' }));
}
function check(id, name, fn, scope = 'LOCAL') {
  const caseId = typeof id === 'string' ? id : `R1-${String(id).padStart(2, '0')}`;
  it(`${caseId}: ${name}`, { timeout: 30000 }, async t => {
    await fn(t); coverage.push({ id: caseId, result: 'PASS', scope, test: name });
  });
}

check(1, 'two operators, three tools, both MCP profiles', async t => {
  const { h } = await setup(t);
  for (const [profile, mode] of [['2026-07-28', { pin: '2026-07-28' }], ['2025-11-25', 'legacy']]) for (const suffix of ['a', 'b']) {
    const c = await h.connect(`synthetic-operator-${suffix}`, mode);
    try {
      assert.equal(c.getNegotiatedProtocolVersion(), profile);
      assert.deepEqual((await c.listTools()).tools.map(t => t.name).sort(), ['account', 'listing', 'listings']);
      for (const name of ['account', 'listings', 'listing']) {
        const args = { account_ref: `account-${suffix}`, ...(name === 'listing' ? { item_id: `MLB_SYNTH_${suffix.toUpperCase()}_001` } : {}) };
        assert.equal(dataOf(await c.callTool({ name, arguments: args })).untrusted_data, true);
      }
    } finally { await c.close(); }
  }
});
check(2, 'cross-account and identifier tampering denied', async t => {
  const { h } = await setup(t); await denied(h, 'account-b', 'a'); await denied(h, 'account-a', 'b');
  const c = await h.connect(); try {
    await expectReadDenied(c, 'listing', { account_ref: 'account-a', item_id: 'MLB_SYNTH_B_001' });
    await expectInvalidArguments(c, 'account', { account_ref: 'account-a', seller_id: 'other', subject: subjects[1] });
  } finally { await c.close(); }
});
check(3, 'read/connect are independent and do not imply administration', async t => {
  const { h } = await setup(t);
  await h.change('grant', pairA, { grant: grantFor('a', { revision: 2, permissions: ['connect'] }) }); await denied(h);
  assert.deepEqual(await h.stores.guardian.permissions(pairA, 'connect'), ['connect']);
  const c = await h.connect(); try { await expectUnknownTool(c, 'recover'); } finally { await c.close(); }
});
check(4, 'confirmed revocation survives two runtime restarts and valid JWT', async t => {
  const { h, open } = await setup(t); const token = await h.assertion(); await h.change('revoke'); let current = h;
  for (let n = 0; n < 2; n++) {
    await current.close(); current = await open(); await denied(current);
    const response = await current.raw({ token, headers: { 'MCP-Protocol-Version': '2025-11-25' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: { account_ref: 'account-a' } } } });
    assert.equal(response.status, 200); assert.match(await response.text(), /SYNTHETIC_READ_DENIED/);
  }
});
check(5, 'joint rollback of authority and projections, W preserved', async t => {
  const { h, open } = await setup(t); const snapshot = await h.snapshot(['authority', 'account-a', 'account-b']);
  await h.change('revoke'); await h.restore(snapshot); await h.close(); const restarted = await open();
  await denied(restarted); assert.equal((await restarted.head()).gate, 'HOLD'); await latch(restarted, 'RECOVERY_REQUIRED');
});
check(6, 'projection rollback cannot override terminal tombstone', async t => {
  const { h } = await setup(t); const snapshot = await h.snapshot(['account-a']); await h.change('revoke'); await h.restore(snapshot);
  await denied(h); assert.equal((await h.head()).state.anchors.find(a => a.subject === pairA.subject).status, 'revoked'); await read(h, 'account-b', 'b');
});
check(7, 'partial authority operator/account rollback detected', async t => {
  const { h } = await setup(t); await h.change('operator', pairA, { enabled: false });
  const s = await h.stores.authority.view(); s.operators[0].enabled = true; await h.stores.authority.install(s);
  await denied(h); assert.equal((await h.head()).reason, 'STATE_DIVERGENCE');
});
check(8, 'guardian rollback cannot override live reference', async t => {
  const { h } = await setup(t); const snapshot = await h.snapshot(['guardian']); await h.change('revoke'); await h.restore(snapshot); await denied(h);
  assert.equal((await h.head()).state.seq, 3);
});
check(9, 'rollback G+A+P remains denied with W current', async t => {
  const { h, open } = await setup(t); const snapshot = await h.snapshot(); await h.change('revoke'); await h.restore(snapshot);
  await h.close(); const restarted = await open(); await denied(restarted); assert.equal((await restarted.head()).gate, 'HOLD');
});
check(10, 'ACTIVE/READY marker cannot authorize stale state', async t => {
  const { h } = await setup(t); const snapshot = await h.snapshot(); await h.change('revoke'); await h.restore(snapshot);
  const i = (await h.inspect()).identity; i.mode = 'READY'; await h.stores.guardian.fixture({ kind: 'set', key: 'identity', value: i });
  await denied(h); await latch(h, 'RECOVERY_REQUIRED');
});
check(11, 'deleted guardian does not bootstrap', async t => {
  const { h } = await setup(t); await h.stores.guardian.fixture({ kind: 'restore', value: { rows: [], events: [] } });
  await denied(h); await latch(h, 'RECOVERY_REQUIRED'); assert.equal((await h.inspect()).identity, undefined);
});
check(12, 'enrollment substitution is rejected', async t => {
  const { h } = await setup(t); const i = (await h.inspect()).identity; i.enrollment = 'replacement';
  await h.stores.guardian.fixture({ kind: 'set', key: 'identity', value: i }); await denied(h);
});
check(13, 'legitimate guardian cold start resumes by current proof', async t => {
  const { h, open } = await setup(t); await read(h); await h.close(); const current = await open(); await read(current); await latch(current, 'READY');
});
check(14, 'legitimate authority restart preserves explicit grants only', async t => {
  const { h, open } = await setup(t); const before = await h.head(); await h.close(); const current = await open(); await read(current);
  assert.deepEqual((await current.head()).state, before.state);
});
check(15, 'sequence regression and same-sequence digest tampering fail', async t => {
  const { h } = await setup(t); const s = await h.stores.authority.view(); s.seq--; await h.stores.authority.install(s); await denied(h);
  await h.recover(); const same = await h.stores.authority.view(); same.operators[0].enabled = false; await h.stores.authority.install(same); await denied(h);
});
check(16, 'reference outage denies even warmed clients and persists latch', async t => {
  const { h, open } = await setup(t); await read(h); await h.fault('reference', 'unavailable'); await denied(h); await latch(h, 'UNAVAILABLE');
  await h.close(); const current = await open(); await denied(current); await latch(current, 'UNAVAILABLE');
});
check(17, 'quota failures cannot cause allow or disable audit', async t => {
  const { h } = await setup(t); await h.fault('reference', 'quota'); await denied(h); await latch(h, 'UNAVAILABLE');
});
check(18, 'malformed projection JSON fails closed without repair', async t => {
  const { h } = await setup(t); await h.stores['account-a'].fixture({ kind: 'corrupt', key: pairA.subject }); await denied(h); await latch(h, 'RECOVERY_REQUIRED');
}, 'LOCAL: corrupção lógica identificada; páginas SQLite reais dependem de teste separado');
check(19, 'authority corruption cannot seed missing operators', async t => {
  const { h } = await setup(t); await h.stores.authority.fixture({ kind: 'corrupt', key: 'state' }); await denied(h);
  await latch(h, 'RECOVERY_REQUIRED'); assert.equal((await h.head()).gate, 'HOLD');
});
check(20, 'guardian identity corruption remains blocked across restart', async t => {
  const { h, open } = await setup(t); await h.stores.guardian.fixture({ kind: 'corrupt', key: 'identity' }); await denied(h);
  await h.close(); const current = await open(); await denied(current); await latch(current, 'RECOVERY_REQUIRED');
});
check(21, 'authentic old coherent snapshot is not current', async t => {
  const { h } = await setup(t); const snapshot = await h.snapshot(); await h.change('operator', pairA, { enabled: false }); await h.restore(snapshot);
  await denied(h); assert.equal((await h.head()).reason, 'STATE_DIVERGENCE');
});
check(22, 'concurrent updates require a classified conflict, durable winner and exact permissions', async t => {
  const { h, open } = await setup(t); const before = await h.head(); const requests = updateRace(before);
  const results = await Promise.allSettled(requests.map(input => h.mutate(input)));
  const outcome = { ...expectSingleCasWinner(results), caseId: 'R1-22' };
  const committed = await assertCommittedRace(h, before, requests, outcome, results);
  await h.close(); const restarted = await open();
  assert.deepEqual(await restarted.head(), committed);
  await assertCommittedRace(restarted, before, requests, outcome, results);
});
check(23, 'revocation competing with an update cannot be undone by late finalization', async t => {
  const { h } = await setup(t); const before = await h.head(); const operationId = randomUUID();
  const update = { operationId, expectedSeq: before.state.seq, expectedRevision: 1, kind: 'grant', ...pairA,
    actor: 'sim-security', grant: grantFor('a', { revision: 2 }) };
  await h.fault('authority', 'pause:data'); const updating = h.mutate(update);
  try {
    for (let n = 0; n < 100; n++) { if ((await h.head()).gate === 'PENDING') break; await new Promise(r => setTimeout(r, 10)); }
    assert.equal((await h.head()).gate, 'PENDING');
    // The concurrent revoke cannot falsely confirm while another intent owns the global fence.
    await rejects(h.change('revoke'), 'RECOVERY_REQUIRED');
  } finally { await h.stores.authority.fixture({ kind: 'release' }); }
  await updating; const obsolete = await h.stores.authority.view(); await h.fault('authority', '');
  await h.change('revoke');
  await rejects(value(h.stores.reference.rpc('finish', { operationId, state: obsolete })), 'REVISION_CONFLICT');
  await rejects(h.change('grant', pairA, { grant: grantFor('a', { revision: 4 }) }), 'TERMINAL_REVOCATION'); await denied(h);
});
check(24, 'reads during pending fence deny and do not cross accounts', async t => {
  const { h } = await setup(t); await h.fault('reference', 'pause:fence');
  const mutation = h.change('revoke');
  for (let n = 0; n < 100; n++) { if ((await h.head()).gate === 'PENDING') break; await new Promise(r => setTimeout(r, 10)); }
  assert.equal((await h.head()).gate, 'PENDING'); await denied(h); await denied(h, 'account-b', 'b');
  await h.stores.reference.fixture({ kind: 'release' }); await mutation; await denied(h);
});
check(25, 'crash after durable fence retains deny after restart', async t => {
  const { h, open } = await setup(t); await h.fault('reference', 'fence'); await rejects(h.change('revoke'), 'INJECTED_fence');
  await h.close(); const current = await open(); await denied(current); assert.ok((await current.head()).pending);
});
check(26, 'crash after authority write leaves reference pending', async t => {
  const { h } = await setup(t); await h.fault('authority', 'data');
  // RPC runtime exceptions are not asserted as legitimate administrative domain errors.
  await assert.rejects(h.change('revoke')); assert.ok((await h.head()).pending); await denied(h);
});
check(27, 'durability faults at confirmation prevent false administrator ACK', async t => {
  const { h } = await setup(t); await h.fault('reference', 'confirmed');
  await rejects(h.change('revoke'), 'INJECTED_confirmed'); await denied(h);
  assert.equal((await h.head()).state.anchors.find(a => a.subject === pairA.subject).status, 'revoked');
}, 'LOCAL: falhas após barreiras de persistência; falha física de flush não certificada');
check(28, 'lost confirmation is queryable and idempotent', async t => {
  const { h } = await setup(t); const head = await h.head(); const input = { operationId: randomUUID(), expectedSeq: head.state.seq,
    expectedRevision: 1, kind: 'revoke', ...pairA, actor: 'sim-security' };
  await h.fault('guardian', 'ack'); await rejects(h.mutate(input), 'INJECTED_ack');
  assert.equal((await h.status(input.operationId)).confirmed, true); await h.fault('guardian', '');
  const seq = (await h.head()).state.seq; await h.mutate(input); assert.equal((await h.head()).state.seq, seq); await denied(h);
});
check(29, 'same operation ID with different payload rejected', async t => {
  const { h } = await setup(t); const head = await h.head(); const input = { operationId: randomUUID(), expectedSeq: head.state.seq,
    expectedRevision: 1, kind: 'revoke', ...pairA, actor: 'sim-security' };
  await h.mutate(input); await rejects(h.mutate({ ...input, ...pairB }), 'IDEMPOTENCY_CONFLICT');
});
check(30, 'decision persistence failure cannot return allow', async t => {
  const { h } = await setup(t); await h.fault('reference', 'decision'); await denied(h); await latch(h, 'RECOVERY_REQUIRED');
});
check(31, 'old recovery approval replay rejected', async t => {
  const { h } = await setup(t); const plan = approvalPlan(await h.head()); await h.recover(plan);
  await rejects(h.recover(plan), 'REVISION_CONFLICT');
});
check(32, 'missing/old simulated MFA cannot reconcile', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); p.approvals[0].at -= 300001;
  await rejects(h.recover(p), 'SIMULATED_QUORUM_REQUIRED'); p.approvals[0].simulatedMfa = false;
  await rejects(h.recover(p), 'CORRUPT_OR_INVALID');
}, 'SIMULAÇÃO: não comprova MFA/AMR/step-up Access real');
check(33, 'same simulated person cannot provide two approvals', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); p.approvals[1].person = 'sim-proposer';
  await rejects(h.recover(p), 'SIMULATED_QUORUM_REQUIRED');
}, 'SIMULAÇÃO: não comprova duas pessoas físicas reais');
check(34, 'approval expires on concurrent head change', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); await h.change('revoke'); await rejects(h.recover(p), 'REVISION_CONFLICT');
});
check(35, 'sticky recovery HOLD survives outage and return', async t => {
  const { h } = await setup(t); await h.stores.reference.hold('DECLARED_RECOVERY'); await denied(h); await h.fault('reference', 'unavailable');
  await denied(h); await h.fault('reference', ''); await denied(h); assert.equal((await h.head()).gate, 'HOLD');
});
check(36, 'cross-environment snapshot is quarantined', async t => {
  const { h } = await setup(t); const s = await h.stores.authority.view(); s.environment = 'other-environment';
  await h.stores.authority.fixture({ kind: 'set', key: 'state', value: s }); await denied(h);
});
check(37, 'wrong account partition mapping cannot authorize', async t => {
  const { h } = await setup(t); const s = await h.stores.authority.view(); s.accounts[0].partition = 'account-b';
  await h.stores.authority.fixture({ kind: 'set', key: 'state', value: s }); await denied(h);
}, 'LOCAL: mapeamento lógico; bindings/IAM de staging reais pendentes');
check(38, 'decision nonce is single-use, not an allow bearer', async t => {
  const { h } = await setup(t); const proof = await liveProof(h);
  assert.deepEqual((await referenceDecision(h, proof)).permissions, ['read']); await rejects(referenceDecision(h, proof), 'REPLAY');
  await h.change('revoke'); const replay = await referenceDecision(h, { ...proof, request: h.proof() }); assert.deepEqual(replay.permissions, []);
});
check(39, 'old checkpoint without live reference never opens', async t => {
  const { h } = await setup(t); const old = await h.head(); await h.change('revoke'); await h.fault('reference', 'unavailable');
  const i = (await h.inspect()).identity; i.root = old.root; i.mode = 'READY'; await h.stores.guardian.fixture({ kind: 'set', key: 'identity', value: i });
  await denied(h); await latch(h, 'UNAVAILABLE');
});
check(40, 'security protocol downgrade rejected independently of MCP profile', async t => {
  const { h } = await setup(t); const i = (await h.inspect()).identity; i.protocol = 0;
  await h.stores.guardian.fixture({ kind: 'set', key: 'identity', value: i }); await denied(h);
});
check(41, 'grant expiry and invalid counters deny', async t => {
  const { h } = await setup(t); await h.change('grant', pairA, { grant: grantFor('a', { revision: 2, validFrom: Date.now() - 20000, validUntil: Date.now() - 10000 }) });
  await denied(h); const state = await h.stores.authority.view(); state.seq = Number.MAX_SAFE_INTEGER;
  await h.stores.authority.fixture({ kind: 'set', key: 'state', value: state }); await denied(h);
});
check(42, 'declared recovery closes and drains an in-flight decision before restore', async t => {
  const { h } = await setup(t); const prior = (await h.stores.reference.events()).length;
  await h.fault('reference', 'pause:decision'); const reading = denied(h);
  try {
    let observed = false;
    for (let n = 0; n < 100; n++) {
      if ((await h.stores.reference.events()).slice(prior).some(e => e.event === 'allow')) { observed = true; break; }
      await new Promise(r => setTimeout(r, 10));
    }
    assert.equal(observed, true); await h.stores.reference.hold('DRAIN');
  } finally { await h.stores.reference.fixture({ kind: 'release' }); }
  await reading; // Only now is the in-flight request drained; no old allow escaped the fence.
  await denied(h, 'account-b', 'b'); assert.equal((await h.head()).reason, 'DRAIN');
}, 'LOCAL: decisão em voo drenada; sem cancelamento retroativo de respostas já entregues');
check(43, 'partial reconciliation cannot open gate', async t => {
  const { h } = await setup(t); await h.stores.reference.hold('RECOVERY'); await h.fault('account-b', 'projection');
  await assert.rejects(h.recover()); assert.equal((await h.head()).gate, 'HOLD'); await denied(h);
});
check(44, 'lost reference history cannot be replaced by old grants', async t => {
  const { h } = await setup(t); await h.stores.reference.fixture({ kind: 'restore', value: { rows: [], events: [] } }); await denied(h);
  await rejects(h.recover(approvalPlan({ state: { seq: 2 }, root: 'old', gateRevision: 1 })), 'CORRUPT_OR_INVALID');
});
check(45, 'audit excludes JWTs, secrets and commercial data', async t => {
  const { h } = await setup(t); await read(h); await h.change('revoke'); await denied(h);
  const events = await h.stores.reference.events(); assert.ok(events.some(e => e.event === 'allow')); assert.ok(events.some(e => e.event === 'revocation-fenced'));
  const text = JSON.stringify(events); assert.doesNotMatch(text, /eyJ|privateKey|authorization|SYNTHETIC ACCOUNT|price|access_token|refresh_token|@/i);
});
check(46, 'ECONNRESET/timeout/refused never satisfy MCP negative helper', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) {
    const error = Object.assign(new Error(code), { code }); const client = { callTool: async () => { throw error; } };
    for (const operation of [() => expectReadDenied(client, 'account', {}), () => expectInvalidArguments(client, 'account', {}), () => expectUnknownTool(client, 'unknown')]) {
      await assert.rejects(operation, e => e === error);
    }
    await assert.rejects(value(Promise.reject(error)), e => e === error);
  }
});
check(47, 'harness closes clients/runtimes and local port', async t => {
  const { h } = await setup(t); const c = await h.connect(); await c.listTools(); await h.close(); await portClosed(h.url);
  assert.deepEqual(h.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
}, 'LOCAL; suites 113/273/5/9 executadas separadamente e vinculadas no relatório');
check(48, 'missing second administrator prevents recovery', async t => {
  const { h } = await setup(t); await setHead(h, v => { v.adminCount = 1; v.gate = 'HOLD'; v.reason = 'NO_QUORUM'; });
  await rejects(h.recover(), 'SIMULATED_QUORUM_REQUIRED'); await denied(h);
});

for (const [id, label, scope] of [[49, 'cold start', 'LOCAL'], [50, 'hibernation memory-loss model', 'LOCAL PARCIAL: hibernação Cloudflare real não executada'], [51, 'eviction memory-loss model', 'LOCAL PARCIAL: eviction real não executada'], [52, 'compatible runtime reconstruction', 'LOCAL PARCIAL: rollout Cloudflare real não executado']]) {
  check(id, `${label} resumes only with live exact proof`, async t => {
    const { h, open } = await setup(t); const before = await h.head(); await h.close(); const current = await open(); await read(current);
    assert.deepEqual((await current.head()).state, before.state); await latch(current, 'READY');
  }, scope);
}
check(53, 'guardian unavailability cannot bypass reference', async t => {
  const { h, open } = await setup(t); await h.fault('guardian', 'unavailable'); await denied(h); await latch(h, 'UNAVAILABLE');
  await h.close(); const current = await open(); await denied(current); await current.fault('guardian', ''); await read(current);
});
check(54, 'reference returns without incident: re-prove and auto resume', async t => {
  const { h, open } = await setup(t); await h.fault('reference', 'unavailable'); await denied(h); await latch(h, 'UNAVAILABLE');
  await h.close(); const current = await open(); await current.fault('reference', ''); await read(current); await latch(current, 'READY');
});
check(55, 'durable HOLD survives rollback of READY and new runtime', async t => {
  const { h, open } = await setup(t); await read(h); const snapshot = await h.snapshot(['guardian']);
  await h.stores.reference.hold('INTEGRITY_INCIDENT'); await h.restore(snapshot); await h.close(); const current = await open(); await denied(current);
  assert.equal((await current.head()).reason, 'INTEGRITY_INCIDENT');
});
check(56, 'exact current snapshot may resume with live proof', async t => {
  const { h, open } = await setup(t); const snapshot = await h.snapshot(); await h.restore(snapshot); await h.close(); const current = await open(); await read(current);
});
check(57, 'declared restoration even to current snapshot needs reconciliation', async t => {
  const { h } = await setup(t); const snapshot = await h.snapshot(); await h.stores.reference.hold('DECLARED_RESTORE'); await h.restore(snapshot);
  await denied(h); await h.recover(); await read(h);
});
check(58, 'boot proof preceding revocation does not authorize next call', async t => {
  const { h } = await setup(t); await read(h); await h.change('revoke'); await denied(h);
});
check(59, 'old READY/root and delayed startup observation are insufficient', async t => {
  const { h } = await setup(t); const identity = (await h.inspect()).identity; await h.change('revoke');
  await h.stores.guardian.fixture({ kind: 'set', key: 'identity', value: identity }); await denied(h);
});
check(60, 'old decision cannot be reused after revocation', async t => {
  const { h } = await setup(t); const proof = await liveProof(h); const prior = await referenceDecision(h, proof); assert.deepEqual(prior.permissions, ['read']);
  await h.change('revoke'); await denied(h); assert.notEqual((await h.head()).root, prior.root);
});
check(61, 'malformed proof and account switching do not authorize', async t => {
  const { h } = await setup(t); const proof = await liveProof(h); proof.request.enrollment = 'other';
  await rejects(referenceDecision(h, proof), 'CORRUPT_OR_INVALID'); const switched = await liveProof(h, { account: 'account-b' });
  assert.deepEqual((await referenceDecision(h, switched)).permissions, []);
});
check(62, 'missing reference never becomes seq-zero automatic enrollment', async t => {
  const { h } = await setup(t); await h.stores.reference.fixture({ kind: 'restore', value: { rows: [], events: [] } });
  await denied(h); await latch(h, 'RECOVERY_REQUIRED'); assert.equal((await h.stores.reference.fixture({ kind: 'dump' })).rows.length, 0);
});
check(63, 'LIMIT: rollback of every trusted root can reactivate old permissions', async t => {
  const { h, open } = await setup(t); await read(h); const old = await h.snapshot(['guardian', 'authority', 'account-a', 'account-b', 'reference']);
  await h.change('revoke'); await denied(h); await h.restore(old); await h.close(); const current = await open();
  // Deliberate counterexample, not a security success: the trusted-reference premise is violated.
  await read(current); assert.equal((await current.head()).state.seq, 2);
}, 'LIMITE DEMONSTRADO: referência confiável comprometida; impede alegação de produção');
check(64, 'ordinary snapshot explicitly excludes trusted reference', async t => {
  const { h } = await setup(t); const dump = await h.snapshot(); assert.deepEqual(Object.keys(dump).sort(), ['account-a', 'account-b', 'authority', 'guardian']);
  assert.ok(!('reference' in dump));
}, 'LOCAL PARCIAL: separação lógica apenas; independência IAM/provedor não comprovada');
check(65, 'concurrent revocations require a classified conflict and exactly one durable tombstone', async t => {
  const { h, open } = await setup(t); const before = await h.head(); const requests = revokeRace(before);
  const results = await Promise.allSettled(requests.map(input => h.mutate(input)));
  const outcome = { ...expectSingleCasWinner(results), caseId: 'R1-65' };
  const committed = await assertCommittedRace(h, before, requests, outcome, results);
  assert.equal(committed.state.anchors.filter(a => a.status === 'revoked').length, 1);
  await h.close(); const restarted = await open(); assert.deepEqual(await restarted.head(), committed);
  await assertCommittedRace(restarted, before, requests, outcome, results);
}, 'LOCAL: chamadas concorrentes pelo mesmo G; não representa instâncias independentes do provedor');
check(66, 'first durable revoke fence survives unknown outcome', async t => {
  const { h } = await setup(t); const head = await h.head(); const operationId = randomUUID(); await h.fault('reference', 'fence');
  const mutation = { operationId, expectedSeq: head.state.seq, expectedRevision: 1, kind: 'revoke', ...pairA, actor: 'sim-security' };
  await rejects(h.mutate(mutation), 'INJECTED_fence'); assert.equal((await h.status(operationId)).confirmed, false);
  await denied(h); await h.fault('reference', ''); await h.recover(); assert.equal((await h.status(operationId)).confirmed, true); await denied(h);
});
check(67, 'decision audit fault blocks rather than leaking account data', async t => {
  const { h } = await setup(t); await h.fault('reference', 'decision'); await denied(h); await latch(h, 'RECOVERY_REQUIRED');
});
check(68, 'technical creation with no enrollment denies and creates no grants', async t => {
  const { h } = await setup(t, false); await denied(h); assert.equal((await h.inspect()).identity, undefined);
  assert.equal((await h.stores.reference.fixture({ kind: 'dump' })).rows.length, 0);
});
check(69, 'lost G reconstructed only from current W and simulated quorum', async t => {
  const { h } = await setup(t); await h.change('revoke'); await h.stores.guardian.fixture({ kind: 'restore', value: { rows: [], events: [] } });
  await denied(h); await h.recover(); await denied(h); await read(h, 'account-b', 'b');
});
check(70, 'one admin does not stop proven restarts but cannot remove HOLD', async t => {
  const { h, open } = await setup(t); await setHead(h, v => { v.adminCount = 1; }); await h.close(); const current = await open();
  await read(current); await current.stores.reference.hold('RECOVERY'); await rejects(current.recover(), 'SIMULATED_QUORUM_REQUIRED'); await denied(current);
});
check(71, 'deny-only emergency hold does not imply unilateral unlock', async t => {
  const { h } = await setup(t); await setHead(h, v => { v.adminCount = 1; }); await h.stores.reference.hold('EMERGENCY_DENY_ONLY');
  await denied(h); await rejects(h.recover(), 'SIMULATED_QUORUM_REQUIRED');
}, 'SIMULAÇÃO: capacidade privilegiada do driver, sem autenticação administrativa operacional');
check(72, 'missing MFA/quorum cannot be bypassed by timeout', async t => {
  const { h } = await setup(t); await h.stores.reference.hold('LOST_AUTHENTICATOR'); const p = approvalPlan(await h.head()); p.approvals = p.approvals.slice(0, 1);
  await rejects(h.recover(p), 'CORRUPT_OR_INVALID'); await denied(h);
}, 'SIMULAÇÃO: credenciamento, contingência e MFA reais não executados');
check(73, 'restored configuration cannot select another enrollment', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head(), { enrollment: 'new-trust-root' });
  await rejects(h.recover(p), 'CORRUPT_OR_INVALID');
});
check(74, 'two approvals do not replace missing current history', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); await h.stores.reference.fixture({ kind: 'corrupt', key: 'head' });
  await rejects(h.recover(p), 'CORRUPT_OR_INVALID'); await denied(h);
});
check(75, 'future approvals and generation laundering rejected', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); p.approvals[0].at += 60000;
  await rejects(h.recover(p), 'SIMULATED_QUORUM_REQUIRED'); await h.change('revoke');
  const q = approvalPlan(await h.head()); q.generation = 2; await rejects(h.recover(q), 'CORRUPT_OR_INVALID'); await denied(h);
});
check(76, 'witness process restart preserving ledger retains revocation', async t => {
  const { h, open } = await setup(t); await h.change('revoke'); const before = await h.head(); await h.close(); const current = await open();
  await denied(current); assert.deepEqual(await current.head(), before);
});
check(77, 'witness regression detected against surviving G checkpoint', async t => {
  const { h } = await setup(t); const old = await h.snapshot(['reference']); await h.change('revoke'); await denied(h);
  await h.restore(old); await denied(h); assert.equal((await h.head()).reason, 'REFERENCE_REGRESSION');
});
it('R1-78: PITR real Cloudflare — não autorizado nem disponível localmente', { skip: 'PITR real exige ambiente Cloudflare descartável e autorização posterior; Miniflare não mantém log PITR do provedor' }, () => {});
coverage.push({ id: 'R1-78', result: 'EXTERNAL_PENDING', scope: 'CLOUDFLARE REAL/PITR', reason: 'Não disponível no desenvolvimento local; nenhum recurso Cloudflare foi alterado' });
check(79, 'unreported corruption with W unavailable never allows', async t => {
  const { h, open } = await setup(t); await h.stores.authority.fixture({ kind: 'corrupt', key: 'state' }); await h.fault('reference', 'unavailable');
  await denied(h); await h.close(); const current = await open(); await current.fault('reference', ''); await denied(current); await latch(current, 'RECOVERY_REQUIRED');
});
check(80, 'recovery plan bound to exact root/gate/nonce', async t => {
  const { h } = await setup(t); const p = approvalPlan(await h.head()); await h.stores.reference.hold('PLAN_CHANGED');
  await rejects(h.recover(p), 'REVISION_CONFLICT'); const changed = approvalPlan(await h.head(), { root: 'wrong' }); await rejects(h.recover(changed), 'REVISION_CONFLICT');
  await h.recover(); await read(h);
});

check('R2-S01', 'physical SQLite corruption is detected and cannot authorize', async t => {
  const { h, open, directory } = await setup(t); await h.close();
  const dir = join(directory, 'state/do/r2-restorable-authority');
  const files = (await readdir(dir)).filter(f => /^[a-f0-9]{64}\.sqlite$/.test(f)); assert.equal(files.length, 1);
  // Remove only this closed test database's journal files; otherwise SQLite may correctly repair the header from WAL.
  await rm(join(dir, files[0] + '-wal'), { force: true }); await rm(join(dir, files[0] + '-shm'), { force: true });
  await writeFile(join(dir, files[0]), Buffer.from('SYNTHETIC INVALID SQLITE HEADER'));
  const current = await open(); await denied(current); await latch(current, 'RECOVERY_REQUIRED');
});
check('R2-S02', 'physical offline rollback of authority and grants preserves W revocation', async t => {
  const { h, open, directory } = await setup(t); await h.close();
  const names = ['r2-restorable-authority', 'r2-restorable-projections'];
  for (const name of names) await cp(join(directory, 'state/do', name), join(directory, 'backup', name), { recursive: true });
  const current = await open(); await current.change('revoke'); await current.close();
  for (const name of names) {
    await rm(join(directory, 'state/do', name), { recursive: true, force: true });
    await cp(join(directory, 'backup', name), join(directory, 'state/do', name), { recursive: true });
  }
  const restored = await open(); await denied(restored); assert.equal((await restored.head()).gate, 'HOLD');
});
check('R2-S03', 'grant expiring during durable decision wait cannot allow', async t => {
  const { h } = await setup(t); const until = Date.now() + 1500;
  await h.change('grant', pairA, { grant: grantFor('a', { revision: 2, validUntil: until }) });
  const proof = await liveProof(h); const prior = (await h.stores.reference.events()).length;
  await h.fault('reference', 'pause:decision'); const decision = referenceDecision(h, proof);
  let initialAllow = false;
  for (let n = 0; n < 100 && Date.now() < until; n++) {
    if ((await h.stores.reference.events()).slice(prior).some(e => e.event === 'allow')) { initialAllow = true; break; }
    await new Promise(r => setTimeout(r, 5));
  }
  assert.equal(initialAllow, true, 'The grant must still be valid at the initial decision');
  // Fault control is test-only; no production timer or lease is introduced.
  await new Promise(r => setTimeout(r, Math.max(0, until - Date.now() + 50)));
  await h.stores.reference.fixture({ kind: 'release' }); assert.deepEqual((await decision).permissions, []);
});
check('R2-S04', 'recovery approval expiring before finish leaves HOLD', async t => {
  const { h } = await setup(t); const plan = approvalPlan(await h.head()); await h.fault('reference', 'pause:recovery-start');
  const pending = h.recover(plan);
  for (let n = 0; n < 100; n++) { if ((await h.head()).reason === 'RECONCILING') break; await new Promise(r => setTimeout(r, 10)); }
  const dump = await h.snapshot(['reference']); const row = dump.reference.rows.find(r => r.key === 'recovery:' + plan.operationId);
  assert.ok(row); const ticket = JSON.parse(row.value); ticket.expires = Date.now() - 1;
  await h.stores.reference.fixture({ kind: 'set', key: 'recovery:' + plan.operationId, value: ticket });
  await h.stores.reference.fixture({ kind: 'release' }); await rejects(pending, 'REVISION_CONFLICT'); assert.equal((await h.head()).gate, 'HOLD'); await denied(h);
});
check('R2-S05', 'JWT extra claims do not confer account or administrator identity', async t => {
  const { h } = await setup(t); const token = await h.assertion('synthetic-operator-a', { role: 'administrator', operator: 'synthetic-operator-b', account_ref: 'account-b', permissions: ['read', 'connect'] });
  const response = await h.raw({ token, headers: { 'MCP-Protocol-Version': '2025-11-25' }, body: { jsonrpc: '2.0', id: 5,
    method: 'tools/call', params: { name: 'account', arguments: { account_ref: 'account-b' } } } });
  assert.equal(response.status, 200); const body = await response.text(); assert.match(body, /SYNTHETIC_READ_DENIED/); assert.doesNotMatch(body, /SYNTHETIC ACCOUNT B/);
});
check('R2-S06', 'reference digest corruption fails closed', async t => {
  const { h } = await setup(t); await setHead(h, head => { head.root = 'x'.repeat(43); });
  await denied(h); await latch(h, 'RECOVERY_REQUIRED'); await rejects(h.head(), 'REFERENCE_CORRUPT');
});
check('R2-S07', 'closed mutation schema rejects privilege smuggling', async t => {
  const { h } = await setup(t); const head = await h.head();
  await rejects(h.change('revoke', pairA, { administrator: true }), 'CORRUPT_OR_INVALID'); assert.deepEqual(await h.head(), head);
  await rejects(h.change('revoke', pairA, { actor: 'synthetic-operator-a' }), 'CORRUPT_OR_INVALID');
});
check('R2-S08', 'expired JWT is HTTP authentication failure, not MCP authorization denial', async t => {
  const { h } = await setup(t); const now = Math.floor(Date.now() / 1000); const token = await h.assertion('synthetic-operator-a', { iat: now - 100, exp: now - 1 });
  const response = await h.raw({ token, body: { jsonrpc: '2.0', id: 1, method: 'tools/list' } });
  assert.equal(response.status, 401); assert.doesNotMatch(await response.text(), /SYNTHETIC_READ_DENIED/);
});
check('R2-S09', 'reference runtime reset is not a successful administrative rejection', async t => {
  const { h } = await setup(t); await h.fault('reference', 'ECONNRESET');
  await assert.rejects(h.head(), e => e.name !== 'SyntheticRecoveryError');
  await denied(h); await latch(h, 'RECOVERY_REQUIRED');
});
check('R2-S10', 'transport-shaped envelope cannot become an approved domain error', async () => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'SOME_UNKNOWN_ERROR']) {
    await assert.rejects(value(Promise.resolve({ ok: false, code })), e => e.message === 'INVALID_RECOVERY_ENVELOPE');
  }
});
check('R2-S11', 'read+connect grant still cannot invoke administrative MCP tools', async t => {
  const { h } = await setup(t); await h.change('grant', pairA, { grant: grantFor('a', { revision: 2, permissions: ['read', 'connect'] }) }); await read(h);
  const c = await h.connect(); try { for (const tool of ['grant', 'revoke', 'recover', 'setOperator']) await expectUnknownTool(c, tool); } finally { await c.close(); }
});
check('R2-S12', 'revision history records fence before confirmation and later denial', async t => {
  const { h } = await setup(t); const before = await h.head(); await h.change('revoke'); await denied(h);
  const events = await h.stores.reference.events(); const fence = events.findIndex(e => e.event === 'revocation-fenced');
  const confirmed = events.findIndex((e, i) => i > fence && e.event === 'mutation-confirmed');
  assert.ok(fence >= 0 && confirmed > fence); assert.equal(events[fence].sequence, before.state.seq + 1);
  const revisions = events.filter(e => e.sequence !== undefined).map(e => e.sequence);
  assert.deepEqual(revisions, [...revisions].sort((a,b) => a-b));
  assert.ok(events.slice(confirmed + 1).some(e => e.event === 'deny'));
});
check('R2-S13', 'simulated quorum cannot erase a surviving newer checkpoint', async t => {
  const { h } = await setup(t); const old = await h.snapshot(['reference']); await h.change('revoke'); await denied(h);
  await h.restore(old); await denied(h); await rejects(h.recover(), 'REFERENCE_REGRESSION');
  assert.equal((await h.head()).gate, 'HOLD'); await denied(h);
});
check('R2-S14', 'lost reference cannot be re-enrolled through an existing guardian', async t => {
  const { h } = await setup(t); const original = (await h.head()).state; original.seq = 0; original.anchors = [];
  await h.stores.reference.fixture({ kind: 'restore', value: { rows: [], events: [] } });
  await rejects(value(h.stores.guardian.rpc('enrollReference', original)), 'UNSAFE_BOOTSTRAP');
  assert.equal((await h.stores.reference.fixture({ kind: 'dump' })).rows.length, 0); await denied(h);
});
check('R2-Q01', 'CAS assertion rejects transport, timeouts, availability and fake conflicts', async () => {
  const failures = ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED'].map(code => Object.assign(new Error(code), { code }));
  failures.push(new Error('fetch failed'), new DOMException('aborted', 'AbortError'));
  for (const code of ['UNAVAILABLE', 'QUOTA', 'REFERENCE_BUSY', 'IDEMPOTENCY_CONFLICT']) {
    try { await value(Promise.resolve({ ok: false, code })); } catch (error) { failures.push(error); }
  }
  failures.push(Object.assign(new Error('REVISION_CONFLICT'), { code: 'REVISION_CONFLICT' }));
  failures.push({ name: 'SyntheticRecoveryError', code: 'REVISION_CONFLICT', message: 'REVISION_CONFLICT' });
  for (const failure of failures) for (const reverse of [false, true]) {
    const results = [{ status: 'fulfilled', value: {} }, { status: 'rejected', reason: failure }];
    if (reverse) results.reverse();
    assert.throws(() => expectSingleCasWinner(results), error => error === failure);
  }
});
check('R2-Q02', 'CAS assertion accepts only explicit domain conflicts and one winner', async () => {
  for (const code of ['REVISION_CONFLICT', 'RECOVERY_REQUIRED']) {
    let error; try { await value(Promise.resolve({ ok: false, code })); } catch (e) { error = e; }
    const results = [{ status: 'fulfilled', value: {} }, { status: 'rejected', reason: error }];
    assert.deepEqual(expectSingleCasWinner(results), { winner: 0, loser: 1, conflict: code });
  }
  assert.throws(() => expectSingleCasWinner([{ status: 'fulfilled', value: {} }, { status: 'fulfilled', value: {} }]));
});
for (const [index, scenario, race] of [[0, 'R1-22', updateRace], [1, 'R1-65', revokeRace]]) {
  for (const [offset, code] of ['ECONNRESET', 'ETIMEDOUT', 'UNAVAILABLE'].entries()) {
    check(`R2-Q${String(3 + index * 3 + offset).padStart(2, '0')}`, `${scenario}: injected ${code} cannot count as CAS success`, async t => {
      const { h, open } = await setup(t); const before = await h.head(); const requests = race(before);
      let injected;
      if (code === 'UNAVAILABLE') {
        try { await value(Promise.resolve({ ok: false, code })); } catch (error) { injected = error; }
      } else injected = Object.assign(new Error(code), { code });
      const results = await Promise.allSettled([h.mutate(requests[0]), Promise.reject(injected)]);
      assert.throws(() => expectSingleCasWinner(results), error => error === injected,
        'A real mutation plus a transport failure must fail the concurrency assertion');
      // Inspect the actual successful mutation independently: failure detection cannot hide state damage.
      const committed = await assertCommittedRace(h, before, requests, { winner: 0, loser: 1, caseId: `R2-Q${String(3 + index * 3 + offset).padStart(2, '0')}`, conflict: `injected:${code}` }, results);
      await h.close(); const restarted = await open(); assert.deepEqual(await restarted.head(), committed);
      await assertCommittedRace(restarted, before, requests, { winner: 0, loser: 1, caseId: `R2-Q${String(3 + index * 3 + offset).padStart(2, '0')}`, conflict: `injected:${code}` }, results);
    });
  }
}
after(async () => {
  await writeFile('work/recovery-concurrency-evidence.json', JSON.stringify(raceEvidence, null, 2) + '\n');
  coverage.sort((a,b) => a.id.localeCompare(b.id));
  await writeFile('work/recovery-coverage.json', JSON.stringify({ syntheticOnly: true, providerHomologated: false, scenarios: coverage }, null, 2) + '\n');
});
