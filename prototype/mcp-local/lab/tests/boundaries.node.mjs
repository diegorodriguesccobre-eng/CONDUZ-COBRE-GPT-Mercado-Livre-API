import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const project = fileURLToPath(new URL('../..', import.meta.url)), root = resolve(project, '../..');
const work = resolve(project, 'work/i1'); mkdirSync(work, { recursive: true });
const built = await build({ absWorkingDir: project, stdin: {
  contents: "export * from './integration/profile.ts'; export * from './integration/identity-core.ts'; export * from './homologation/service-client.ts'; export {integratedFetch, createIntegratedHandler} from './integration/composition.ts'; export {IntegrationFailure} from './integration/contracts.ts';",
  resolveDir: project }, outfile: resolve(work, 'boundaries.mjs'), bundle: true, platform: 'browser', format: 'esm',
  conditions: ['workerd','browser'], external: ['cloudflare:workers'], metafile: true });
const { createLocalIntegrationProfile, requireIntegrationProfile, LOCAL_INTEGRATION_PROFILE,
  VerifiedIdentityHandles, createReadServiceClient, PortUnavailable, IntegrationFailure, integratedFetch,
  createIntegratedHandler, PORT_DEADLINE_MS, EXECUTION_PORT_DEADLINE_MS } = await import(pathToFileURL(resolve(work, 'boundaries.mjs')).href);
const principal = Object.freeze({ subject: 'a'.repeat(43), role: 'viewer', expiresAt: Date.now() + 60000 });
const commandDigest = 'b'.repeat(43), assertion = 'SYNTHETIC_ASSERTION_NOT_A_CREDENTIAL';
const input = { assertion, commandDigest };
const lookup = value => ({ handle: value.handle, commandDigest, subject: value.principal.subject, expiresAt: value.principal.expiresAt });
const response = value => Response.json({ ok: true, value });
const binding = service => ({ identity: service, registry: service, reference: service, vaults: service });
const isDependency = error => error instanceof PortUnavailable && error.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE';
const evidence = [];
const request = (url = 'http://127.0.0.1:32100/mcp', headers = {}) => new Request(url, { headers: { Host: '127.0.0.1:32100', ...headers } });

test('I1 profile is immutable, local-only and cannot be minted by a client-shaped object', () => {
  assert.ok(Object.isFrozen(LOCAL_INTEGRATION_PROFILE)); requireIntegrationProfile(LOCAL_INTEGRATION_PROFILE);
  for (const value of [null, {}, { ...LOCAL_INTEGRATION_PROFILE }, Object.freeze({ ...LOCAL_INTEGRATION_PROFILE })])
    assert.throws(() => requireIntegrationProfile(value), e => e instanceof IntegrationFailure && e.code === 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
  assert.throws(() => createLocalIntegrationProfile(null), /INTEGRATION_DEPENDENCY_UNAVAILABLE/);
});
for (const [name, req, allowed] of [
  ['loopback', request(), true], ['matching origin', request(undefined, { Origin: 'http://127.0.0.1:32100' }), true],
  ['remote HTTPS', request('https://example.invalid/mcp'), false], ['localhost alias', request('http://localhost:32100/mcp'), false],
  ['foreign Host', request(undefined, { Host: 'other.invalid' }), false], ['foreign Origin', request(undefined, { Origin: 'https://other.invalid' }), false],
  ['fragment', request('http://127.0.0.1:32100/mcp#fragment'), false]
]) test('I1 ingress profile: ' + name, () => assert.equal(LOCAL_INTEGRATION_PROFILE.acceptsIngress(req), allowed));

const jwtPair = await generateKeyPair('RS256');
const jwks = { keys: [{ ...await exportJWK(jwtPair.publicKey), alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral' }] };
// The approved constants are read from source instead of inventing a remote Access identity.
const synthetic = readFileSync(resolve(project, 'src/synthetic.ts'), 'utf8');
const ISSUER = synthetic.match(/export const ISSUER = '([^']+)'/)?.[1];
const AUDIENCE = synthetic.match(/export const AUDIENCE = '([^']+)'/)?.[1];
assert.ok(ISSUER && AUDIENCE);
const env = { SYNTHETIC_ONLY: 'B4_MCP_LOCAL_ONLY', SYNTHETIC_POLICY: 'persistent', SYNTHETIC_JWKS: jwks };
async function token({ sub = 'synthetic-operator-a', aud = AUDIENCE, iss = ISSUER, key = jwtPair.privateKey, type = 'app', exp = Math.floor(Date.now()/1000)+60 } = {}) {
  return new SignJWT({ type }).setProtectedHeader({ alg: 'RS256', kid: 'synthetic-ephemeral' }).setSubject(sub)
    .setIssuer(iss).setAudience(aud).setIssuedAt().setExpirationTime(exp).sign(key);
}
test('I1 local identity uses the existing signature verifier and hashed operator identity', async () => {
  const req = request(undefined, { 'Cf-Access-Jwt-Assertion': await token() });
  const p = await LOCAL_INTEGRATION_PROFILE.authenticate(req, env);
  assert.match(p.subject, /^[\w-]{43}$/); assert.notEqual(p.subject, 'synthetic-operator-a'); assert.equal(p.role, 'viewer');
});
for (const [name, options] of [
  ['unknown operator', { sub: 'unknown' }], ['wrong audience', { aud: 'other' }], ['wrong issuer', { iss: 'https://other.invalid' }],
  ['wrong type', { type: 'service' }], ['expired', { exp: Math.floor(Date.now()/1000)-1 }]
]) test('I1 explicit JWT refusal: ' + name, async () => {
  await assert.rejects(() => LOCAL_INTEGRATION_PROFILE.authenticate(request(undefined, { 'Cf-Access-Jwt-Assertion': options.jwt ?? '' }), env), /INTEGRATION_IDENTITY_DENIED/);
  const jwt = await token(options);
  await assert.rejects(() => LOCAL_INTEGRATION_PROFILE.authenticate(request(undefined, { 'Cf-Access-Jwt-Assertion': jwt }), env), e => e.code === 'INTEGRATION_IDENTITY_DENIED');
});
test('I1 a signature from another key is refused', async () => {
  const other = await generateKeyPair('RS256'); const jwt = await token({ key: other.privateKey });
  await assert.rejects(() => LOCAL_INTEGRATION_PROFILE.authenticate(request(undefined, { 'Cf-Access-Jwt-Assertion': jwt }), env), /INTEGRATION_IDENTITY_DENIED/);
});
for (const cause of ['ECONNRESET', 'ETIMEDOUT', 'UNAVAILABLE']) test('I1 identity dependency ' + cause + ' is not an identity/read denial', async () => {
  const profile = createLocalIntegrationProfile(async () => { throw Object.assign(new Error('PRIVATE_DETAIL'), { code: cause }); });
  const r = await createIntegratedHandler(profile)(request(), env);
  assert.equal(r.status, 503); assert.deepEqual(await r.json(), { error: 'INTEGRATION_DEPENDENCY_UNAVAILABLE' });
});
test('I1 Workers ExecutionContext is ignored as a third argument and cannot select a profile', async () => {
  const r = await integratedFetch(request(), env, { waitUntil() {}, passThroughOnException() {}, authenticate: async () => principal });
  assert.equal(r.status, 401); assert.deepEqual(await r.json(), { error: 'INTEGRATION_IDENTITY_DENIED' });
  assert.throws(() => createIntegratedHandler({ ...LOCAL_INTEGRATION_PROFILE }), /INTEGRATION_DEPENDENCY_UNAVAILABLE/);
});

test('I1 handles bind verified identity and command, reverify, consume once and never return the assertion', async () => {
  let verifies = 0;
  const h = new VerifiedIdentityHandles(async value => { assert.equal(value, assertion); verifies++; return principal; });
  const issued = await h.issue(input); assert.equal(issued.ok, true); assert.equal(h.pendingHandles, 1);
  assert.ok(!JSON.stringify(issued).includes(assertion)); assert.ok(Object.isFrozen(issued.principal));
  assert.equal((await h.lookup(lookup(issued))).ok, true); assert.equal(verifies, 2);
  assert.equal((await h.lookup(lookup(issued), true)).ok, true); assert.equal(h.pendingHandles, 0);
  assert.deepEqual(await h.lookup(lookup(issued)), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
});
for (const [name, field, value] of [['subject','subject','c'.repeat(43)], ['command','commandDigest','d'.repeat(43)], ['expiry','expiresAt',1]])
  test('I1 handle does not authorize a substituted ' + name, async () => {
    const h = new VerifiedIdentityHandles(async () => principal), issued = await h.issue(input);
    assert.deepEqual(await h.lookup({ ...lookup(issued), [field]: value }), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  });
test('I1 handles cannot be recreated by a restart or client-declared identity', async () => {
  const h = new VerifiedIdentityHandles(async () => principal), issued = await h.issue(input);
  const fresh = new VerifiedIdentityHandles(async () => principal);
  assert.deepEqual(await fresh.lookup(lookup(issued)), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal(fresh.pendingHandles, 0);
  assert.deepEqual(await fresh.issue({ ...input, subject: principal.subject, role: 'administrator', account: 'account-b' }), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  assert.equal(fresh.pendingHandles, 0);
});
test('I1 identity revocation or expiration is observed on lookup, never cached into authority', async () => {
  let allowed = true, now = Date.now();
  const h = new VerifiedIdentityHandles(async () => { if (!allowed) throw new IntegrationFailure('INTEGRATION_IDENTITY_DENIED'); return principal; }, () => now);
  const issued = await h.issue(input); allowed = false;
  assert.deepEqual(await h.lookup(lookup(issued)), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  allowed = true; now = principal.expiresAt;
  assert.deepEqual(await h.lookup(lookup(issued)), { ok: false, code: 'INTEGRATION_IDENTITY_DENIED' });
  await h.cancel(issued.handle); assert.equal(h.pendingHandles, 0);
});
test('I1 handle capacity remains bounded and expired slots are reclaimed', async () => {
  let now = Date.now(), expiry = now + 60000;
  const h = new VerifiedIdentityHandles(async () => ({ ...principal, expiresAt: expiry }), () => now);
  for (let n = 0; n < 64; n++) assert.equal((await h.issue(input)).ok, true);
  assert.deepEqual(await h.issue(input), { ok: false, code: 'INTEGRATION_BUSY' });
  now = expiry; expiry += 60000;
  assert.equal((await h.issue(input)).ok, true); assert.equal(h.pendingHandles, 1);
});
for (const cause of ['ECONNRESET', 'ETIMEDOUT', 'UNAVAILABLE']) test('I1 handle verifier dependency failure: ' + cause, async () => {
  const h = new VerifiedIdentityHandles(async () => { throw Object.assign(new Error('PRIVATE_DETAIL'), { code: cause }); });
  assert.deepEqual(await h.issue(input), { ok: false, code: 'INTEGRATION_DEPENDENCY_UNAVAILABLE' });
  assert.equal(h.pendingHandles, 0);
});

test('I1 shared client preserves the exact local budgets and closed capabilities', async () => {
  assert.equal(PORT_DEADLINE_MS, 1000); assert.equal(EXECUTION_PORT_DEADLINE_MS, 3000);
  const calls = [];
  const client = createReadServiceClient(binding({ fetch: async req => {
    calls.push({ url: req.url, method: req.method, redirect: req.redirect, keys: Object.keys(await req.json()) }); return response('ok');
  } }));
  assert.equal(await client('reference','current',null), 'ok');
  assert.deepEqual(calls, [{ url: 'https://m1-ports.invalid/reference/current', method: 'POST', redirect: 'manual', keys: ['args'] }]);
  for (const [port, method] of [['admin','seed'], ['reference','refresh'], ['vaults','connect'], ['identity','fixture'], ['registry','restore']])
    await assert.rejects(() => client(port, method, {}), isDependency);
  assert.equal(calls.length, 1);
});
for (const cause of ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'UNAVAILABLE']) test('I1 service dependency ' + cause + ' cannot prove READ_DENIED', async () => {
  const client = createReadServiceClient(binding({ fetch: async () => { throw Object.assign(new Error('SECRET_DETAIL'), { code: cause }); } }));
  await assert.rejects(() => client('reference','current',null), isDependency);
});
for (const [name, r] of [
  ['HTTP 403', () => new Response('READ_DENIED', { status: 403 })],
  ['wrong MIME', () => new Response('{}')], ['redirect', () => new Response('', { status: 302 })],
  ['unknown envelope', () => Response.json({ ok: true, value: true, extra: 'x' })],
  ['oversize', () => response('x'.repeat(17000))]
]) test('I1 malformed service response: ' + name, async () => {
  const client = createReadServiceClient(binding({ fetch: async () => r() }));
  await assert.rejects(() => client('reference','current',null), isDependency);
});
test('I1 shared client propagates abort to the operation before timeout rejection is accepted', async () => {
  let observed = false, stopped = false;
  const client = createReadServiceClient(binding({ fetch: req => new Promise((_, reject) => {
    req.signal.addEventListener('abort', () => { observed = true; stopped = true; reject(new Error('STOPPED')); }, { once: true });
  }) }));
  await assert.rejects(() => client('registry','snapshot',null), isDependency);
  assert.equal(observed, true); assert.equal(stopped, true);
  evidence.push({ name: 'cooperative-port-abort', observed, stopped, httpIOProof: 'separate unchanged M1-03B HTTP tests' });
});
test('I1 public read graph excludes identity fixture wrapper, storage drivers and test/admin entrypoints', () => {
  const inputs = Object.keys(built.metafile.inputs);
  for (const path of inputs) assert.ok(!/tests\/fixtures\/|scripts\/|recovery\/storage\.ts$|integration\/identity\.ts$/.test(path), path);
  const names = Object.values(built.metafile.outputs).flatMap(x => x.exports);
  assert.ok(!names.some(n => /fixture|seed|snapshot|restore|admin|fault/i.test(n)));
  const exports = Object.getOwnPropertyNames(VerifiedIdentityHandles.prototype).sort();
  assert.ok(!exports.some(x => /fixture|seed|snapshot|restore|mfa|grant|fault/i.test(x)));
  assert.equal(readFileSync(resolve(root, 'config/b3-readiness.json'), 'utf8').includes('"deploymentAuthorized": false'), true);
  evidence.push({ name: 'shared-read-graph', inputs, exportedNames: names, noRemoteArtifactCreated: true });
});

// Inspect every input/import/output, not a filtered list or a renamed copy.
const forbiddenPrivateInput = /(?:^|\/)(?:recovery\/(?:model|storage)|src\/persistent-model|integration\/identity)\.ts$|(?:^|\/)tests\/fixtures\/|(?:^|\/)scripts\//;
const forbiddenAdmin = /\b(?:mutationSchema|recoveryPlanSchema|simulatedMfa|updateSchema|revokeSchema|nextState|RecoveryDriver)\b|sim-security|sim-proposer|sim-reviewer/;
function assertPublicReadBuild(result) {
  for (const [name, input] of Object.entries(result.metafile.inputs)) {
    assert.ok(!forbiddenPrivateInput.test(name), 'PRIVATE_INPUT:' + name);
    if (!name.includes('node_modules/')) for (const dependency of input.imports) {
      assert.ok(!forbiddenPrivateInput.test(dependency.path), 'PRIVATE_IMPORT:' + dependency.path);
      assert.notEqual(dependency.kind, 'dynamic-import', 'DYNAMIC_APPLICATION_IMPORT:' + name);
    }
  }
  for (const file of result.outputFiles) assert.ok(!forbiddenAdmin.test(file.text), 'ADMINISTRATIVE_OUTPUT:' + file.path);
  for (const [name, output] of Object.entries(result.metafile.outputs)) for (const dependency of output.imports) {
    assert.equal(dependency.external, false, 'EXTERNAL_OUTPUT_IMPORT:' + name + ':' + dependency.path);
    assert.ok(!forbiddenPrivateInput.test(dependency.path), 'PRIVATE_OUTPUT_IMPORT:' + dependency.path);
  }
}
async function inspectBuild(contents, options = {}) {
  return build({ absWorkingDir: project, bundle: true, platform: 'browser', format: 'esm', conditions: ['workerd','browser'],
    external: ['cloudflare:workers'], metafile: true, write: false, outfile: resolve(work,'inspection.mjs'),
    stdin: { contents, resolveDir: project }, ...options });
}
test('I1-Q actual M1 public artifact and all imports/outputs contain only the read composition', async () => {
  await import('../../scripts/build-homologation.mjs');
  const actual = await build({ absWorkingDir: project, entryPoints: ['homologation/worker.ts'],
    bundle: true, platform: 'browser', format: 'esm', conditions: ['workerd','browser'], external: ['cloudflare:workers'],
    metafile: true, write: false, outfile: resolve(project,'work/homologation/worker.mjs') });
  assertPublicReadBuild(actual);
  assert.equal(actual.outputFiles.length,1);
  assert.deepEqual(actual.outputFiles[0].contents,new Uint8Array(readFileSync(resolve(project,'work/homologation/worker.mjs'))));
  assert.deepEqual(Object.values(actual.metafile.outputs).flatMap(x=>x.exports),['default']);
  assert.ok(Object.keys(actual.metafile.inputs).includes('recovery/core.ts'));
  evidence.push({ name:'I1Q-public-artifact', inputs:Object.keys(actual.metafile.inputs),
    outputs:actual.outputFiles.map(x=>({path:x.path,bytes:x.contents.length})), exports:['default'],
    forbiddenPrivateInputs:0, forbiddenAdministrativeComponents:0, comparedWithActualEmittedArtifact:true });
});
test('I1-Q reusable integrated reader also excludes the private model and administrative schemas', async () => {
  const reader=await inspectBuild("export {integratedFetch,createIntegratedHandler} from './integration/composition.ts';");
  assertPublicReadBuild(reader);
  assert.deepEqual(Object.values(reader.metafile.outputs).flatMap(x=>x.exports).sort(),['createIntegratedHandler','integratedFetch']);
});
for (const symbol of ['mutationSchema','recoveryPlanSchema','simulatedMfa','updateSchema','revokeSchema'])
  test('I1-Q compiled administrative component is rejected: '+symbol, async () => {
    const dirty=await inspectBuild('export const '+symbol+' = { unauthorized: true };');
    assert.throws(()=>assertPublicReadBuild(dirty), /ADMINISTRATIVE_OUTPUT:/);
  });
for (const [name, contents] of [
  ['side-effect wrapper', "import './recovery/model.ts'; export default {};"],
  ['renamed private schema', "export {recoveryPlanSchema as innocentData} from './recovery/model.ts';"],
  ['transitive grant wrapper', "export {grantSchema} from './src/persistent-model.ts';"],
  ['dynamic import', "export async function innocuous(){return import('./recovery/model.ts');}"]
]) test('I1-Q private transitively imported component cannot hide behind '+name, async () => {
  const dirty=await inspectBuild(contents,{minify:true});
  assert.throws(()=>assertPublicReadBuild(dirty), /PRIVATE_INPUT:|PRIVATE_IMPORT:|DYNAMIC_APPLICATION_IMPORT:/);
});
test('I1-Q core has no import back to private wrappers and historical schemas are the same shared objects', async () => {
  await build({ absWorkingDir:project, stdin:{ contents:
    "export * as core from './recovery/core.ts'; export * as recovery from './recovery/model.ts'; export * as grants from './src/persistent-model.ts';",
    resolveDir:project }, outfile:resolve(work,'private-compatibility.mjs'),bundle:true,platform:'node',format:'esm' });
  const {core,recovery,grants}=await import(pathToFileURL(resolve(work,'private-compatibility.mjs')).href);
  for(const name of ['subjectSchema','pairSchema','revisionSchema','grantSchema']) assert.equal(grants[name],core[name],name);
  for(const name of ['ENVIRONMENT','ENROLLMENT','accounts','stateSchema','canonical','fingerprint','headSchema'])
    assert.equal(recovery[name],core[name],name);
  for(const name of ['mutationSchema','recoveryPlanSchema','nextState','RecoveryError','fail','identitySchema','requestSchema'])
    assert.ok(recovery[name], 'Historical private recovery export missing: '+name);
  assert.ok(grants.updateSchema && grants.revokeSchema && grants.fingerprint && grants.PARTITIONS);
  const source=readFileSync(resolve(project,'recovery/core.ts'),'utf8');
  assert.ok(!/from\s+['"][^'"]*(?:persistent-model|recovery\/model|\.\/model|storage)/.test(source));
  assert.ok(!forbiddenAdmin.test(source));
  evidence.push({name:'I1Q-historical-reexports',sharedSchemaObjects:true,privateOperationsPreserved:true});
});
test('I1-Q moved read schemas and private mutation logic retain their approved source definitions', () => {
  const original=path=>execFileSync('git',['--no-replace-objects','show','f20cf44ccf401080f28ff4bb068e27d436d08f66:'+path],{cwd:root}).toString();
  const grants=original('prototype/mcp-local/src/persistent-model.ts'), recovery=original('prototype/mcp-local/recovery/model.ts');
  const core=readFileSync(resolve(project,'recovery/core.ts'),'utf8');
  assert.ok(core.includes(grants.slice(grants.indexOf('// Same issuer-bound'),grants.indexOf('export const updateSchema'))));
  assert.ok(core.includes(recovery.slice(recovery.indexOf('export const ENVIRONMENT'),recovery.indexOf('export class RecoveryError'))));
  assert.ok(core.includes(recovery.slice(recovery.indexOf('export interface ReferenceHead'),recovery.indexOf('export function nextState'))));
  assert.ok(readFileSync(resolve(project,'recovery/model.ts'),'utf8').endsWith(recovery.slice(recovery.indexOf('export function nextState'))));
  const currentGrants=readFileSync(resolve(project,'src/persistent-model.ts'),'utf8');
  assert.ok(currentGrants.endsWith(grants.slice(grants.indexOf('export const updateSchema'))));
});
test('I1-Q grant validation keeps strict bounds through the historical reexport', async () => {
  const {core,grants}=await import(pathToFileURL(resolve(work,'private-compatibility.mjs')).href);
  const valid={account:'account-a',subject:'a'.repeat(43),permissions:['read'],validFrom:1,validUntil:86400001,revision:1};
  assert.deepEqual(core.grantSchema.parse(valid),grants.grantSchema.parse(valid));
  for(const bad of [{...valid,permissions:[]},{...valid,permissions:['read','read']},{...valid,permissions:['admin']},
    {...valid,validUntil:86400002},{...valid,revision:0},{...valid,seller_id:'untrusted'}])
    assert.equal(grants.grantSchema.safeParse(bad).success,false);
  assert.equal(grants.updateSchema.safeParse({grant:valid,expectedRevision:0}).success,true);
  assert.equal(grants.revokeSchema.safeParse({account:'account-a',subject:valid.subject,expectedRevision:0}).success,true);
  assert.equal(grants.revokeSchema.safeParse({account:'account-a',subject:valid.subject,expectedRevision:0,admin:true}).success,false);
});

after(() => writeFileSync(resolve(work, 'boundary-evidence.json'), JSON.stringify({ syntheticOnly: true, remoteHomologation: false, evidence }, null, 2)+'\n'));
