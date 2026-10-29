import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, cp, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { generateKeyPair } from 'jose';
import { createConnection } from 'node:net';
import { startPersistent, subjects, grantFor, managementValue } from '../scripts/persistent-harness.mjs';
import { dataOf } from '../scripts/local-harness.mjs';
import { expectReadDenied, expectInvalidArguments, expectUnknownTool } from '../scripts/rejections.mjs';
await import('../scripts/build-persistence.mjs');

const evidence = [];
const pairA = { account: 'account-a', subject: subjects[0] };
async function closedPort(url) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    const finish = error => { socket.destroy(); clearTimeout(timer); error ? reject(error) : resolve(); };
    const timer = setTimeout(() => finish(new Error('LOCAL_PORT_PROBE_TIMEOUT')), 1000);
    socket.once('connect', () => finish(new Error('PERSISTENT_ENDPOINT_LEFT_OPEN')));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? undefined : error));
  });
}
async function setup(t, { provision = true, omitAuthority = false } = {}) {
  const directory = await mkdtemp(resolve('work/persistence-'));
  const path = join(directory, 'state'); const keyPair = await generateKeyPair('RS256');
  const instances = new Set();
  t.after(async () => {
    try {
      await Promise.all([...instances].map(h => h.close()));
      for (const h of instances) {
        assert.equal(h.outboundAttempts(), 0);
        assert.deepEqual(h.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
        await closedPort(h.url);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const open = async (options = {}) => {
    const h = await startPersistent({ path, keyPair, ...options }); instances.add(h); return h;
  };
  const h = await open({ omitAuthority }); if (provision) await h.provision();
  return { h, path, directory, open };
}
function check(name, operation) {
  it(name, { timeout: 20000 }, async t => { await operation(t); evidence.push({ scenario: name, result: 'passed' }); });
}
async function read(h, account = 'account-a', suffix = 'a', mode = { pin: '2026-07-28' }) {
  const client = await h.connect(`synthetic-operator-${suffix}`, mode);
  try { return await client.callTool({ name: 'account', arguments: { account_ref: account } }); }
  finally { await client.close(); }
}
async function denied(h, account = 'account-a', suffix = 'a') {
  const client = await h.connect(`synthetic-operator-${suffix}`);
  try { return await expectReadDenied(client, 'account', { account_ref: account }); }
  finally { await client.close(); }
}

for (const [profile, mode] of [['2026-07-28', { pin: '2026-07-28' }], ['2025-11-25', 'legacy']]) {
  for (const suffix of ['a', 'b']) check(`${profile}: persistent operator ${suffix}, three read tools and cross-account isolation`, async t => {
    const { h } = await setup(t); const client = await h.connect(`synthetic-operator-${suffix}`, mode);
    try {
      assert.equal(client.getNegotiatedProtocolVersion(), profile);
      assert.deepEqual((await client.listTools()).tools.map(tool => tool.name).sort(), ['account', 'listing', 'listings']);
      const own = `account-${suffix}`; const other = suffix === 'a' ? 'b' : 'a';
      for (const tool of ['account', 'listings', 'listing']) {
        const args = { account_ref: own, ...(tool === 'listing' ? { item_id: `MLB_SYNTH_${suffix.toUpperCase()}_001` } : {}) };
        assert.equal(dataOf(await client.callTool({ name: tool, arguments: args })).untrusted_data, true);
        await expectReadDenied(client, tool, { ...args, account_ref: `account-${other}` });
      }
      await expectReadDenied(client, 'listing', { account_ref: own, item_id: `MLB_SYNTH_${other.toUpperCase()}_001` });
      await expectInvalidArguments(client, 'account', { account_ref: own, seller_id: 'OTHER', subject: subjects[other === 'a' ? 0 : 1] });
      await expectUnknownTool(client, 'grant'); await expectUnknownTool(client, 'revoke');
    } finally { await client.close(); }
  });
}
check('empty persistent store denies by default; registry initialization creates no grants', async t => {
  const { h } = await setup(t, { provision: false }); await denied(h);
  await h.authority.initializeSyntheticRegistry(); await denied(h);
  assert.equal(await h.authority.inspect(pairA), null);
});
check('missing persistent authority binding never falls back to synthetic memory grants', async t => {
  const { h } = await setup(t, { provision: false, omitAuthority: true }); await denied(h);
});
check('verified JWT claims cannot select another operator or confer administrative privileges', async t => {
  const { h } = await setup(t);
  const token = await h.assertion('synthetic-operator-a', { account_ref: 'account-b', seller_id: 'OTHER', role: 'administrator', permissions: ['read', 'connect'], operator: 'synthetic-operator-b' });
  const response = await h.raw({ token, headers: { 'MCP-Protocol-Version': '2025-11-25' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: { account_ref: 'account-b' } } } });
  assert.equal(response.status, 200); const text = await response.text();
  assert.match(text, /SYNTHETIC_READ_DENIED/); assert.ok(!text.includes('SYNTHETIC ACCOUNT B'));
});
check('read and connect remain separate; connect alone cannot read MCP tools', async t => {
  const { h } = await setup(t);
  assert.deepEqual(await h.authority.permissions(pairA), ['read']);
  await h.authority.update({ grant: grantFor('a', { permissions: ['connect'], revision: 2 }), expectedRevision: 1 });
  assert.deepEqual(await h.authority.permissions(pairA), ['connect']); await denied(h);
});
check('explicit read+connect grants add no administration tools or implied privileges', async t => {
  const { h } = await setup(t);
  await h.authority.update({ grant: grantFor('a', { permissions: ['read', 'connect'], revision: 2 }), expectedRevision: 1 });
  assert.deepEqual(await h.authority.permissions(pairA), ['read', 'connect']);
  assert.equal(dataOf(await read(h)).data.account_ref, 'account-a');
  const c = await h.connect(); try { await expectUnknownTool(c, 'setOperator'); } finally { await c.close(); }
});
for (const [name, overrides] of [
  ['expired', { validFrom: Date.now() - 20000, validUntil: Date.now() - 10000 }],
  ['not-yet-valid', { validFrom: Date.now() + 100000, validUntil: Date.now() + 200000 }]
]) check(`${name} persistent grant denies a still-valid JWT`, async t => {
  const { h } = await setup(t);
  await h.authority.update({ grant: grantFor('a', { ...overrides, revision: 2 }), expectedRevision: 1 }); await denied(h);
});
check('operator disable survives restart and does not affect the other operator', async t => {
  const { h, open } = await setup(t);
  assert.equal(await h.authority.setOperator({ subject: subjects[0], enabled: false, expectedRevision: 1 }), 2);
  await h.close(); const restarted = await open(); await restarted.authority.initializeSyntheticRegistry();
  await denied(restarted); assert.equal(dataOf(await read(restarted, 'account-b', 'b')).data.account_ref, 'account-b');
});
check('valid grants survive a complete Miniflare/workerd restart without reseeding', async t => {
  const { h, open } = await setup(t); await h.close(); const restarted = await open();
  assert.deepEqual(await restarted.authority.permissions(pairA), ['read']);
  assert.equal(dataOf(await read(restarted)).data.account_ref, 'account-a');
});
check('confirmed revocation survives two fresh runtime instances and the original valid JWT', async t => {
  const { h, open } = await setup(t);
  const token = await h.assertion(); assert.equal(await h.authority.revoke({ ...pairA, expectedRevision: 1 }), 2);
  for (let i = 0, current = h; i < 2; i++) {
    await current.close(); current = await open(); await denied(current);
    const response = await current.raw({ token, headers: { 'MCP-Protocol-Version': '2025-11-25' },
      body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: { account_ref: 'account-a' } } } });
    // HTTP 200 MCP denial proves JWT validation succeeded; 401/503/transport errors would fail.
    assert.equal(response.status, 200); assert.match(await response.text(), /SYNTHETIC_READ_DENIED/);
    assert.equal((await current.authority.inspect(pairA)).state, 'revoked');
  }
});
check('revocation is durable even when acknowledgment is lost after storage.sync', async t => {
  const { h, open } = await setup(t); await h.authority.setFault('revoked');
  await assert.rejects(h.authority.revoke({ ...pairA, expectedRevision: 1 }), /SYNTHETIC_AFTER_DURABLE_revoked/);
  await h.close(); const restarted = await open(); await denied(restarted);
  assert.equal((await restarted.authority.inspect(pairA)).state, 'revoked');
});
check('revoking an absent grant creates a tombstone and prevents later accidental provisioning', async t => {
  const { h } = await setup(t, { provision: false }); await h.authority.initializeSyntheticRegistry();
  assert.equal(await h.authority.revoke({ ...pairA, expectedRevision: 0 }), 1);
  await assert.rejects(h.authority.update({ grant: grantFor('a', { revision: 2 }), expectedRevision: 1 }), /GRANT_FENCED/); await denied(h);
});
check('concurrent updates with the same expected revision have exactly one winner', async t => {
  const { h } = await setup(t);
  const results = await Promise.allSettled([
    h.authority.update({ grant: grantFor('a', { revision: 2, permissions: ['connect'] }), expectedRevision: 1 }),
    h.authority.update({ grant: grantFor('a', { revision: 2 }), expectedRevision: 1 })
  ]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(r => r.status === 'rejected' && /REVISION_CONFLICT/.test(r.reason.message)).length, 1);
  assert.equal((await h.authority.inspect(pairA)).revision, 2);
});
check('stale updates and stale revocations fail with an explicit revision conflict', async t => {
  const { h } = await setup(t);
  await assert.rejects(h.authority.update({ grant: grantFor('a'), expectedRevision: 0 }), /REVISION_CONFLICT/);
  await assert.rejects(h.authority.revoke({ ...pairA, expectedRevision: 0 }), /REVISION_CONFLICT/);
  assert.deepEqual(await h.authority.permissions(pairA), ['read']);
});
check('concurrent revocations confirm once and leave a terminal durable tombstone', async t => {
  const { h } = await setup(t);
  const values = await Promise.allSettled([1, 2].map(() => h.authority.revoke({ ...pairA, expectedRevision: 1 })));
  assert.equal(values.filter(v => v.status === 'fulfilled').length, 1);
  assert.equal(values.filter(v => v.status === 'rejected' && /REVISION_CONFLICT/.test(v.reason.message)).length, 1);
  await denied(h);
});
check('revocation supersedes an in-flight pending update; the stale update cannot reactivate it', async t => {
  const { h } = await setup(t); await h.authority.setFault('pause-pending');
  const update = h.authority.update({ grant: grantFor('a', { revision: 2 }), expectedRevision: 1 });
  const observed = Promise.allSettled([update]);
  try {
    const deadline = Date.now() + 3000;
    while ((await h.authority.inspect(pairA)).state !== 'pending') {
      assert.ok(Date.now() < deadline, 'pending update was not reached'); await new Promise(resolve => setTimeout(resolve, 10));
    }
    await denied(h); assert.equal(await h.authority.revoke({ ...pairA, expectedRevision: 2 }), 3);
  } finally { await h.authority.release(); }
  const [result] = await observed; assert.equal(result.status, 'rejected'); assert.match(result.reason.message, /REVISION_CONFLICT/);
  await denied(h); assert.equal((await h.authority.inspect(pairA)).state, 'revoked');
});
check('interrupted update remains pending and denied after a fresh runtime', async t => {
  const { h, open } = await setup(t); await h.authority.setFault('grant-pending');
  await assert.rejects(h.authority.update({ grant: grantFor('a', { revision: 2 }), expectedRevision: 1 }), /SYNTHETIC_AFTER_DURABLE_grant-pending/);
  await h.close(); const restarted = await open(); await denied(restarted);
  assert.equal((await restarted.authority.inspect(pairA)).state, 'pending');
});
check('projection write failure leaves a deny fence, not the previous allow', async t => {
  const { h, open } = await setup(t); await h.partition('account-a').setFault('write');
  await assert.rejects(h.authority.update({ grant: grantFor('a', { revision: 2 }), expectedRevision: 1 }), /SYNTHETIC_PROJECTION_UNAVAILABLE/);
  await h.close(); const restarted = await open(); await denied(restarted);
  assert.equal((await restarted.authority.inspect(pairA)).state, 'pending');
});
check('authority unavailable denies tools without exposing storage exception details', async t => {
  const { h } = await setup(t); await h.authority.setFault('unavailable');
  const result = await denied(h); assert.ok(!JSON.stringify(result).includes('AUTHORITY_UNAVAILABLE'));
  await h.authority.setFault(''); assert.equal(dataOf(await read(h)).data.account_ref, 'account-a');
});
check('unavailable projection denies access and never falls back to cached permissions', async t => {
  const { h } = await setup(t); assert.equal(dataOf(await read(h)).data.account_ref, 'account-a');
  await h.partition('account-a').setFault('read'); await denied(h);
  assert.equal(dataOf(await read(h, 'account-b', 'b')).data.account_ref, 'account-b');
});
check('missing projection denies even with a live matching authority anchor', async t => {
  const { h } = await setup(t); await h.partition('account-a').removeProjection(subjects[0]); await denied(h);
});
for (const [name, overrides] of [
  ['account', { account: 'account-b' }], ['subject', { subject: subjects[1] }],
  ['permissions', { permissions: ['read', 'connect'] }], ['validity', { validUntil: Date.now() + 7200000 }],
  ['revision', { revision: 99 }]
]) check(`tampered projection ${name} cannot acquire or broaden a grant`, async t => {
  const { h } = await setup(t);
  const old = await h.partition('account-a').read(pairA);
  if (name === 'subject') await h.partition('account-a').removeProjection(subjects[0]);
  await h.partition('account-a').restoreProjection({ ...old, ...overrides }); await denied(h);
  assert.deepEqual(await h.authority.permissions({ account: 'account-a', subject: subjects[1] }), []);
});
check('old pre-revocation projection import stays denied after restart', async t => {
  const { h, open } = await setup(t); const old = await h.partition('account-a').read(pairA);
  await h.authority.revoke({ ...pairA, expectedRevision: 1 });
  await h.partition('account-a').restoreProjection(old); await h.close();
  const restarted = await open(); await denied(restarted);
});
check('physical rollback of the projection namespace cannot undo confirmed revocation', async t => {
  const { h, path, directory, open } = await setup(t); await h.close();
  const projections = join(path, 'do/synthetic-grant-partitions'); const backup = join(directory, 'old-projections');
  await cp(projections, backup, { recursive: true });
  const next = await open(); await next.authority.revoke({ ...pairA, expectedRevision: 1 }); await next.close();
  await rm(projections, { recursive: true }); await cp(backup, projections, { recursive: true });
  const restored = await open(); await denied(restored);
  assert.equal(dataOf(await read(restored, 'account-b', 'b')).data.account_ref, 'account-b');
  assert.equal((await restored.authority.inspect(pairA)).revision, 2);
});
check('physical loss of the authority denies retained old projections; initialization cannot reseal them', async t => {
  const { h, path, open } = await setup(t); await h.authority.revoke({ ...pairA, expectedRevision: 1 }); await h.close();
  await rm(join(path, 'do/synthetic-security-authority'), { recursive: true });
  const restarted = await open(); await denied(restarted);
  await restarted.authority.initializeSyntheticRegistry(); await denied(restarted);
});
check('restoring a previous active revision cannot restore permissions removed by a newer revision', async t => {
  const { h } = await setup(t); const old = await h.partition('account-a').read(pairA);
  await h.authority.update({ grant: grantFor('a', { revision: 2, permissions: ['connect'] }), expectedRevision: 1 });
  await h.partition('account-a').restoreProjection(old); assert.deepEqual(await h.authority.permissions(pairA), []); await denied(h);
});
check('per-account partition binding refuses another account and preserves its original data', async t => {
  const { h } = await setup(t);
  await assert.rejects(h.partition('account-a').put(grantFor('b', { revision: 2 })), /PARTITION_MISMATCH/);
  assert.equal(dataOf(await read(h)).data.account_ref, 'account-a');
});
check('closed grant mutation schema rejects admin permissions, extra identities and invalid validity', async t => {
  const { h } = await setup(t);
  for (const grant of [grantFor('a', { revision: 2, permissions: ['admin'] }),
    grantFor('a', { revision: 2, seller_id: 'OTHER' }), grantFor('a', { revision: 2, permissions: ['read', 'read'] }),
    grantFor('a', { revision: 2, validUntil: 0 }), grantFor('a', { revision: 2, subject: 'client-identity' })]) {
    await assert.rejects(h.authority.update({ grant, expectedRevision: 1 }), error =>
      error.name === 'SyntheticManagementError' && error.message === 'INVALID_INPUT');
  }
  assert.equal((await h.authority.inspect(pairA)).revision, 1);
});
check('concurrent account reads and revocation never mix identities or restore the revoked account', async t => {
  const { h } = await setup(t); await h.authority.revoke({ ...pairA, expectedRevision: 1 });
  await Promise.all(Array.from({ length: 8 }, async (_, i) => {
    if (i % 2 === 0) await denied(h);
    else assert.equal(dataOf(await read(h, 'account-b', 'b')).data.account_ref, 'account-b');
  }));
});
check('audit persists authorization/denial/revocation without JWTs, business data or raw operator names', async t => {
  const { h, open } = await setup(t); const token = await h.assertion();
  await read(h); await denied(h, 'account-b'); await h.authority.revoke({ ...pairA, expectedRevision: 1 });
  await h.close(); const restarted = await open(); const events = await restarted.authority.audit();
  assert.ok(['authorized', 'denied', 'revoked'].every(event => events.some(row => row.event === event)));
  for (const row of events) assert.deepEqual(Object.keys(row).sort(), ['account', 'actor', 'event', 'permission', 'revision', 'sequence', 'subject', 'time']);
  assert.ok(events.some(row => row.event === 'authorized' && row.permission === 'read'));
  assert.ok(events.some(row => row.event === 'revoked' && row.actor === 'local-administration'));
  const serialized = JSON.stringify(events);
  for (const privateValue of [token, 'synthetic-operator-a', 'SYNTHETIC ACCOUNT', 'MLB_SYNTH', 'PRIVATE KEY']) assert.ok(!serialized.includes(privateValue));
});
for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) check(`local administrative adapter never converts ${code} into a grant rejection`, async () => {
  const fault = Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error(code), { code }) });
  await assert.rejects(managementValue(Promise.reject(fault)), error => error === fault && error.name !== 'SyntheticManagementError');
});
check('local administrative adapter rejects malformed/unknown error envelopes', async () => {
  for (const result of [{ ok: false, code: 'ECONNRESET' }, { ok: false, code: 'REVISION_CONFLICT', extra: true },
    { ok: true, code: 'REVISION_CONFLICT' }, null]) {
    await assert.rejects(managementValue(Promise.resolve(result)), error => error.message === 'INVALID_LOCAL_MANAGEMENT_ENVELOPE' && error.name !== 'SyntheticManagementError');
  }
});
after(async () => { await writeFile('work/persistence-evidence.json', JSON.stringify({ scenarios: evidence.length, results: evidence }, null, 2) + '\n'); });
