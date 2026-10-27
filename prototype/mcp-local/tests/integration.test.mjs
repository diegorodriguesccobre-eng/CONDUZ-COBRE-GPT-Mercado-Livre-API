import { it, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { build } from 'esbuild';
import { generateKeyPair } from 'jose';
import { startIntegration, subjects, grantFor, pairA, pairB } from '../scripts/integrated-harness.mjs';
import { value } from '../scripts/vault-harness.mjs';
import { startLocal, dataOf } from '../scripts/local-harness.mjs';
import { expectInvalidArguments, expectUnknownTool } from '../scripts/rejections.mjs';
import { expectSingleCasWinner } from './fixtures/concurrency-assertions.mjs';
await import('../scripts/build.mjs');
await import('../scripts/build-integration.mjs');
await build({ stdin: { contents: "export { registry } from './integration/registry.ts'; export { commandHash, parseMessage } from './integration/contracts.ts';", resolveDir: process.cwd() },
  outfile: 'work/integration-unit.mjs', bundle: true, format: 'esm', platform: 'browser' });
const { registry, commandHash, parseMessage } = await import('../work/integration-unit.mjs');
const coverage = [], evidence = [];
const defaultState = { revision: 1, registryFault: '', pauseAt: '', deadlineMs: 15000, streamFault: '' };
const READ = 'INTEGRATION_READ_DENIED', TOKEN = 'INTEGRATION_TOKEN_UNAVAILABLE', DEP = 'INTEGRATION_DEPENDENCY_UNAVAILABLE';
function scenario(n, name, fn) {
  const id = `C3-L${String(n).padStart(2, '0')}`;
  it(`${id}: ${name}`, { timeout: 45000 }, async t => { await fn(t); coverage.push({ id, name, result: n === 43 ? 'LIMIT_DEMONSTRATED' : 'PASS' }); });
}
async function closedPort(url) {
  await new Promise((ok, fail) => {
    const s = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    const timer = setTimeout(() => finish(new Error('INTEGRATION_PORT_PROBE_TIMEOUT')), 1000);
    const finish = e => { clearTimeout(timer); s.destroy(); e ? fail(e) : ok(); };
    s.once('connect', () => finish(new Error('INTEGRATION_PORT_STILL_OPEN')));
    s.once('error', e => finish(e.code === 'ECONNREFUSED' ? undefined : e));
  });
}
async function setup(t, { seed = true, provision = true } = {}) {
  const directory = await mkdtemp(resolve('work/integration-test-')), path = join(directory, 'state');
  const keyPair = await generateKeyPair('RS256');
  const materials = Object.fromEntries(['a', 'b'].map(s => [`account-${s}`, { key: randomBytes(32).toString('base64url'),
    access: `SYNTHETIC_ACCESS_${s.toUpperCase()}_${randomUUID()}`, refresh: `SYNTHETIC_REFRESH_${s.toUpperCase()}_${randomUUID()}` }]));
  const handles = new Set();
  const open = async overrides => { const h = await startIntegration({ path, keyPair, materials, ...overrides }); handles.add(h); return h; };
  t.after(async () => {
    try {
      await Promise.all([...handles].map(h => h.close()));
      for (const h of handles) {
        assert.equal(h.outboundAttempts(), 0); assert.deepEqual(h.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
        await closedPort(h.url);
      }
    } finally { await rm(directory, { recursive: true, force: true }); }
  });
  const safe = input => {
    const text = typeof input === 'string' ? input : JSON.stringify(input);
    assert.ok(!Object.values(materials).flatMap(Object.values).some(v => text.includes(v)), 'Secret canary escaped');
    assert.doesNotMatch(text, /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/i);
  };
  const h = await open(); if (provision) await h.provision(); if (seed) await h.seedVaults();
  return { h, open, materials, safe };
}
async function using(h, suffix, fn, mode = { pin: '2026-07-28' }) {
  const c = await h.connect(`synthetic-operator-${suffix}`, mode);
  try { return await fn(c); } finally { await c.close(); }
}
const args = (suffix = 'a', tool = 'account', extra = {}) => ({ account_ref: `account-${suffix}`,
  ...(tool === 'listing' ? { item_id: `MLB_SYNTH_${suffix.toUpperCase()}_001` } : {}), ...extra });
async function read(h, suffix = 'a', tool = 'account', extra = {}, mode) {
  return using(h, suffix, async c => { const r = await c.callTool({ name: tool, arguments: args(suffix, tool, extra) });
    assert.equal(r.isError, undefined, 'Expected genuine authorized MCP data'); const v = dataOf(r);
    assert.equal(v.source, 'synthetic'); assert.equal(v.untrusted_data, true); return v.data;
  }, mode);
}
function requireToolError(r, codes) {
  assert.equal(r.isError, true, 'A rejected promise/transport failure is never a security decision');
  assert.equal(r.structuredContent, undefined); assert.equal(r.content.length, 1); assert.equal(r.content[0].type, 'text');
  assert.ok([codes].flat().includes(r.content[0].text), `Expected ${codes}, got ${r.content[0].text}`);
  return r;
}
async function denied(h, codes = READ, suffix = 'a', extra = {}, tool = 'account') {
  return using(h, suffix, async c => requireToolError(await c.callTool({ name: tool, arguments: args(suffix, tool, extra) }), codes));
}
async function negative(client, codes = READ) { return requireToolError(await client.callTool({ name: 'account', arguments: args() }), codes); }
const snap = (h, a = 'account-a') => h.vault(a).fixture({ kind: 'snapshot' });
const providerEvents = async h => (await h.events()).filter(e => e.phase === 'provider');
const rpc = (account = 'account-a') => ({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: { account_ref: account } } });
async function rpcValue(response) {
  const text = await response.text();
  return response.headers.get('content-type')?.startsWith('text/event-stream')
    ? JSON.parse(text.split('\n').find(l => l.startsWith('data: ')).slice(6)) : JSON.parse(text);
}
async function paused(h) {
  for (let i = 0; i < 250; i++) { const w = await h.waiting(); if (w.length) return w;
    await new Promise(r => setTimeout(r, 10)); }
  assert.fail('Expected a real controlled in-flight operation');
}
async function pauseRead(h, phase, mutation, codes) {
  const c = await h.connect(); await h.configure({ pauseAt: phase });
  const count = h.wire.length; const pending = c.callTool({ name: 'account', arguments: args() });
  let observed;
  try { await paused(h); assert.equal(h.wire.length, count, 'No response headers before delivery barrier'); observed = await mutation(); }
  finally { await h.release(); }
  try { const r = requireToolError(await pending, codes); return { result: r, observed }; } finally { await c.close(); }
}
async function direct(h, overrides = {}) {
  const token = await h.assertion(); const p = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  const reg = await registry(defaultState), binding = reg.entries[0];
  // Registry resolution uses exactly the same canonical digest; no client-supplied identity is used here.
  const encoder = new TextEncoder();
  const canonical = v => Array.isArray(v) ? '[' + v.map(canonical).join(',') + ']'
    : v && typeof v === 'object' ? '{' + Object.entries(v).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => JSON.stringify(k) + ':' + canonical(x)).join(',') + '}' : JSON.stringify(v);
  const bindingDigest = Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(canonical(binding)))).toString('base64url');
  const c = { operationId: randomUUID(), nonce: randomUUID(), account: 'account-a', subject: subjects[0],
    identityExpiresAt: p.exp * 1000, deadlineAt: Date.now() + 15000, registryDigest: reg.digest, bindingDigest, query: { operation: 'account' }, ...overrides };
  const commandDigest = await commandHash(c); const issued = await h.issueIdentity(token, commandDigest);
  assert.equal(issued.ok, true); return { ...c, commandDigest, identityHandle: issued.handle };
}

scenario(1, 'account A: verified identity, current grants and exact sanitized contract', async t => {
  const { h, safe } = await setup(t); const before = await snap(h); const d = await read(h);
  assert.deepEqual(d, { account_ref: 'account-a', nickname: 'SYNTHETIC ACCOUNT A', site: 'MLB' });
  assert.deepEqual((await snap(h)).row, before.row); assert.equal((await providerEvents(h)).length, 1); safe(d); safe(await h.events());
});
scenario(2, 'listings A: bounded page and ownership per item', async t => {
  const { h } = await setup(t); assert.deepEqual(await read(h, 'a', 'listings', { limit: 1, offset: 0 }), { ids: ['MLB_SYNTH_A_001'], total: 2, next_offset: 1 });
  assert.equal((await providerEvents(h)).length, 3);
});
scenario(3, 'listing A: exact item, seller validation and unchanged token row', async t => {
  const { h } = await setup(t); const before = await snap(h); const d = await read(h, 'a', 'listing');
  assert.equal(d.item_id, 'MLB_SYNTH_A_001'); assert.equal(d.status, 'active'); assert.equal((await providerEvents(h)).length, 2);
  assert.deepEqual((await snap(h)).row, before.row);
});
scenario(4, 'both MCP profiles, all B tools and inherited discovery parity', async t => {
  const { h, safe } = await setup(t); const old = await startLocal(); t.after(() => old.close());
  for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
    assert.deepEqual(await using(h, 'b', c => c.listTools(), mode), await using(old, 'b', c => c.listTools(), mode));
    for (const tool of ['account', 'listings', 'listing']) safe(await read(h, 'b', tool, {}, mode));
  }
});
for (const [n, s, other] of [[5, 'a', 'b'], [6, 'b', 'a']]) scenario(n, `${s} cannot access ${other} with valid identity`, async t => {
  const { h } = await setup(t); const before = await h.head();
  for (const tool of ['account', 'listings', 'listing']) await denied(h, READ, s, args(other, tool), tool);
  assert.equal((await providerEvents(h)).length, 0); assert.deepEqual(await h.head(), before);
  assert.deepEqual((await snap(h, `account-${other}`)).events, []);
});
scenario(7, 'closed schemas reject extra selectors, duplicate JSON keys and limits', async t => {
  const { h } = await setup(t);
  await using(h, 'a', async c => {
    for (const field of ['seller_id', 'vault_ref', 'keyId', 'environment', 'url', 'token', 'subject', 'nested'])
      for (const tool of ['account', 'listings', 'listing']) await expectInvalidArguments(c, tool, args('a', tool, { [field]: { arbitrary: 'untrusted' } }));
    for (const limit of [0, 21, '1']) await expectInvalidArguments(c, 'listings', args('a', 'listings', { limit }));
  });
  for (const text of ['{"account":"a","account":"b"}', '{"a":1,"\\u0061":2}', '{"x":[{"a":1,"a":2}]}']) assert.throws(() => parseMessage(text));
  assert.deepEqual(parseMessage('{"a":[{"x":1},{"x":2}]}'), { a: [{ x: 1 }, { x: 2 }] });
  const response = await h.raw({ body: '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"account","arguments":{"account_ref":"account-a","account_ref":"account-b"}}}' });
  assert.notEqual(response.status, 200); assert.equal((await providerEvents(h)).length, 0);
});
scenario(8, 'JWT/header/query selectors cannot reroute; callback and internal routes remain separate', async t => {
  const { h } = await setup(t); const token = await h.assertion('synthetic-operator-a', { account_ref: 'account-b', seller_id: '20002', vault_ref: 'synthetic-vault-b', role: 'admin', permissions: ['connect'] });
  for (const account of ['account-a', 'account-b']) {
    const response = await h.raw({ token, body: rpc(account), headers: { 'MCP-Protocol-Version': '2025-11-25', 'X-Seller-Id': '20002', 'X-Vault-Ref': 'synthetic-vault-b', 'X-Operator': 'synthetic-operator-b' } });
    assert.equal(response.status, 200); const r = (await rpcValue(response)).result;
    if (account === 'account-a') assert.equal(dataOf(r).data.account_ref, 'account-a'); else requireToolError(r, READ);
  }
  for (const path of ['/mcp?account_ref=account-b', '/oauth/mercadolivre/callback?state=synthetic', '/oauth/mercadolivre/start', '/internal/vault'])
    assert.equal((await h.raw({ path, token: '', method: 'GET' })).status, 404);
});
scenario(9, 'invalid registry blocks serving and never provisions grants', async t => {
  const { h } = await setup(t); const before = await h.head();
  for (const registryFault of ['swap', 'corrupt']) {
    await h.configure({ registryFault }); const r = await h.raw({ body: rpc(), headers: { 'MCP-Protocol-Version': '2025-11-25' } });
    assert.equal(r.status, 503); assert.equal((await r.json()).error, 'INTEGRATION_BINDING_DENIED');
  }
  assert.deepEqual(await h.head(), before); assert.equal((await providerEvents(h)).length, 0);
});
scenario(10, 'registry snapshots are deeply immutable and imported values unchanged', async () => {
  const s = { ...defaultState }, r = await registry(s), old = JSON.stringify(r);
  assert.ok(Object.isFrozen(r)); assert.ok(Object.isFrozen(r.entries)); r.entries.forEach(x => assert.ok(Object.isFrozen(x)));
  assert.throws(() => { r.entries[0].seller = '20002'; }, TypeError); assert.throws(() => { r.entries.push(r.entries[0]); }, TypeError);
  s.revision = 2; assert.equal(JSON.stringify(r), old); assert.notEqual((await registry(s)).digest, r.digest);
});
scenario(11, 'registry revision changing in-flight discards buffered payload', async t => {
  const { h } = await setup(t); await pauseRead(h, 'buffered', () => h.configure({ revision: 2 }), 'INTEGRATION_REVISION_CHANGED'); await read(h);
});
scenario(12, 'confirmed revocation defeats reuse of still-valid JWT', async t => {
  const { h } = await setup(t); const token = await h.assertion(); await h.change('revoke');
  const head = await h.head(); assert.equal(head.state.anchors.find(a => a.account === 'account-a').status, 'revoked');
  const r = await h.raw({ token, body: rpc(), headers: { 'MCP-Protocol-Version': '2025-11-25' } });
  assert.equal(r.status, 200); requireToolError((await rpcValue(r)).result, READ); assert.equal((await providerEvents(h)).length, 0);
});
scenario(13, 'initially expired JWT cannot reach vault/provider', async t => {
  const { h } = await setup(t); const token = await h.assertion('synthetic-operator-a', { exp: Math.floor(Date.now() / 1000) - 1 });
  assert.equal((await h.raw({ token, body: rpc() })).status, 401); assert.deepEqual(await h.events(), []);
});
scenario(14, 'identity expires during real in-flight await, no data delivery', async t => {
  const { h } = await setup(t); await pauseRead(h, 'buffered', () => h.identityFixture({ offset: 400000 }), 'INTEGRATION_IDENTITY_DENIED');
  assert.equal((await h.identityFixture({})).handles, 0);
});
scenario(15, 'signature, kid, issuer, audience, subject, type, iat and duration checked', async t => {
  const { h } = await setup(t); const now = Math.floor(Date.now() / 1000), parts = (await h.assertion()).split('.');
  parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
  const tokens = ['', 'not-jwt', parts.join('.')];
  const wrongKid = (await h.assertion()).split('.'); wrongKid[0] = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'not-enrolled' })).toString('base64url'); tokens.push(wrongKid.join('.'));
  for (const claims of [{ iss: 'https://wrong.invalid' }, { aud: 'wrong' }, { sub: 'unregistered' }, { type: 'service' }, { iat: now + 60 }, { exp: now + 3700 }]) tokens.push(await h.assertion('synthetic-operator-a', claims));
  for (const token of tokens) assert.equal((await h.raw({ token, body: rpc() })).status, 401);
  assert.deepEqual(await h.events(), []);
});
scenario(16, 'missing, not-yet-valid and expired grants are proven authorization denials', async t => {
  const { h } = await setup(t);
  for (const dates of [{ validFrom: Date.now() + 60000, validUntil: Date.now() + 120000 }, { validFrom: Date.now() - 60000, validUntil: Date.now() - 1 }]) {
    const anchor = (await h.head()).state.anchors.find(a => a.account === 'account-a');
    await h.change('grant', pairA, { grant: grantFor('a', { revision: anchor.revision + 1, ...dates }) }); await denied(h);
  }
  await denied(h, READ, 'a', { account_ref: 'account-b' }); assert.equal((await providerEvents(h)).length, 0);
});
scenario(17, 'disabled operator is denied without implicit grants', async t => {
  const { h } = await setup(t); await h.change('operator', pairA, { enabled: false }); await denied(h);
  assert.equal((await h.head()).state.operators.find(o => o.subject === subjects[0]).enabled, false); assert.equal((await providerEvents(h)).length, 0);
});
scenario(18, 'restart retains revocation and never bootstraps missing state', async t => {
  const { h, open } = await setup(t); await h.change('revoke'); const before = await h.head(); await h.close();
  const restarted = await open(); await denied(restarted); assert.deepEqual(await restarted.head(), before);
  const empty = await setup(t, { provision: false, seed: false }); await denied(empty.h, DEP); await empty.h.close();
  const emptyAgain = await empty.open(); await denied(emptyAgain, DEP); assert.equal((await snap(emptyAgain)).row, undefined);
  assert.equal((await emptyAgain.stores.reference.fixture({ kind: 'dump' })).rows.length, 0);
});
scenario(19, 'connect does not imply read or administrator', async t => {
  const { h } = await setup(t); await h.change('grant', pairA, { grant: grantFor('a', { revision: 2, permissions: ['connect'] }) });
  await denied(h); assert.equal((await providerEvents(h)).length, 0);
});
scenario(20, 'read exposes no connect, refresh or administration and cannot mutate token row', async t => {
  const { h } = await setup(t); const before = await snap(h);
  assert.deepEqual(await h.stores.guardian.permissions(pairA, 'connect'), []);
  await using(h, 'a', async c => { for (const name of ['connect', 'refresh', 'grant', 'recover', 'rotate', 'fixture']) await expectUnknownTool(c, name); });
  for (const tool of ['account', 'listings', 'listing']) await read(h, 'a', tool);
  assert.deepEqual((await snap(h)).row, before.row);
});
scenario(21, 'expired token blocks read before provider and never refreshes', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'record', value: { expiresAt: Date.now() - 1 } });
  const before = await snap(h); await denied(h, TOKEN); assert.deepEqual((await snap(h)).row, before.row); assert.equal((await providerEvents(h)).length, 0);
});
scenario(22, 'strict token safety margin: below/equal 30s denied, above admitted', async t => {
  const { h } = await setup(t);
  for (const margin of [29999, 30000]) { await h.vault('account-a').fixture({ kind: 'record', value: { expiresAt: Date.now() + margin } }); const before = await snap(h);
    await denied(h, TOKEN); assert.deepEqual((await snap(h)).row, before.row); }
  assert.equal((await providerEvents(h)).length, 0);
  await h.vault('account-a').fixture({ kind: 'record', value: { expiresAt: Date.now() + 60000 } }); await read(h);
});
scenario(23, 'token margin crosses during buffering, no implicit renewal', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'record', value: { expiresAt: Date.now() + 30750 } }); const before = await snap(h);
  await pauseRead(h, 'buffered', async () => { await new Promise(r => setTimeout(r, 800)); }, TOKEN);
  assert.deepEqual((await snap(h)).row, before.row);
});
scenario(24, 'absent or refreshing token never promoted automatically', async t => {
  const { h } = await setup(t, { seed: false }); await denied(h, TOKEN); assert.equal((await snap(h)).row, undefined);
  await h.seedVaults(); const before = await snap(h); await h.vault('account-a').fixture({ kind: 'replace', value: { ...before, row: { ...before.row, status: 'refreshing' } } });
  await denied(h, TOKEN); assert.equal((await snap(h)).row.status, 'refreshing'); assert.equal((await providerEvents(h)).length, 0);
});
scenario(25, 'cross-account ciphertext and same-key AAD probe fail closed', async t => {
  const { h } = await setup(t); const a = await snap(h), b = await snap(h, 'account-b');
  await h.vault('account-a').fixture({ kind: 'replace', value: { ...a, row: b.row } }); await denied(h, TOKEN); await read(h, 'b');
  assert.deepEqual(await h.vault('account-a').fixture({ kind: 'crypto-probe' }), { crossContextDenied: true });
});
scenario(26, 'foreign keyId, lost key and foreign environment cannot choose a new vault', async t => {
  const { h, open, materials } = await setup(t); const a = await snap(h), box = JSON.parse(a.row.ciphertext); box.keyId = 'foreign';
  await h.vault('account-a').fixture({ kind: 'replace', value: { ...a, row: { ...a.row, ciphertext: JSON.stringify(box) } } }); await denied(h, TOKEN);
  await h.vault('account-a').fixture({ kind: 'replace', value: a }); await h.close();
  const restarted = await open({ materials: { ...materials, 'account-a': { ...materials['account-a'], key: randomBytes(32).toString('base64url') } } });
  await denied(restarted, TOKEN); await read(restarted, 'b');
  await restarted.configure({ registryFault: 'swap' }); assert.equal((await restarted.raw({ body: rpc() })).status, 503);
});
scenario(27, 'provider identity seller mismatch discards result', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'wrong-identity' }); await denied(h, TOKEN); await read(h, 'b');
});
scenario(28, 'wrong item ID and seller cannot pass exact ownership check', async t => {
  const { h } = await setup(t); for (const fault of ['wrong-item-id', 'wrong-item-seller']) {
    await h.vault('account-a').fixture({ kind: 'fault', value: fault }); await denied(h, TOKEN, 'a', {}, 'listing'); }
});
scenario(29, 'mixed-seller search rejects entire page', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'wrong-search' }); await denied(h, TOKEN, 'a', {}, 'listings');
});
scenario(30, 'direct vault requires minted evidence, bound command and correct durable identity', async t => {
  const { h } = await setup(t); const c = await direct(h);
  for (const input of [{ ...c, identityHandle: randomUUID() }, { ...c, subject: subjects[1] }, { account: 'account-a', subject: subjects[0] }]) {
    const r = await h.vault('account-a').execute(input); assert.equal(r.ok, false); assert.equal(r.data, undefined); }
  const wrongVault = await h.vault('account-b').execute(c); assert.equal(wrongVault.ok, false); assert.equal(wrongVault.code, 'INTEGRATION_BINDING_DENIED');
  assert.equal((await providerEvents(h)).length, 0);
});
scenario(31, 'persisted nonce and ephemeral evidence prevent replay including restart', async t => {
  const { h, open } = await setup(t); const c = await direct(h); const first = await h.vault('account-a').execute(c); assert.equal(first.ok, true);
  const count = (await providerEvents(h)).length; assert.deepEqual(await h.vault('account-a').execute(c), { ok: false, code: 'INTEGRATION_REPLAY' });
  await h.close(); const restarted = await open(); assert.deepEqual(await restarted.vault('account-a').execute(c), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal((await providerEvents(restarted)).length, count); await read(restarted);
});
scenario(32, 'receipt cannot be retargeted to another account, query or tool', async t => {
  const { h } = await setup(t); const c = await direct(h); const r = await h.vault('account-a').execute(c); assert.equal(r.ok, true);
  for (const patch of [{ query: { operation: 'listings', limit: 1, offset: 0 } }, { account: 'account-b' }, { operationId: randomUUID() }]) {
    const forged = { ...r.prepared, command: { ...c, ...patch } }; assert.equal((await h.vault('account-a').assertPrepared(forged)).ok, false);
  }
  assert.equal((await providerEvents(h)).length, 1);
});
scenario(33, 'CAS requires explicit conflict, exact durable winner, permissions and no cross grant', async t => {
  const { h } = await setup(t), before = await h.head();
  const requests = [['read'], ['connect']].map(permissions => ({ operationId: randomUUID(), expectedSeq: before.state.seq, expectedRevision: 1,
    kind: 'grant', ...pairA, actor: 'sim-security', grant: grantFor('a', { revision: 2, permissions }) }));
  const settled = await Promise.allSettled(requests.map(r => value(h.stores.guardian.rpc('mutate', r))));
  const winner = expectSingleCasWinner(settled), persisted = await h.head();
  assert.equal(persisted.state.seq, before.state.seq + 1); assert.equal(persisted.pending, null);
  assert.deepEqual(persisted.state, await h.stores.authority.view());
  const grant = persisted.state.anchors.find(a => a.account === 'account-a').grant;
  assert.deepEqual(grant.permissions, requests[winner.winner].grant.permissions); assert.equal(grant.revision, 2);
  if (grant.permissions.includes('read')) await read(h); else await denied(h);
  await denied(h, READ, 'a', { account_ref: 'account-b' });
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'UNAVAILABLE']) assert.throws(() => expectSingleCasWinner([settled[winner.winner], { status: 'rejected', reason: Object.assign(new Error(code), { code }) }]));
  evidence.push({ id: 'C3-L33', winner, sequence: persisted.state.seq, grantRevision: grant.revision, permissions: grant.permissions });
});
scenario(34, 'confirmed revocation before GET produces zero provider I/O', async t => {
  const { h } = await setup(t); await pauseRead(h, 'before-provider', async () => {
    const before = await h.head(), h1 = await h.change('revoke'); assert.equal(h1.pending, null); assert.equal(h1.state.seq, before.state.seq + 1);
    assert.equal(h1.state.anchors.find(a => a.account === 'account-a').status, 'revoked'); assert.deepEqual(await h.stores.authority.view(), h1.state);
  }, 'INTEGRATION_REVISION_CHANGED'); assert.equal((await providerEvents(h)).length, 0); await denied(h);
  evidence.push({ id: 'C3-L34', confirmedRevocation: true, durableAuthorityMatches: true, providerCalls: 0, classification: 'INTEGRATION_REVISION_CHANGED' });
});
scenario(35, 'revocation during an actual paused provider discards data', async t => {
  const { h } = await setup(t); await h.vault('account-a').fixture({ kind: 'fault', value: 'pause' });
  const c = await h.connect(), pending = c.callTool({ name: 'account', arguments: args() });
  try {
    let found = false; for (let i = 0; i < 250; i++) { if (await h.vault('account-a').fixture({ kind: 'paused' })) { found = true; break; } await new Promise(r => setTimeout(r, 10)); }
    assert.equal(found, true); assert.equal((await providerEvents(h)).length, 1);
    const before = await h.head(), confirmed = await h.change('revoke'); assert.equal(confirmed.pending, null);
    assert.equal(confirmed.state.seq, before.state.seq + 1); assert.equal(confirmed.state.anchors.find(a => a.account === 'account-a').status, 'revoked');
    assert.deepEqual(await h.stores.authority.view(), confirmed.state);
  } finally { await h.vault('account-a').fixture({ kind: 'release' }); }
  try { requireToolError(await pending, 'INTEGRATION_REVISION_CHANGED'); } finally { await c.close(); }
  await denied(h); evidence.push({ id: 'C3-L35', providerWasPaused: true, confirmedRevocation: true, durableAuthorityMatches: true, classification: 'INTEGRATION_REVISION_CHANGED' });
});
scenario(36, 'revocation after SDK serialization is checked before any response headers or data', async t => {
  const { h } = await setup(t); const count = (await providerEvents(h)).length;
  await pauseRead(h, 'buffered', async () => { assert.equal((await providerEvents(h)).length, count + 1); const confirmed = await h.change('revoke');
    assert.equal(confirmed.pending, null); evidence.push({ id: 'C3-L36', revokeConfirmed: true, seq: confirmed.state.seq, buffered: true, beforeHeaders: true });
  }, 'INTEGRATION_REVISION_CHANGED'); await denied(h);
});
scenario(37, 'global head change for B conservatively blocks A; a clean retry is authorized', async t => {
  const { h } = await setup(t); await pauseRead(h, 'buffered', () => h.change('grant', pairB, { grant: grantFor('b', { revision: 2 }) }), 'INTEGRATION_REVISION_CHANGED'); await read(h); await read(h, 'b');
});
scenario(38, 'row/generation mutation during provider invalidates token stamp', async t => {
  const { h } = await setup(t); await pauseRead(h, 'after-provider', () => h.vault('account-a').fixture({ kind: 'record', value: { generation: 2 } }), TOKEN);
});
for (const [n, names] of [[39, ['authority']], [41, ['guardian', 'authority', 'account-a', 'account-b']]]) scenario(n, `rollback ${names.join('/')} cannot re-enable revoked read`, async t => {
  const { h, open } = await setup(t); const old = await h.snapshot(names); await h.change('revoke'); await h.restore(old);
  // A revoked head independently proves denial even if this read does not need the old projection.
  await denied(h, [READ, 'INTEGRATION_RECOVERY_REQUIRED']); assert.equal((await providerEvents(h)).length, 0);
  assert.equal((await h.head()).gate, 'HOLD'); await h.close(); const restarted = await open();
  await denied(restarted, 'INTEGRATION_RECOVERY_REQUIRED'); assert.equal((await restarted.head()).gate, 'HOLD');
});
scenario(40, 'projection rollback cannot revive a tombstone; conflicting active projection forces HOLD', async t => {
  const { h, open } = await setup(t), old = await h.snapshot(['account-a']);
  const confirmed = await h.change('revoke'); await h.restore(old); await denied(h, READ);
  const revoked = await h.head(); assert.equal(revoked.gate, 'ACTIVE'); assert.equal(revoked.pending, null);
  assert.deepEqual(revoked.state, confirmed.state); assert.equal(revoked.state.anchors.find(a => a.account === 'account-a').status, 'revoked');
  assert.deepEqual(await h.stores.guardian.permissions(pairA, 'read'), []); assert.equal((await providerEvents(h)).length, 0);
  await h.close(); const restarted = await open(); await denied(restarted, READ); assert.deepEqual((await restarted.head()).state, confirmed.state);
  // Independent positive control: R2 makes revocation terminal, so never regrant the revoked pair.
  const active = await setup(t), oldActive = await active.h.snapshot(['account-a']);
  await active.h.change('grant', pairA, { grant: grantFor('a', { revision: 2 }) }); await active.h.restore(oldActive);
  await denied(active.h, 'INTEGRATION_RECOVERY_REQUIRED'); const blocked = await active.h.head();
  assert.equal(blocked.gate, 'HOLD'); assert.equal(blocked.reason, 'PROJECTION_DIVERGENCE');
  assert.equal((await active.h.inspect()).latch.mode, 'RECOVERY_REQUIRED'); assert.equal((await providerEvents(active.h)).length, 0);
  assert.equal(blocked.state.anchors.find(a => a.account === 'account-a').grant.revision, 2);
  evidence.push({ id: 'C3-L40', revokedHeadDenied: true, revokedAfterRestartDenied: true, activeProjectionConflict: 'PROJECTION_DIVERGENCE', providerCalls: 0 });
});
scenario(42, 'W rollback with newer G checkpoint forces durable recovery block', async t => {
  const { h } = await setup(t); const old = await h.snapshot(['reference']); await h.change('revoke'); await denied(h); await h.restore(old);
  await denied(h, 'INTEGRATION_RECOVERY_REQUIRED'); assert.equal((await h.head()).gate, 'HOLD');
});
scenario(43, 'LIMIT: coherent rollback of all roots can reauthorize; no production claim', async t => {
  const { h } = await setup(t); await read(h); const old = await h.snapshot(['reference', 'guardian', 'authority', 'account-a', 'account-b']);
  await h.change('revoke'); await denied(h); await h.restore(old);
  assert.equal((await read(h)).account_ref, 'account-a'); evidence.push({ id: 'C3-L43', result: 'LIMIT_DEMONSTRATED', allRootsRollbackCanReauthorize: true, productionReady: false });
});
scenario(44, 'reference/guardian faults require exact dependency error or evidenced durable recovery block', async t => {
  for (const name of ['reference', 'guardian']) for (const fault of ['ECONNRESET', 'timeout', 'unavailable']) {
    const { h } = await setup(t); const before = await h.head(); await h.fault(name, fault);
    // R2's guardian persists HOLD for unknown errors; known unavailability keeps an UNAVAILABLE latch.
    const expected = name === 'guardian' && fault !== 'unavailable' ? 'INTEGRATION_RECOVERY_REQUIRED' : DEP;
    const response = await denied(h, expected); requireToolError(response, expected);
    assert.equal((await providerEvents(h)).length, 0); const dump = await h.stores[name].fixture({ kind: 'dump' });
    assert.ok(dump.rows.some(r => r.key === 'fault' && JSON.parse(r.value) === fault));
    if (name === 'guardian') {
      const head = await h.head(), inspected = await h.inspect(); assert.deepEqual(head.state, before.state);
      assert.equal(head.pending, null);
      if (expected === 'INTEGRATION_RECOVERY_REQUIRED') {
        assert.equal(head.gate, 'HOLD'); assert.equal(head.reason, 'UNVERIFIED_STATE');
        assert.equal(inspected.latch.mode, 'RECOVERY_REQUIRED'); assert.equal(inspected.latch.reason, 'UNVERIFIED_STATE');
      } else { assert.equal(head.gate, 'ACTIVE'); assert.equal(inspected.latch.mode, 'UNAVAILABLE'); assert.equal(inspected.latch.reason, 'UNAVAILABLE'); }
    } else {
      // Do not use the Node proxy's generic RPC rejection as evidence of the injected fault.
      // Inspect the actual durable head: it remains unchanged while the injected reference cannot verify it.
      const stored = dump.rows.find(r => r.key === 'head'); assert.ok(stored);
      assert.deepEqual(JSON.parse(stored.value), before);
    }
    evidence.push({ id: 'C3-L44', store: name, injected: fault, classification: expected, providerCalls: 0, faultPersisted: true });
  }
});
scenario(45, 'storage outage, malformed encrypted row and quota never authorize', async t => {
  const { h } = await setup(t); const before = await snap(h);
  for (const fault of ['storage', 'corrupt']) { await h.vault('account-a').fixture({ kind: 'fault', value: fault }); await denied(h, TOKEN); assert.deepEqual((await snap(h)).row, before.row); }
  await h.vault('account-a').fixture({ kind: 'fault', value: '' });
  await h.vault('account-a').fixture({ kind: 'replace', value: { ...before, row: { ...before.row, ciphertext: '{invalid' } } }); await denied(h, TOKEN);
  const other = await setup(t); await other.h.fault('reference', 'quota'); await denied(other.h, DEP); assert.equal((await providerEvents(other.h)).length, 0);
});
scenario(46, 'secret canaries suppressed and listing text remains untrusted inert data', async t => {
  const { h, safe } = await setup(t); const d = await read(h, 'a', 'listing'); assert.match(d.title, /ignore|instruction/i); safe(d);
  assert.equal((await providerEvents(h)).length, 2); const before = await h.head();
  for (const [fault, tool] of [['leak-identity', 'account'], ['leak-title', 'listing'], ['transport', 'account']]) {
    await h.vault('account-a').fixture({ kind: 'fault', value: fault }); safe(await denied(h, fault === 'transport' ? DEP : TOKEN, 'a', {}, tool));
  }
  assert.ok((await h.events()).some(e => e.phase === 'failure-transport'), 'Transport cause must survive inherited sanitization');
  await h.configure({ deadlineMs: 400 }); await h.vault('account-a').fixture({ kind: 'fault', value: 'pause' });
  try {
    await denied(h, DEP); assert.equal(await h.vault('account-a').fixture({ kind: 'paused' }), true);
    assert.ok((await h.events()).some(e => e.phase === 'failure-timeout'), 'A bounded provider timeout is distinct from a transport rejection');
  } finally { await h.vault('account-a').fixture({ kind: 'release' }); }
  safe(h.wire); safe(await h.events()); safe((await snap(h)).events); assert.deepEqual(await h.head(), before);
  evidence.push({ id: 'C3-L46', transportClass: 'failure-transport', timeoutClass: 'failure-timeout', noSecretCanaries: true, noSecurityMutation: true });
});
scenario(47, 'negative helpers reject generic failures and preserve SDK protocol errors in both profiles', async t => {
  for (const code of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UNAVAILABLE']) {
    const error = Object.assign(new Error(code), { code }), c = { callTool: async () => { throw error; } };
    for (const fn of [() => negative(c), () => expectInvalidArguments(c, 'account', {}), () => expectUnknownTool(c, 'refresh')]) await assert.rejects(fn, e => e === error);
  }
  assert.throws(() => requireToolError({ isError: true, content: [{ type: 'text', text: DEP }] }, READ));
  const { h } = await setup(t); for (const mode of [{ pin: '2026-07-28' }, 'legacy']) await using(h, 'a', async c => {
    await expectInvalidArguments(c, 'account', { ...args(), seller_id: '20002' }); await expectUnknownTool(c, 'refresh');
  }, mode);
});
scenario(48, 'bounded streams, deadline, queue and lifecycle retain fail-closed behavior', async t => {
  const { h } = await setup(t);
  for (const streamFault of ['infinite', 'broken']) {
    await h.configure({ streamFault, deadlineMs: 300 }); const start = performance.now(); await denied(h, DEP);
    assert.ok(performance.now() - start < 4000); assert.equal((await h.identityFixture({})).handles, 0);
  }
  await h.configure({ streamFault: '', deadlineMs: 15000, pauseAt: 'before-provider' });
  const commands = await Promise.all(Array.from({ length: 10 }, () => direct(h)));
  const pending = commands.map(c => h.vault('account-a').execute(c)); await paused(h); await h.release();
  const results = await Promise.all(pending); assert.equal(results.filter(r => r.ok).length, 9);
  assert.equal(results.filter(r => !r.ok && r.code === 'INTEGRATION_BUSY').length, 1);
  await h.identityFixture({ clear: true }); assert.deepEqual(await h.waiting(), []); await read(h);
  evidence.push({ id: 'C3-L48', queueAdmitted: 9, busy: 1, resourcesVerifiedByAfter: true });
});
for (const [fault, cause] of [['http-429', 'upstream'], ['http-503', 'upstream'], ['body-error', 'upstream']]) {
  it(`D-R: actual adapter/coordinator ${fault} remains a sanitized dependency failure`, { timeout: 20000 }, async t => {
    const { h, safe } = await setup(t), before = await snap(h), head = await h.head();
    await h.vault('account-a').fixture({ kind: 'fault', value: fault });
    safe(await denied(h, DEP));
    assert.ok((await h.events()).some(e => e.phase === `failure-${cause}`));
    assert.deepEqual((await snap(h)).row, before.row); assert.deepEqual(await h.head(), head);
    assert.equal((await providerEvents(h)).length, 1);
    await h.vault('account-a').fixture({ kind: 'fault', value: '' }); await read(h);
    safe(h.wire); safe(await h.events());
  });
}
after(async () => { await writeFile('work/integration-coverage.json', JSON.stringify({ syntheticOnly: true, productionReady: false,
  scenarios: coverage, evidence, plannedLocal: 48, externalPending: 32 }, null, 2) + '\n'); });
