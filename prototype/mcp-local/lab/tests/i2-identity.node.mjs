import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build } from 'esbuild';
import { generateKeyPair, exportJWK } from 'jose';

const project = fileURLToPath(new URL('../..', import.meta.url)), root = resolve(project, '../..');
await import('../../scripts/build-homologation.mjs');
await import('../../scripts/build-i2-identity.mjs');
const { createI2IdentityFixture } = await import('../../scripts/i2-identity-harness.mjs');
const evidence = [];
async function setup(t, provision = true) {
  const directory = mkdtempSync(resolve(project, 'work/i2-case-'));
  const fixture = await createI2IdentityFixture();
  const h = await fixture.open({ path: resolve(directory, 'state') });
  t.after(async () => {
    try {
      await h.close(); assert.equal(h.outboundAttempts(), 0);
      assert.deepEqual(h.resources(), { front: { closed: true, clients: 0, requests: 0, fetches: 0 },
        backend: { closed: true, clients: 0, requests: 0, fetches: 0 }, portTasks: 0 });
      h.assertRedacted(h.wire); h.assertRedacted(h.driver.trace());
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  if (provision) { await h.driver.provision(); await h.driver.seed(); }
  return h;
}
const denied = (result, code) => assert.deepEqual(result, {
  _meta: { 'io.modelcontextprotocol/serverInfo': { name: 'conduz-cobre-synthetic-read', version: '0.0.1' } },
  isError: true, content: [{ type: 'text', text: code }]
});
async function using(h, who, run, mode = { pin: '2026-07-28' }) {
  const c = await h.connect('synthetic-operator-' + who, mode);
  try { return await run(c); } finally { await c.close(); }
}
function scenario(name, run) {
  test('I2 identity: ' + name, { timeout: 30000 }, async t => {
    await run(t); evidence.push({ name, result: 'PASS' });
  });
}
const argumentsFor = (who, tool) => ({ account_ref: 'account-' + who,
  ...(tool === 'listing' ? { item_id: 'MLB_SYNTH_' + who.toUpperCase() + '_001' } : {}) });
scenario('separate identity Worker serves both accounts and all three tools in both MCP profiles', async t => {
  const h = await setup(t);
  for (const mode of [{ pin: '2026-07-28' }, 'legacy']) for (const who of ['a','b']) {
    await using(h, who, async c => {
      assert.deepEqual((await c.listTools()).tools.map(t => t.name), ['account','listings','listing']);
      for (const tool of ['account','listings','listing']) {
        const result = await c.callTool({ name: tool, arguments: argumentsFor(who, tool) });
        assert.equal(result.isError, undefined); assert.equal(result.structuredContent.source, 'synthetic');
        assert.equal(result.structuredContent.untrusted_data, true); h.assertRedacted(result);
      }
    }, mode);
  }
  assert.ok(h.driver.trace().some(x => x.port === 'identity' && x.method === 'issue'));
  // Success requires the backend vault to find the handle issued through the private service.
  assert.ok(h.driver.trace().some(x => x.port === 'identity' && x.method === 'lookup'));
});
scenario('cross-account access is explicitly denied without provider I/O', async t => {
  const h = await setup(t);
  for (const who of ['a','b']) await using(h, who, async c => {
    for (const tool of ['account','listings','listing']) denied(await c.callTool({ name: tool,
      arguments: argumentsFor(who === 'a' ? 'b' : 'a', tool) }), 'INTEGRATION_READ_DENIED');
  });
  assert.equal((await h.driver.events()).filter(x => x.phase === 'provider').length, 0);
});
scenario('JWT policy is the inherited signature, issuer, audience, operator and expiry policy', async t => {
  const h = await setup(t);
  for (const [who, claims] of [['unknown', {}], ['synthetic-operator-a', { aud: 'wrong' }],
    ['synthetic-operator-a', { iss: 'https://other.invalid' }], ['synthetic-operator-a', { exp: 1 }]]) {
    const r = await h.identity('issue', { assertion: await h.assertion(who, claims), commandDigest: 'a'.repeat(43) });
    assert.equal(r.status, 200); assert.deepEqual(r.body, { ok: true, value: { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' } });
  }
  const malformed = await h.identity('issue', { assertion: 'not-a-jwt', commandDigest: 'a'.repeat(43) });
  assert.deepEqual(malformed.body.value, { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
});
scenario('private service exclusive consumption, reuse and independence', async t => {
  const h = await setup(t), assertion = await h.assertion();
  const issue = async digest => {
    const r = await h.identity('issue', { assertion, commandDigest: digest });
    assert.equal(r.status, 200); assert.equal(r.body.value.ok, true); return r.body.value;
  };
  const digest = 'a'.repeat(43), first = await issue(digest), other = await issue('b'.repeat(43));
  const input = issued => ({ handle: issued.handle, subject: issued.principal.subject,
    expiresAt: issued.principal.expiresAt, commandDigest: issued === first ? digest : 'b'.repeat(43) });
  const pending = [0,1].map(() => h.identity('lookup', { input: input(first), consume: true }));
  const results = await Promise.all(pending);
  assert.equal(results.filter(r => r.body.value.ok).length, 1);
  assert.ok(results.every(r => r.status === 200));
  assert.deepEqual(results.find(r => !r.body.value.ok).body.value, { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.deepEqual((await h.identity('lookup', { input: input(first), consume: true })).body.value,
    { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal((await h.identity('lookup', { input: input(other), consume: true })).body.value.ok, true);
  // Deterministic post-verification completion orders remain covered by the unchanged I1 core tests.
});
scenario('private cancellation invalidates a handle without claiming crypto interruption', async t => {
  const h = await setup(t), issued = (await h.identity('issue', {
    assertion: await h.assertion(), commandDigest: 'a'.repeat(43) })).body.value;
  assert.equal(issued.ok, true);
  assert.deepEqual((await h.identity('cancel', issued.handle)).body, { ok: true, value: null });
  assert.deepEqual((await h.identity('lookup', { input: { handle: issued.handle, subject: issued.principal.subject,
    expiresAt: issued.principal.expiresAt, commandDigest: 'a'.repeat(43) }, consume: true })).body.value,
    { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
});
scenario('identity object restart loses ephemeral handles and requires fresh verification', async t => {
  const h = await setup(t), assertion = await h.assertion();
  const issued = (await h.identity('issue', { assertion, commandDigest: 'a'.repeat(43) })).body.value;
  assert.equal(issued.ok, true); await h.restartIdentity();
  assert.deepEqual((await h.identity('lookup', { input: { handle: issued.handle, subject: issued.principal.subject,
    expiresAt: issued.principal.expiresAt, commandDigest: 'a'.repeat(43) }, consume: false })).body.value,
    { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal((await h.identity('issue', { assertion, commandDigest: 'b'.repeat(43) })).body.value.ok, true);
  await using(h, 'a', async c => assert.equal((await c.callTool({ name: 'account', arguments: argumentsFor('a','account') })).isError, undefined));
});
scenario('identity transport failure is dependency unavailable, never a read denial', async t => {
  const h = await setup(t), before = await h.driver.head();
  h.driver.portFault('identity', 'ECONNRESET');
  await using(h, 'a', async c => denied(await c.callTool({ name: 'account', arguments: argumentsFor('a','account') }), 'INTEGRATION_DEPENDENCY_UNAVAILABLE'));
  h.driver.portFault('identity', ''); assert.deepEqual(await h.driver.head(), before);
  assert.equal((await h.driver.events()).filter(x => x.phase === 'provider').length, 0);
});
scenario('private routes and selectors are closed; no administration or external URL forwarding', async t => {
  const h = await setup(t);
  for (const path of ['/identity/seed','/identity/fixture','/identity/refresh','/identity/grant','/oauth/start']) {
    const response = await h.privateRequest(new Request('https://m1-ports.invalid'+path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args: null }) }));
    assert.equal(response.status, 503); assert.deepEqual(await response.json(), { ok: false });
  }
  for (const url of ['https://api.mercadolibre.com/identity/issue', 'https://m1-ports.invalid/identity/issue?url=https://other.invalid']) {
    assert.equal((await h.privateRequest(new Request(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"args":null}' }))).status, 503);
  }
  assert.deepEqual((await h.identity('issue', { assertion: await h.assertion(), commandDigest: 'a'.repeat(43), role: 'administrator' })).body.value,
    { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal((await h.raw({ path: '/identity/issue', method: 'GET', token: '' })).status, 404);
});
scenario('empty laboratory does not bootstrap grants or tokens', async t => {
  const h = await setup(t, false);
  await using(h, 'a', async c => denied(await c.callTool({ name: 'account', arguments: argumentsFor('a','account') }), 'INTEGRATION_DEPENDENCY_UNAVAILABLE'));
  assert.equal((await h.driver.tokenState()).row, undefined);
  assert.equal((await h.driver.events()).filter(x => x.phase === 'provider').length, 0);
});
test('I2 identity: configuration refuses operational modes, private JWKS, extra bindings and foreign selectors', async () => {
  const file = resolve(project, 'work/i2-identity/config-test.mjs');
  await build({ absWorkingDir: project, entryPoints: ['i2/identity-config.ts'], outfile: file,
    bundle: true, platform: 'browser', format: 'esm' });
  const { identityVerifier } = await import(pathToFileURL(file).href);
  const pair = await generateKeyPair('RS256'); const publicKey = await exportJWK(pair.publicKey);
  const valid = { I2_MODE: 'I2_IDENTITY_FICTIONAL_LOCAL_ONLY',
    I2_JWKS: { keys: [{ ...publicKey, alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral' }] },
    I2_IDENTITIES: { idFromName() {}, get() {} } };
  assert.ok(identityVerifier(valid));
  for (const bad of [{ ...valid, I2_MODE: 'production' }, { ...valid, SECRET: 'not-a-secret' },
    { ...valid, issuer: 'https://other.invalid' }, { ...valid, I2_JWKS: { keys: [{ ...valid.I2_JWKS.keys[0], d: 'PRIVATE_KEY_REFUSED' }] } }]) {
    assert.throws(() => identityVerifier(bad));
  }
});
test('I2 identity: private artifact has no fixture graph and public I1 artifact inputs stay byte-identical', () => {
  const report = JSON.parse(readFileSync(resolve(project, 'work/i2-identity/build-report.json')));
  assert.equal(report.typecheck, 'PASS'); assert.equal(report.deployAuthorized, false);
  const privateCode = readFileSync(resolve(project, 'work/i2-identity/identity.mjs'), 'utf8');
  assert.doesNotMatch(privateCode, /mutationSchema|recoveryPlanSchema|simulatedMfa|updateSchema|revokeSchema|RecoveryDriver/);
  const front = JSON.parse(readFileSync(resolve(project, 'work/homologation/build-report.json')));
  assert.deepEqual(front.publicExports, ['default']);
  for (const name of front.publicInputs.filter(n => !n.includes('node_modules/'))) {
    const path = resolve(project, name), rel = relative(root, path).replaceAll('\\','/');
    assert.ok(!rel.includes('/i2/'));
    assert.deepEqual(readFileSync(path), execFileSync('git', ['show','b3df5def93688d9d68fad39a9a61e96b5c4ba437:'+rel], { cwd: root }));
  }
});
after(() => writeFileSync(resolve(project, 'work/i2-identity/test-evidence.json'), JSON.stringify({
  syntheticOnly: true, productionReady: false, noRealCredentials: true, scenarios: evidence,
  cancellationDuringVerification: 'unchanged I1 deterministic core regression; service test covers handle invalidation',
  concurrentCompletionOrders: 'unchanged I1 deterministic core regression; service test covers parallel private requests'
}, null, 2)+'\n'));
