import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectSnapshot, validateSnapshot, I1_BASE, I1_ADDED, I1_MODIFIED, I1Q_PATHS } from '../../scripts/verify-b4-preservation.mjs';

const root = fileURLToPath(new URL('../..', import.meta.url));
const original = collectSnapshot(root), copy = () => ({ ...original, current: new Map(original.current), i1Base: new Map(original.i1Base) });
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const added = ['prototype/mcp-local/integration/profile.ts','prototype/mcp-local/integration/identity-core.ts',
  'prototype/mcp-local/homologation/service-client.ts','prototype/mcp-local/lab/tests/boundaries.node.mjs','tests/b4/m21-preservation.node.mjs','prototype/mcp-local/recovery/core.ts'];
const modified = ['prototype/mcp-local/integration/composition.ts','prototype/mcp-local/integration/identity.ts',
  'prototype/mcp-local/homologation/ports.ts','scripts/verify-b4-preservation.mjs','prototype/mcp-local/tests/homologation.test.mjs','prototype/mcp-local/recovery/model.ts',
  'prototype/mcp-local/integration/guardian-adapter.ts','prototype/mcp-local/src/persistent-model.ts'];
const refused = (snapshot, pattern) => assert.throws(() => validateSnapshot(snapshot), error => error instanceof Error
  && error.constructor.name === 'PreservationFailure' && pattern.test(error.message));

test('I1 preservation accepts only six additions/eight exact transformations at the fixed main checkpoint', () => {
  assert.equal(I1_BASE, 'f20cf44ccf401080f28ff4bb068e27d436d08f66');
  assert.deepEqual(I1_ADDED, added); assert.deepEqual(I1_MODIFIED, modified);
  assert.ok(Object.isFrozen(I1_ADDED) && Object.isFrozen(I1_MODIFIED));
  const r = validateSnapshot(copy());
  assert.equal(r.candidateFiles, 178); assert.equal(r.i1ProtectedFiles, 164); assert.equal(r.i1Added, 6);
  assert.equal(r.byteIdentical, 94); assert.equal(r.activationBlocked, true); assert.equal(r.originalVerifierPreserved, true);
  assert.deepEqual(r.exceptions, ['package.json','package-lock.json','.github/workflows/b3-sqlite.yml']);
});
for (const path of [...added,...modified]) {
  test('I1 exact content hash refuses an extra byte: ' + path, () => {
    const s = copy(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
    refused(s, /^I1_CONTENT_CHANGED:/);
  });
  test('I1 required file cannot be missing: ' + path, () => { const s = copy(); s.current.delete(path); refused(s, /^CANDIDATE_INVENTORY$/); });
}
test('I1 all other 164 main files remain byte-for-byte protected', () => {
  let count = 0;
  for (const [path, bytes] of original.i1Base) if (!modified.includes(path)) {
    assert.deepEqual(original.current.get(path), bytes);
    const s = copy(); s.current.set(path, Buffer.concat([bytes, Buffer.from('\n')]));
    refused(s, /^(?:HISTORICAL_CHANGED:|B4_BASE_CHANGED:|APPROVED_DEPENDENCY_CHANGED:|SQLITE_CHANGE_NOT_ALLOWED$|CI_CHANGE_NOT_ALLOWED$|MCP_WORKFLOW_CHANGE_NOT_ALLOWED$|M1_PUBLISHED_CHANGED:|M20_PUBLISHED_CHANGED:|I1_PUBLISHED_CHANGED:)/);
    count++;
  }
  assert.equal(count, 164);
});
for (const path of ['private.zip','prototype/mcp-local/lab/extra.ts','prototype/mcp-local/lab/tests/unapproved.node.mjs',
  '../profile.ts','/tmp/profile.ts','prototype\\mcp-local\\integration\\profile.ts','prototype/mcp-local/lab/../profile.ts'])
  test('I1 unexpected/incompatible path is not enrolled: ' + path, () => {
    const s = copy(); s.current.set(path, Buffer.from('UNAPPROVED')); refused(s, /^CANDIDATE_INVENTORY$/);
  });
test('I1 ancestry and complete baseline cannot be replaced by branch hints or caller arguments', () => {
  refused({ ...copy(), i1Ancestor: false }, /^I1_BASE_DIVERGED$/);
  const s = copy(); s.i1Base.delete('src/b3/adapter.ts'); refused(s, /^I1_BASE_INVENTORY$/);
});
test('I1 the normalized self-hash cannot authorize changing its own declared digest', () => {
  const s = copy(), path = 'scripts/verify-b4-preservation.mjs';
  s.current.set(path, Buffer.from(s.current.get(path).toString().replace(/^const I1_VERIFIER_HASH = '[a-f0-9]{64}';$/m,
    "const I1_VERIFIER_HASH = '"+'f'.repeat(64)+"';")));
  refused(s, /^I1_CONTENT_CHANGED:scripts\/verify-b4-preservation\.mjs$/);
});
test('I1 base matches the original Git tree independently of the verifier counters', () => {
  const paths = execFileSync('git',['--no-replace-objects','ls-tree','-r','--name-only','-z',I1_BASE], { cwd: root }).toString().split('\0').filter(Boolean);
  assert.equal(paths.length, 172);
  const changed = [];
  for (const path of paths) {
    const expected = execFileSync('git',['--no-replace-objects','show',I1_BASE+':'+path], { cwd: root });
    const current = readFileSync(resolve(root,path));
    if (!current.equals(expected)) changed.push(path);
  }
  assert.deepEqual(changed.sort(), [...modified].sort());
  assert.equal(sha(readFileSync(resolve(root,'scripts/verify-b3-preservation.mjs'))),
    sha(execFileSync('git',['show',I1_BASE+':scripts/verify-b3-preservation.mjs'], { cwd: root })));
});
test('I1 symlinked authorized file and symlinked parent are refused before content authorization', () => {
  const work = resolve(root,'prototype/mcp-local/work'); mkdirSync(work,{recursive:true});
  const temp = mkdtempSync(resolve(work,'i1-preservation-'));
  try {
    const repo = resolve(temp,'repository'); execFileSync('git',['clone','--no-hardlinks',root,repo], { stdio:'pipe' });
    for (const [name,bytes] of original.current) { const path=resolve(repo,name); mkdirSync(dirname(path),{recursive:true}); writeFileSync(path,bytes); }
    const path=resolve(repo,added[0]); rmSync(path); symlinkSync(resolve(repo,'src/b3/adapter.ts'),path);
    assert.throws(()=>collectSnapshot(repo), error=>error.constructor.name==='PreservationFailure' && error.message==='SYMLINK_REJECTED');
    rmSync(path); writeFileSync(path,original.current.get(added[0]));
    const dir=resolve(repo,'prototype/mcp-local/lab'), target=resolve(temp,'external-lab');
    rmSync(dir,{recursive:true}); mkdirSync(target); mkdirSync(resolve(target,'tests'));
    writeFileSync(resolve(target,'tests/boundaries.node.mjs'),original.current.get(added[3])); symlinkSync(target,dir);
    assert.throws(()=>collectSnapshot(repo), error=>error.constructor.name==='PreservationFailure' && error.message==='SYMLINK_REJECTED');
  } finally { rmSync(temp,{recursive:true,force:true}); }
});

test('I1-Q scope contains exactly the eight separately authorized paths', () => {
  assert.deepEqual(I1Q_PATHS, ['prototype/mcp-local/recovery/core.ts','prototype/mcp-local/recovery/model.ts',
    'prototype/mcp-local/integration/guardian-adapter.ts','prototype/mcp-local/src/persistent-model.ts',
    'prototype/mcp-local/lab/tests/boundaries.node.mjs','scripts/verify-b4-preservation.mjs',
    'tests/b4/m21-preservation.node.mjs','prototype/mcp-local/tests/homologation.test.mjs']);
  assert.ok(Object.isFrozen(I1Q_PATHS)); assert.equal(new Set(I1Q_PATHS).size, 8);
});
for (const [name, mutate] of [
  ['remove boundaries invocation', text => text.replace("file: 'lab/tests/boundaries.node.mjs'", "file: 'lab/tests/omitted.node.mjs'")],
  ['remove preservation invocation', text => text.replace("file: '../../tests/b4/m21-preservation.node.mjs'", "file: '../../tests/b4/omitted.node.mjs'")],
  ['replace child execution', text => text.replace("['--test', '--test-reporter=tap', suite.file]", "['--version']")]
]) test('I1-Q CI cannot silently ' + name, () => {
  const s=copy(), path='prototype/mcp-local/tests/homologation.test.mjs', text=s.current.get(path).toString(), changed=mutate(text);
  assert.notEqual(changed,text,'The mutation must actually affect the CI bridge');
  s.current.set(path,Buffer.from(changed)); refused(s,/^I1_CONTENT_CHANGED:/);
});
