import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { generateKeyPair } from 'jose';
import { startVault, subjects, grantFor } from '../scripts/vault-harness.mjs';
import { startLocal, dataOf } from '../scripts/local-harness.mjs';
import { expectReadDenied, expectInvalidArguments, expectUnknownTool } from '../scripts/rejections.mjs';
await import('../scripts/build.mjs');
await import('../scripts/build-vault.mjs');
const coverage = [];
let number = 0;
function check(name, operation) {
  const id = `VB-${String(++number).padStart(2, '0')}`;
  it(`${id}: ${name}`, { timeout: 30000 }, async t => { await operation(t); coverage.push({ id, name, result: 'PASS' }); });
}
async function portClosed(url) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: url.hostname, port: Number(url.port) });
    const timer = setTimeout(() => finish(new Error('VAULT_PORT_PROBE_TIMEOUT')), 1000);
    const finish = error => { clearTimeout(timer); socket.destroy(); error ? reject(error) : resolve(); };
    socket.once('connect', () => finish(new Error('VAULT_PORT_LEFT_OPEN')));
    socket.once('error', e => finish(e.code === 'ECONNREFUSED' ? undefined : e));
  });
}
async function setup(t, { seed = true, provision = true } = {}) {
  const directory = await mkdtemp(resolve('work/vault-test-')), path = join(directory, 'state');
  const keyPair = await generateKeyPair('RS256');
  const materials = Object.fromEntries(['a', 'b'].map(s => [`account-${s}`, {
    key: randomBytes(32).toString('base64url'), access: `SYNTHETIC_ACCESS_${s.toUpperCase()}_${randomUUID()}`,
    refresh: `SYNTHETIC_REFRESH_${s.toUpperCase()}_${randomUUID()}`
  }]));
  const handles = new Set();
  const open = async (overrides = {}) => { const h = await startVault({ path, keyPair, materials, ...overrides }); handles.add(h); return h; };
  t.after(async () => {
    try {
      await Promise.all([...handles].map(h => h.close()));
      for (const h of handles) {
        assert.equal(h.outboundAttempts(), 0); assert.deepEqual(h.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
        await portClosed(h.url);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const safe = input => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    assert.ok(!Object.values(materials).flatMap(m => Object.values(m)).some(s => text.includes(s)), 'Secret canary must never escape');
    assert.doesNotMatch(text, /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/, 'No token canary may appear');
  };
  const h = await open(); if (provision) await h.provision(); if (seed) await h.seedVaults();
  return { h, open, materials, safe };
}
async function usingClient(h, suffix, fn, mode = { pin: '2026-07-28' }) {
  const client = await h.connect(`synthetic-operator-${suffix}`, mode);
  try { return await fn(client); } finally { await client.close(); }
}
async function read(h, suffix = 'a', tool = 'account', extra = {}, mode) {
  return usingClient(h, suffix, async c => {
    const reply = await c.callTool({ name: tool, arguments: { account_ref: `account-${suffix}`, ...extra } });
    assert.equal(reply.isError, undefined); const envelope = dataOf(reply); assert.equal(envelope.untrusted_data, true);
    return envelope.data;
  }, mode);
}
const denied = (h, suffix = 'a', account = `account-${suffix}`, tool = 'account', extra = {}) =>
  usingClient(h, suffix, c => expectReadDenied(c, tool, { account_ref: account, ...extra }));
const snap = (h, account = 'account-a') => h.vault(account).fixture({ kind: 'snapshot' });
const direct = (overrides = {}) => ({ account: 'account-a', subject: subjects[0], identityExpiresAt: Date.now() + 60000,
  nonce: randomUUID(), operation: 'account', ...overrides });
async function waitPaused(h) {
  for (let n = 0; n < 100; n++) {
    if (await h.vault('account-a').fixture({ kind: 'paused' })) return;
    await new Promise(r => setTimeout(r, 10));
  }
  assert.fail('Expected a real in-flight adapter operation');
}
const rpcBody = (account = 'account-a') => ({ jsonrpc: '2.0', id: 1, method: 'tools/call',
  params: { name: 'account', arguments: { account_ref: account } } });
async function rawValue(response) {
  const text = await response.text();
  return response.headers.get('content-type')?.startsWith('text/event-stream')
    ? JSON.parse(text.split('\n').find(l => l.startsWith('data: ')).slice(6)) : JSON.parse(text);
}

check('independent MCP client: both accounts, all three tools, both profiles', async t => {
  const { h, safe } = await setup(t);
  for (const mode of [{ pin: '2026-07-28' }, 'legacy']) for (const suffix of ['a', 'b']) {
    const a = await read(h, suffix, 'account', {}, mode); assert.equal(a.account_ref, `account-${suffix}`);
    assert.equal(a.nickname, `SYNTHETIC ACCOUNT ${suffix.toUpperCase()}`); safe(a);
    const ids = await read(h, suffix, 'listings', { limit: 1, offset: 0 }, mode);
    assert.deepEqual(ids, { ids: [`MLB_SYNTH_${suffix.toUpperCase()}_001`], total: 2, next_offset: 1 });
    const item = await read(h, suffix, 'listing', { item_id: ids.ids[0] }, mode); assert.equal(item.item_id, ids.ids[0]); safe(item);
  }
  safe(h.wire);
});
check('discovery schemas, descriptions and read-only annotations match inherited server', async t => {
  const { h } = await setup(t); const baseline = await startLocal(); t.after(() => baseline.close());
  const expected = await usingClient(baseline, 'a', c => c.listTools());
  const actual = await usingClient(h, 'a', c => c.listTools()); assert.deepEqual(actual, expected);
  assert.deepEqual(actual.tools.map(t => t.name).sort(), ['account', 'listing', 'listings']);
});
check('both operators denied across all tools of the other account', async t => {
  const { h } = await setup(t);
  for (const [s, other] of [['a', 'b'], ['b', 'a']]) for (const tool of ['account', 'listings', 'listing'])
    await denied(h, s, `account-${other}`, tool, tool === 'listing' ? { item_id: `MLB_SYNTH_${other.toUpperCase()}_001` } : {});
});
check('same-account item selector cannot reach the other seller', async t => {
  const { h } = await setup(t);
  await denied(h, 'a', 'account-a', 'listing', { item_id: 'MLB_SYNTH_B_001' });
  await denied(h, 'b', 'account-b', 'listing', { item_id: 'MLB_SYNTH_A_001' });
});
for (const field of ['seller_id', 'vault_ref', 'subject', 'operator', 'keyId', 'access_token']) {
  check(`closed schemas reject untrusted ${field} in every tool`, async t => {
    const { h } = await setup(t);
    await usingClient(h, 'a', async c => {
      for (const name of ['account', 'listings', 'listing']) await expectInvalidArguments(c, name, {
        account_ref: 'account-a', ...(name === 'listing' ? { item_id: 'MLB_SYNTH_A_001' } : {}), [field]: 'untrusted' });
    });
  });
}
check('extra JWT claims cannot select vault, seller or privileges', async t => {
  const { h, safe } = await setup(t); const token = await h.assertion('synthetic-operator-a', {
    account_ref: 'account-b', seller_id: '20002', vault_ref: 'synthetic-vault-b', operator: 'synthetic-operator-b', permissions: ['connect'], role: 'admin' });
  for (const account of ['account-a', 'account-b']) {
    const response = await h.raw({ token, body: rpcBody(account), headers: { 'MCP-Protocol-Version': '2025-11-25' } });
    assert.equal(response.status, 200); const rpc = await rawValue(response); safe(rpc);
    if (account === 'account-a') assert.equal(dataOf(rpc.result).data.account_ref, 'account-a');
    else { assert.equal(rpc.result.isError, true); assert.equal(rpc.result.content[0].text, 'SYNTHETIC_READ_DENIED'); }
  }
});
check('query selection is rejected; seller/vault headers cannot reroute a valid request', async t => {
  const { h, safe } = await setup(t);
  for (const query of ['seller_id=20002', 'vault_ref=synthetic-vault-b', 'account_ref=account-b']) {
    const r = await h.raw({ path: '/mcp?' + query, body: rpcBody() }); assert.equal(r.status, 404); safe(await r.text());
  }
  for (const account of ['account-a', 'account-b']) {
    const r = await h.raw({ body: rpcBody(account), headers: { 'MCP-Protocol-Version': '2025-11-25',
      'X-Seller-Id': '20002', 'X-Vault-Ref': 'synthetic-vault-b', 'X-Operator': 'synthetic-operator-b' } });
    assert.equal(r.status, 200); const rpc = await rawValue(r); safe(rpc);
    if (account === 'account-a') assert.equal(dataOf(rpc.result).data.account_ref, 'account-a');
    else assert.equal(rpc.result.content[0].text, 'SYNTHETIC_READ_DENIED');
  }
});
check('read grant provides no connect permission or administrative MCP tools', async t => {
  const { h } = await setup(t); assert.deepEqual(await h.stores.guardian.permissions({ account: 'account-a', subject: subjects[0] }, 'connect'), []);
  await usingClient(h, 'a', async c => {
    for (const name of ['connect', 'refresh', 'rotate', 'revoke', 'recover', 'fixture', 'vault', 'setSeller']) await expectUnknownTool(c, name);
  });
  const before = await snap(h); await read(h); await read(h, 'a', 'listings'); await read(h, 'a', 'listing', { item_id: 'MLB_SYNTH_A_001' });
  assert.deepEqual((await snap(h)).row, before.row, 'Reads must not write, renew or rotate tokens');
});
check('connect-only grant cannot read the vault', async t => {
  const { h } = await setup(t); const before = await snap(h);
  await h.change('grant', { account: 'account-a', subject: subjects[0] }, { grant: grantFor('a', { revision: 2, permissions: ['connect'] }) });
  await denied(h); assert.deepEqual((await snap(h)).row, before.row);
});
for (const expiresAt of [() => Date.now() - 1, () => Date.now() + 15000]) {
  check('expired/near-expiry token denied without refresh or token-state mutation', async t => {
    const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'record', value: { expiresAt: expiresAt() } });
    const before = await snap(h); await denied(h); const after = await snap(h);
    assert.deepEqual(after.row, before.row); assert.equal(after.row.status, 'ready'); await read(h, 'b');
  });
}
check('ciphertext transfer from B into A fails, independent B vault remains usable', async t => {
  const { h } = await setup(t); const a = await snap(h), b = await snap(h, 'account-b');
  assert.notEqual(a.row.ciphertext, b.row.ciphertext);
  assert.equal(JSON.parse(a.row.ciphertext).keyId, 'synthetic-a'); assert.equal(JSON.parse(b.row.ciphertext).keyId, 'synthetic-b');
  await h.vault('account-a').fixture({ kind: 'replace', value: { ...a, row: b.row } }); await denied(h); await read(h, 'b');
});
check('forged key identifier cannot decrypt ciphertext from the other key', async t => {
  const { h } = await setup(t); const a = await snap(h), b = await snap(h, 'account-b'); const envelope = JSON.parse(b.row.ciphertext); envelope.keyId = 'synthetic-a';
  await h.vault('account-a').fixture({ kind: 'replace', value: { ...a, row: { ...b.row, ciphertext: JSON.stringify(envelope) } } }); await denied(h);
});
check('same-key probe proves AES-GCM account-context AAD separation', async t => {
  const { h } = await setup(t); assert.deepEqual(await h.vault('account-a').fixture({ kind: 'crypto-probe' }), { crossContextDenied: true });
});
for (const [name, ciphertext] of [['malformed', '{invalid'], ['truncated', '{}'], ['foreign-key', JSON.stringify({ keyId: 'unknown', ciphertext: '{}' })]]) {
  check(`${name} encrypted record fails closed and survives restart`, async t => {
    const { h, open } = await setup(t); const a = await snap(h);
    await h.vault('account-a').fixture({ kind: 'replace', value: { ...a, row: { ...a.row, ciphertext } } }); await denied(h);
    await h.close(); const restarted = await open(); await denied(restarted); await read(restarted, 'b');
  });
}
for (const [field, value] of [['sellerId', '20002'], ['accessToken', 'SYNTHETIC_WRONG_ACCESS'], ['refreshToken', 'SYNTHETIC_WRONG_REFRESH']]) {
  check(`decrypted ${field} mismatch cannot switch an account`, async t => {
    const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'record', value: { [field]: value } }); await denied(h); await read(h, 'b');
  });
}
for (const [fault, tool, extra] of [['wrong-identity', 'account', {}], ['wrong-search', 'listings', {}],
  ['wrong-item-seller', 'listing', { item_id: 'MLB_SYNTH_A_001' }], ['wrong-item-id', 'listing', { item_id: 'MLB_SYNTH_A_001' }],
  ['wrong-item-seller', 'listings', {}], ['leak-identity', 'account', {}], ['leak-title', 'listing', { item_id: 'MLB_SYNTH_A_001' }], ['transport', 'account', {}]]) {
  check(`synthetic adapter ${fault}/${tool}: exact MCP denial, sanitized response`, async t => {
    const { h, safe } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: fault });
    const response = await denied(h, 'a', 'account-a', tool, extra); safe(response); safe((await snap(h)).events); safe(h.wire); await read(h, 'b');
  });
}
check('full vault metadata/ciphertext swap cannot redirect the durable-object identity', async t => {
  const { h } = await setup(t); const b = await snap(h, 'account-b'); await h.vault('account-a').fixture({ kind: 'replace', value: b });
  await denied(h); assert.deepEqual(await h.vault('account-a').execute(direct({ account: 'account-b', subject: subjects[1] })), { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
  await read(h, 'b');
});
check('internal operation schema refuses seller, vault and permission selectors', async t => {
  const { h } = await setup(t);
  for (const override of [{ seller_id: '20002' }, { vault_ref: 'synthetic-vault-b' }, { required: 'connect' }, { operation: 'refresh' }, { operation: 'connect' }, { subject: subjects[1] }])
    assert.deepEqual(await h.vault('account-a').execute(direct(override)), { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
});
check('replay nonce rejected after successful read and after runtime restart', async t => {
  const { h, open } = await setup(t); const req = direct(); const first = await h.vault('account-a').execute(req); assert.equal(first.ok, true);
  assert.deepEqual(await h.vault('account-a').execute(req), { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
  await h.close(); const restarted = await open(); assert.deepEqual(await restarted.vault('account-a').execute(req), { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
  assert.equal((await restarted.vault('account-a').execute(direct())).ok, true);
});
check('expired internal verified-identity deadline cannot authorize a vault operation', async t => {
  const { h } = await setup(t); assert.deepEqual(await h.vault('account-a').execute(direct({ identityExpiresAt: Date.now() - 1 })), { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
});
check('both accounts remain isolated during concurrent read requests', async t => {
  const { h, safe } = await setup(t); const a = await snap(h), b = await snap(h, 'account-b');
  const values = await Promise.all(Array.from({ length: 12 }, (_, n) => read(h, n % 2 ? 'b' : 'a')));
  values.forEach((v, n) => { assert.equal(v.account_ref, n % 2 ? 'account-b' : 'account-a'); safe(v); });
  assert.deepEqual((await snap(h)).row, a.row); assert.deepEqual((await snap(h, 'account-b')).row, b.row);
});
check('revocation during paused seller request denies A while B continues independently', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'pause' });
  const pending = denied(h);
  try {
    await waitPaused(h); await read(h, 'b'); const confirmed = await h.change('revoke');
    assert.equal(confirmed.gate, 'ACTIVE'); assert.equal(confirmed.pending, null);
    assert.equal(confirmed.state.anchors.find(a => a.account === 'account-a' && a.subject === subjects[0]).status, 'revoked');
    assert.deepEqual(await h.stores.authority.view(), confirmed.state);
  }
  finally { await h.vault('account-a').fixture({ kind: 'release' }); }
  await pending; await denied(h); await read(h, 'b');
});
check('token storage mutation during an in-flight operation cannot release stale data', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'pause' }); const pending = denied(h);
  try { await waitPaused(h); await h.vault('account-a').fixture({ kind: 'record', value: { generation: 2 } }); }
  finally { await h.vault('account-a').fixture({ kind: 'release' }); }
  await pending;
});
check('normal restart retains distinct encrypted vaults and current authorization', async t => {
  const { h, open, safe } = await setup(t); const before = [await snap(h), await snap(h, 'account-b')];
  before.forEach(s => safe(s)); await h.close(); const restarted = await open();
  for (const [n, suffix] of ['a', 'b'].entries()) { await read(restarted, suffix); assert.deepEqual((await snap(restarted, `account-${suffix}`)).row, before[n].row); }
});
check('lost/wrong ephemeral A key denies A without affecting B', async t => {
  const { h, open, materials } = await setup(t); await h.close();
  const changed = { ...materials, 'account-a': { ...materials['account-a'], key: randomBytes(32).toString('base64url') } };
  const restarted = await open({ materials: changed }); await denied(restarted); await read(restarted, 'b');
});
check('per-vault storage outage persists across restart and never seeds a replacement', async t => {
  const { h, open } = await setup(t); const before = await snap(h); await h.vault('account-a').fixture({ kind: 'fault', value: 'storage' });
  await denied(h); await h.close(); const restarted = await open(); await denied(restarted); await read(restarted, 'b');
  assert.deepEqual((await snap(restarted)).row, before.row); await restarted.vault('account-a').fixture({ kind: 'fault', value: '' }); await read(restarted);
});
check('missing vault and grants never auto-provision on construction or restart', async t => {
  const { h, open } = await setup(t, { seed: false, provision: false }); await denied(h); assert.equal((await snap(h)).row, undefined);
  await h.close(); const restarted = await open(); await denied(restarted); assert.equal((await snap(restarted)).row, undefined);
  assert.equal((await restarted.stores.reference.fixture({ kind: 'dump' })).rows.length, 0);
});
check('missing vault with valid grants still denies and creates no token record', async t => {
  const { h, open } = await setup(t, { seed: false }); await denied(h); assert.equal((await snap(h)).row, undefined);
  await h.close(); const restarted = await open(); await denied(restarted); assert.equal((await snap(restarted)).row, undefined);
});
check('R2 joint grant rollback cannot reopen a revoked encrypted vault', async t => {
  const { h, open } = await setup(t); const old = await h.snapshot(); const a = await snap(h); await h.change('revoke'); await h.restore(old);
  await h.close(); const restarted = await open(); await denied(restarted); assert.equal((await restarted.head()).gate, 'HOLD');
  await restarted.recover(); await denied(restarted); await read(restarted, 'b'); assert.deepEqual((await snap(restarted)).row, a.row);
});
check('reference unavailable denies vault reads despite ready tokens', async t => {
  const { h } = await setup(t); await read(h); const a = await snap(h); await h.fault('reference', 'unavailable'); await denied(h);
  assert.deepEqual((await snap(h)).row, a.row); await h.fault('reference', ''); await read(h);
});
check('valid but revoked JWT cannot reuse a previous HTTP tools/call after restart', async t => {
  const { h, open } = await setup(t); const token = await h.assertion(); await h.change('revoke'); await h.close(); const restarted = await open();
  const r = await restarted.raw({ token, body: rpcBody(), headers: { 'MCP-Protocol-Version': '2025-11-25' } }); assert.equal(r.status, 200);
  const rpc = await rawValue(r); assert.equal(rpc.result.isError, true); assert.equal(rpc.result.content[0].text, 'SYNTHETIC_READ_DENIED');
});
for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED']) {
  check(`${code} must propagate from negative MCP assertions, never count as denial`, async () => {
    const error = Object.assign(new Error(code), { code }); const client = { callTool: async () => { throw error; } };
    for (const fn of [() => expectReadDenied(client, 'account', {}), () => expectInvalidArguments(client, 'account', {}), () => expectUnknownTool(client, 'refresh')])
      await assert.rejects(fn, e => e === error);
  });
}
check('out-of-range pagination and numeric upstream IDs cannot bypass public contracts', async t => {
  const { h } = await setup(t);
  await usingClient(h, 'a', async c => {
    for (const args of [{ limit: 21 }, { limit: 0 }, { offset: 2 }, { limit: '1' }]) await expectInvalidArguments(c, 'listings', { account_ref: 'account-a', ...args });
    await expectInvalidArguments(c, 'listing', { account_ref: 'account-a', item_id: 'MLB22001' });
  });
});
check('invalid JWT identity, issuer, audience, expiry or signature never reaches a vault read', async t => {
  const { h, safe } = await setup(t);
  const now = Math.floor(Date.now() / 1000);
  const tokens = ['', 'not-a-jwt'];
  const altered = (await h.assertion()).split('.');
  altered[2] = (altered[2][0] === 'A' ? 'B' : 'A') + altered[2].slice(1);
  tokens.push(altered.join('.'));
  for (const claims of [{ iss: 'https://wrong.invalid' }, { aud: 'wrong-audience' }, { sub: 'unregistered-operator' }, { exp: now - 1 }])
    tokens.push(await h.assertion('synthetic-operator-a', claims));
  for (const token of tokens) {
    const r = await h.raw({ token, body: rpcBody(), headers: { 'MCP-Protocol-Version': '2025-11-25' } });
    assert.equal(r.status, 401); safe(await r.text());
  }
  assert.deepEqual((await snap(h)).events, []);
});
check('identity expiring during a paused read is denied after actual in-flight work', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'pause' });
  const until = Date.now() + 2000, pending = h.vault('account-a').execute(direct({ identityExpiresAt: until }));
  try {
    await waitPaused(h); assert.ok(Date.now() < until, 'Initial verified identity must still be current');
    await new Promise(r => setTimeout(r, Math.max(0, until - Date.now() + 50)));
  } finally { await h.vault('account-a').fixture({ kind: 'release' }); }
  assert.deepEqual(await pending, { ok: false, code: 'SYNTHETIC_VAULT_DENIED' });
});
check('MCP fixture does not absorb the separate public Mercado Livre callback', async t => {
  const { h } = await setup(t);
  const response = await h.raw({ token: '', method: 'GET', path: '/oauth/mercadolivre/callback?state=synthetic' });
  assert.equal(response.status, 404); // This isolated MCP entrypoint owns only /mcp; inherited public callback is separate.
  const missing = await h.raw({ token: '', body: rpcBody() }); assert.equal(missing.status, 401);
  // Full public callback/state/PKCE/cookie/replay behavior is revalidated by inherited root B3.1/B4 tests.
});
after(async () => { await writeFile('work/vault-isolation-coverage.json', JSON.stringify({ syntheticOnly: true,
  providerIsolationProven: false, productionReady: false, scenarios: coverage }, null, 2) + '\n'); });
