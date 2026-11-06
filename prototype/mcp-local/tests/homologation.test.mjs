import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectSnapshot, readGitSnapshots, validateSnapshot, expectedSQLiteWorkflow, expectedCIDispatcher, M1_ADDED, M1_MODIFIED, M1_BASE, B31, B4, M20_BASE, M20_MODIFIED, I1_BASE, I1_CI_PATHS, I2_BASE, I2_ADDED, I2_MODIFIED } from '../../../scripts/verify-b4-preservation.mjs';
import { verifyInventory, suites } from '../scripts/ci.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const root = resolve(project, '../..');
const paths = [
  'prototype/mcp-local/homologation/ports.ts',
  'prototype/mcp-local/homologation/composition.ts',
  'prototype/mcp-local/homologation/worker.ts',
  'prototype/mcp-local/scripts/build-homologation.mjs',
  'prototype/mcp-local/scripts/homologation-harness.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs',
  'prototype/mcp-local/tsconfig.homologation.json',
  'prototype/mcp-local/docs/homologation-m1.md'
];
const collected = collectSnapshot(root);
// Memory-only candidates let the verifier be checked before M1 implementation starts.
const complete = () => {
  const current = new Map(collected.current);
  for (const p of paths) if (!current.has(p)) current.set(p, Buffer.from('MEMORY_ONLY_NEW_M1_PATH'));
  return { ...collected, current, m1Base: new Map(collected.m1Base), m20Base: new Map(collected.m20Base) };
};
const refused = (s, reason) => assert.throws(() => validateSnapshot(s), e =>
  e instanceof Error && e.constructor.name === 'PreservationFailure' && (typeof reason === 'string' ? e.message === reason : reason.test(e.message)));

const gitBatchEvidence = [], batchRefs = Object.freeze([B31, B4, M1_BASE, M20_BASE, I1_BASE]);
const batchBytes = Buffer.from([...Array.from({ length: 256 }, (_, n) => n), 0, 255, 13, 10]);
const blobOid = bytes => createHash('sha1').update('blob ' + bytes.length + '\0').update(bytes).digest('hex');
const batchFrame = bytes => Buffer.concat([Buffer.from(blobOid(bytes) + ' blob ' + bytes.length + '\n'), bytes, Buffer.from('\n')]);
const batchHeader = (raw, header) => Buffer.concat([Buffer.from(header + '\n'), raw.subarray(raw.indexOf(10) + 1)]);
function syntheticBatchGit({ blobs = [batchBytes], name = 'nested/data.bin', mode = '100644', tree = x => x, batch = x => x } = {}) {
  const calls = [], unique = [...new Map(blobs.map(bytes => [blobOid(bytes), bytes])).values()];
  const metadata = Buffer.from(blobs.map((bytes, n) => mode + ' blob ' + blobOid(bytes) + '\t' + (n ? 'second.bin' : name) + '\0').join(''));
  return { calls, run(args, input) {
    calls.push({ args: [...args], input: input && Buffer.from(input) });
    if (args[0] === 'ls-tree') {
      assert.deepEqual(args, ['ls-tree', '-r', '-z', '--full-tree', batchRefs[calls.length - 1]]);
      assert.equal(input, undefined); return tree(Buffer.from(metadata));
    }
    assert.deepEqual(args, ['cat-file', '--batch']);
    assert.deepEqual(input, Buffer.from(unique.map(blobOid).join('\n') + '\n'));
    return batch(Buffer.concat(unique.map(batchFrame)));
  } };
}
const batchRefusal = (fake, reason) => {
  assert.throws(() => readGitSnapshots(fake.run), error => error?.constructor.name === 'PreservationFailure' && error.message === reason);
  assert.ok(fake.calls.length <= 6);
  assert.ok(fake.calls.every(call => call.args[0] === 'ls-tree' || call.args[0] === 'cat-file'), 'No fallback Git command');
};
test('M1-BATCH: all 749 fixed-tree files equal the independent git show oracle byte for byte', () => {
  const calls = [], started = performance.now();
  const snapshots = readGitSnapshots((args, input) => {
    calls.push(args);
    return execFileSync('git', ['--no-optional-locks', '--no-replace-objects', ...args], {
      cwd: root, input, maxBuffer: 16*1024*1024, stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'] });
  });
  const batchMilliseconds = performance.now() - started, oracleStarted = performance.now();
  assert.deepEqual([...snapshots.keys()], batchRefs); assert.equal(calls.length, 6);
  assert.deepEqual(calls.slice(0, 5), batchRefs.map(ref => ['ls-tree', '-r', '-z', '--full-tree', ref]));
  assert.deepEqual(calls[5], ['cat-file', '--batch']);
  let files = 0, bytes = 0;
  for (const [ref, snapshot] of snapshots) {
    const names = execFileSync('git', ['--no-replace-objects','ls-tree','-r','--name-only','-z',ref], { cwd: root })
      .toString().split('\0').filter(Boolean);
    assert.deepEqual([...snapshot.keys()], names);
    for (const name of names) {
      const expected = execFileSync('git', ['--no-replace-objects','show',ref + ':' + name], { cwd: root });
      assert.deepEqual(snapshot.get(name), expected); files++; bytes += expected.length;
    }
  }
  assert.equal(files, 749);
  gitBatchEvidence.push({ files, bytes, batchGitProcesses: calls.length, oracleGitProcesses: files + 5,
    batchMilliseconds, oracleMilliseconds: performance.now() - oracleStarted, byteIdentical: true });
});
test('M1-BATCH: binary, NUL, CRLF and non-UTF8 blob bytes are preserved with six Git processes', () => {
  const fake = syntheticBatchGit(), snapshots = readGitSnapshots(fake.run);
  assert.equal(fake.calls.length, 6);
  for (const snapshot of snapshots.values()) assert.deepEqual(snapshot.get('nested/data.bin'), batchBytes);
});
test('M1-BATCH: empty blobs, executable files and literal tab/newline/UTF8 path names retain their bytes', () => {
  const name = 'nested/açãо\tline\n.bin', fake = syntheticBatchGit({ blobs: [Buffer.alloc(0)], name, mode: '100755' });
  for (const snapshot of readGitSnapshots(fake.run).values()) assert.deepEqual([...snapshot], [[name, Buffer.alloc(0)]]);
});
test('M1-BATCH: shared OIDs are read once but returned maps own independent buffers', () => {
  const fake = syntheticBatchGit({ blobs: [batchBytes, batchBytes] }), snapshots = readGitSnapshots(fake.run);
  assert.equal(fake.calls.length, 6); assert.equal(fake.calls.at(-1).input.toString(), blobOid(batchBytes) + '\n');
  snapshots.get(B31).get('nested/data.bin')[0] = 255;
  assert.deepEqual(snapshots.get(B31).get('second.bin'), batchBytes);
  assert.deepEqual(snapshots.get(B4).get('nested/data.bin'), batchBytes);
});
test('M1-BATCH: every invocation reads its current Git input without a persistent cache', () => {
  const first = syntheticBatchGit(), secondBytes = Buffer.from('different current object'), second = syntheticBatchGit({ blobs: [secondBytes] });
  assert.deepEqual(readGitSnapshots(first.run).get(B31).get('nested/data.bin'), batchBytes);
  assert.deepEqual(readGitSnapshots(second.run).get(B31).get('nested/data.bin'), secondBytes);
  assert.equal(first.calls.length, 6); assert.equal(second.calls.length, 6);
});
for (const phase of ['ls-tree', 'cat-file']) test('M1-BATCH: Git failure at ' + phase + ' is explicit and never falls back', () => {
  const fake = syntheticBatchGit(), original = fake.run;
  fake.run = (args, input) => {
    if (args[0] === phase) { fake.calls.push({ args }); throw Object.assign(new Error('SYNTHETIC_GIT_UNAVAILABLE'), { code: 'ECONNRESET' }); }
    return original(args, input);
  };
  batchRefusal(fake, 'GIT_READ_FAILED'); assert.equal(fake.calls.length, phase === 'ls-tree' ? 1 : 6);
});
for (const [name, mutate, reason] of [
  ['non-buffer metadata', x => x.toString(), 'GIT_OUTPUT_NOT_BUFFER'],
  ['truncated metadata', x => x.subarray(0, -1), 'GIT_TREE_TRUNCATED'],
  ['invalid path UTF8', () => Buffer.concat([Buffer.from('100644 blob ' + blobOid(batchBytes) + '\t'), Buffer.from([255,0])]), 'GIT_TREE_ENCODING'],
  ['missing metadata separator', x => Buffer.from(x.toString().replace('\t',' ')), 'GIT_TREE_ENTRY'],
  ['symlink object mode', x => Buffer.from(x.toString().replace('100644','120000')), 'GIT_TREE_ENTRY'],
  ['gitlink object type', x => Buffer.from(x.toString().replace('100644 blob','160000 commit')), 'GIT_TREE_ENTRY'],
  ['tree instead of blob', x => Buffer.from(x.toString().replace(' blob ',' tree ')), 'GIT_TREE_ENTRY'],
  ['invalid OID', x => Buffer.from(x.toString().replace(blobOid(batchBytes),'z'.repeat(40))), 'GIT_TREE_ENTRY'],
  ['duplicate path', x => Buffer.concat([x,x]), 'GIT_TREE_PATH'],
  ['absolute path', x => Buffer.from(x.toString().replace('nested/data.bin','/data.bin')), 'GIT_TREE_PATH'],
  ['dot-dot path', x => Buffer.from(x.toString().replace('nested/data.bin','nested/../data.bin')), 'GIT_TREE_PATH'],
  ['dot path', x => Buffer.from(x.toString().replace('nested/data.bin','./data.bin')), 'GIT_TREE_PATH'],
  ['empty component', x => Buffer.from(x.toString().replace('nested/data.bin','nested//data.bin')), 'GIT_TREE_PATH'],
  ['backslash path', x => Buffer.from(x.toString().replace('nested/data.bin','nested\\data.bin')), 'GIT_TREE_PATH'],
  ['empty path', x => Buffer.from(x.toString().replace('nested/data.bin','')), 'GIT_TREE_PATH']
]) test('M1-BATCH: refuses ' + name, () => batchRefusal(syntheticBatchGit({ tree: mutate }), reason));
for (const [name, mutate, reason] of [
  ['non-buffer object output', x => x.toString(), 'GIT_OUTPUT_NOT_BUFFER'],
  ['empty response', () => Buffer.alloc(0), 'GIT_BATCH_HEADER'],
  ['header without newline', x => x.subarray(0,x.indexOf(10)), 'GIT_BATCH_HEADER'],
  ['missing object', () => Buffer.from(blobOid(batchBytes) + ' missing\n'), 'GIT_OBJECT_MISSING'],
  ['unexpected object ID', x => batchHeader(x, 'e'.repeat(40) + ' blob ' + batchBytes.length), 'GIT_BATCH_OBJECT_MISMATCH'],
  ['object type changed', x => batchHeader(x, blobOid(batchBytes) + ' tree ' + batchBytes.length), 'GIT_BATCH_HEADER'],
  ['negative size', x => batchHeader(x, blobOid(batchBytes) + ' blob -1'), 'GIT_BATCH_HEADER'],
  ['noncanonical size', x => batchHeader(x, blobOid(batchBytes) + ' blob 0' + batchBytes.length), 'GIT_BATCH_HEADER'],
  ['non-numeric size', x => batchHeader(x, blobOid(batchBytes) + ' blob NaN'), 'GIT_BATCH_HEADER'],
  ['unsafe integer size', x => batchHeader(x, blobOid(batchBytes) + ' blob 9007199254740993'), 'GIT_OBJECT_SIZE'],
  ['object over byte bound', x => batchHeader(x, blobOid(batchBytes) + ' blob 16777217'), 'GIT_OBJECT_SIZE'],
  ['truncated object', x => x.subarray(0,-2), 'GIT_BATCH_TRUNCATED'],
  ['missing object delimiter', x => x.subarray(0,-1), 'GIT_BATCH_TRUNCATED'],
  ['incorrect delimiter', x => Buffer.concat([x.subarray(0,-1),Buffer.from('x')]), 'GIT_BATCH_DELIMITER'],
  ['modified blob bytes', x => { x[x.indexOf(10)+1] ^= 1; return x; }, 'GIT_OBJECT_INTEGRITY'],
  ['trailing bytes', x => Buffer.concat([x,Buffer.from('unexpected')]), 'GIT_BATCH_TRAILING'],
  ['duplicate response', x => Buffer.concat([x,x]), 'GIT_BATCH_TRAILING']
]) test('M1-BATCH: refuses ' + name, () => batchRefusal(syntheticBatchGit({ batch: mutate }), reason));
test('M1-BATCH: multiple objects retain request order and a missing second response is refused', () => {
  const other = Buffer.from('second object'), correct = syntheticBatchGit({ blobs: [batchBytes, other] });
  for (const snapshot of readGitSnapshots(correct.run).values()) assert.deepEqual(snapshot.get('second.bin'), other);
  batchRefusal(syntheticBatchGit({ blobs: [batchBytes, other], batch: () => Buffer.concat([batchFrame(other),batchFrame(batchBytes)]) }), 'GIT_BATCH_OBJECT_MISMATCH');
  batchRefusal(syntheticBatchGit({ blobs: [batchBytes, other], batch: () => batchFrame(batchBytes) }), 'GIT_BATCH_HEADER');
});

test('M1-01: exactly the eight previously approved names are accepted', () => {
  assert.deepEqual(M1_ADDED, paths); assert.equal(Object.isFrozen(M1_ADDED), true);
  const r = validateSnapshot(complete());
  assert.equal(r.candidateFiles, 184); assert.equal(r.m1Added, 8);
  assert.equal(r.publishedByteIdentical, 155); assert.equal(r.byteIdentical, 94);
  assert.deepEqual(M1_MODIFIED, ['scripts/verify-b4-preservation.mjs', 'prototype/mcp-local/scripts/ci.mjs', '.github/workflows/b3-sqlite.yml', '.github/workflows/b4-mcp-local.yml']);
  assert.equal(Object.isFrozen(M1_MODIFIED), true);
  assert.deepEqual(r.authorizedPublishedModifications, M1_MODIFIED);
  assert.equal(r.m1Base, '5f06c69dc3ace96419f4e78a9675d257cc12b45a');
  assert.deepEqual(r.exceptions, ['package.json', 'package-lock.json', '.github/workflows/b3-sqlite.yml']);
});
for (const path of paths) test('M1-01: required file cannot be absent: ' + path, () => {
  const s = complete(); s.current.delete(path); refused(s, 'CANDIDATE_INVENTORY');
});
for (const path of ['prototype/mcp-local/homologation/unapproved.ts', 'private-backup.zip',
  '../ports.ts', '/tmp/ports.ts', 'prototype\\mcp-local\\homologation\\ports.ts',
  'prototype/mcp-local/homologation/../ports.ts', 'Prototype/mcp-local/homologation/ports.ts']) {
  test('M1-01: unexpected or incompatible inventory path is refused: ' + path, () => {
    const s = complete(); s.current.set(path, Buffer.from('UNAPPROVED')); refused(s, 'CANDIDATE_INVENTORY');
  });
}
test('M1-01: all 163 other published files are protected, including former B4 additions', () => {
  let protectedFiles = 0;
  for (const path of collected.m1Base.keys()) if (path !== 'scripts/verify-b4-preservation.mjs') {
    const s = complete(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
    refused(s, /^(?:HISTORICAL_CHANGED:|B4_BASE_CHANGED:|APPROVED_DEPENDENCY_CHANGED:|SQLITE_CHANGE_NOT_ALLOWED$|CI_CHANGE_NOT_ALLOWED$|MCP_WORKFLOW_CHANGE_NOT_ALLOWED$|M1_PUBLISHED_CHANGED:|I1_CONTENT_CHANGED:)/);
    protectedFiles++;
  }
  assert.equal(protectedFiles, 163);
});
for (const path of ['package.json', 'package-lock.json', 'prototype/mcp-local/package.json', 'prototype/mcp-local/package-lock.json']) {
  test('M1-01: approved dependency bytes remain pinned: ' + path, () => {
    const s = complete(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
    refused(s, 'APPROVED_DEPENDENCY_CHANGED:' + path);
  });
}
test('M1-01: original B3.1 verifier cannot change', () => {
  const s = complete(); s.current.set('scripts/verify-b3-preservation.mjs', Buffer.from('process.exit(0)'));
  refused(s, 'HISTORICAL_CHANGED:scripts/verify-b3-preservation.mjs');
});
test('M1-01: production interlocks and readiness cannot change', () => {
  for (const path of ['src/preparation/config.ts', 'src/b3/entrypoint.ts', 'config/b3-readiness.json']) {
    const s = complete(); s.current.set(path, Buffer.from('ACTIVATION_ATTEMPT'));
    refused(s, 'HISTORICAL_CHANGED:' + path);
  }
});
test('M1-01: fourth historical exception and both divergent bases are refused', () => {
  const changed = complete(); changed.current.set('src/b3/adapter.ts', Buffer.from('CHANGED'));
  refused(changed, 'HISTORICAL_CHANGED:src/b3/adapter.ts');
  refused({ ...complete(), ancestor: false }, 'BASE_DIVERGED');
  refused({ ...complete(), m1Ancestor: false }, 'M1_BASE_DIVERGED');
});
test('M1-01: published baseline cannot be omitted from the new checks', () => {
  const s = complete(); s.m1Base.delete('src/b3/adapter.ts'); refused(s, 'M1_BASE_INVENTORY');
});
test('M1-01: collection rejects file and parent-directory symlinks', () => {
  const work = resolve(project, 'work'); mkdirSync(work, { recursive: true });
  const tmp = mkdtempSync(resolve(work, 'm1-preservation-'));
  try {
    const repo = resolve(tmp, 'repository');
    execFileSync('git', ['clone', '--no-hardlinks', root, repo], { stdio: 'pipe' });
    for (const [path, bytes] of complete().current) { const target = resolve(repo, path); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, bytes); }
    const target = resolve(repo, paths[0]); rmSync(target); symlinkSync(resolve(repo, 'src/b3/adapter.ts'), target);
    assert.throws(() => collectSnapshot(repo), e => e.constructor.name === 'PreservationFailure' && e.message === 'SYMLINK_REJECTED');
    rmSync(target); writeFileSync(target, 'LOCAL_TEST_ONLY');
    const directory = dirname(target), moved = directory + '-real'; renameSync(directory, moved); symlinkSync(moved, directory);
    assert.throws(() => collectSnapshot(repo), e => e.constructor.name === 'PreservationFailure' && e.message === 'SYMLINK_REJECTED');
  } finally { rmSync(tmp, { recursive: true, force: true }); }
});

// M1-02 probes use private filesystem fixtures; the candidate is never edited by a negative test.
const ciPath = 'prototype/mcp-local/scripts/ci.mjs';
const sqlitePath = '.github/workflows/b3-sqlite.yml';
const ciFiles = ['hardening.test.mjs','interoperability.test.mjs','persistence.test.mjs',
  'recovery.test.mjs','vault-isolation.test.mjs','integration.test.mjs','query-classification.test.mjs','homologation.test.mjs'].sort();
const groupNames = ['mcp','persistence','recovery','vault','integration','homologation','buffering','regression'];
const ciContextEvidence = [];
function fixtureWrite(directory, path, bytes = '') {
  const file = resolve(directory, path); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, bytes); return file;
}
function inventoryFixture(run) {
  mkdirSync(resolve(project, 'work'), { recursive: true });
  const directory = mkdtempSync(resolve(project, 'work/m1-ci-inventory-'));
  try {
    fixtureWrite(directory, ciPath, readFileSync(resolve(root, ciPath)));
    fixtureWrite(directory, '.github/workflows/b4-mcp-local.yml', readFileSync(resolve(root, '.github/workflows/b4-mcp-local.yml')));
    fixtureWrite(directory, 'tests/b4/preservation.node.mjs');
    fixtureWrite(directory, 'prototype/mcp-local/scripts/prove-buffering.mjs');
    fixtureWrite(directory, 'prototype/mcp-local/tests/fixtures/buffering-worker.ts');
    for (const file of ciFiles) fixtureWrite(directory, 'prototype/mcp-local/tests/' + file);
    return run(directory);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
function inventoryProbe(directory) {
  return execFileSync(process.execPath, [resolve(directory, ciPath), 'verify'], {
    cwd: directory, stdio: 'pipe', timeout: 10000
  });
}
function probeRefused(directory, message) {
  assert.throws(() => inventoryProbe(directory), e => e.status === 1 && e.signal === null
    && message.test(e.stderr.toString()), 'Only an explicit inventory failure satisfies this negative probe');
}
function replaceOne(text, before, after) {
  assert.equal(text.split(before).length, 2, 'The mutation must change exactly one known location');
  return text.replace(before, after);
}
test('M1-02: real dispatcher accepts exactly eight named test files and eight explicit groups', () => {
  const r = verifyInventory(); assert.deepEqual(r.testFiles, ciFiles); assert.deepEqual(r.suiteGroups, groupNames);
  inventoryFixture(directory => assert.deepEqual(JSON.parse(inventoryProbe(directory)), r));
});
test('M1-02: recursive unknown tests are rejected rather than automatically enrolled', () => inventoryFixture(directory => {
  fixtureWrite(directory, 'prototype/mcp-local/tests/nested/unapproved.test.mjs');
  probeRefused(directory, /nested\/unapproved\.test\.mjs/);
}));
for (const file of ciFiles) test('M1-02: CI refuses missing mandatory test ' + file, () => inventoryFixture(directory => {
  rmSync(resolve(directory, 'prototype/mcp-local/tests/' + file)); probeRefused(directory, new RegExp(file.replaceAll('.', '\\.')));
}));
for (const [name, mutate, message] of [
  ['M1 typecheck removal', text => replaceOne(text, ",typecheck:'tsconfig.homologation.json'", ''), /Missing M1 typecheck/],
  ['M1 execution removal', text => replaceOne(text, "['node','--test','tests/homologation.test.mjs']", '[]'), /Missing execution: homologation\/homologation\.test\.mjs/],
  ['M1 execution replaced by a no-op', text => replaceOne(text, "['node','--test','tests/homologation.test.mjs']", "['echo','--test','tests/homologation.test.mjs']"), /Missing M1 execution/],
  ['required group removal', text => replaceOne(text, " homologation:{files:['homologation.test.mjs'],typecheck:'tsconfig.homologation.json',commands:[['node','--test','tests/homologation.test.mjs']]},\n", ''), /Missing required groups/],
  ['duplicate test ownership', text => replaceOne(text, "files:['integration.test.mjs','query-classification.test.mjs']", "files:['integration.test.mjs','query-classification.test.mjs','homologation.test.mjs']"), /Duplicate test ownership/],
  ['integration typecheck removal', text => replaceOne(text, "integration:{files:['integration.test.mjs','query-classification.test.mjs'],typecheck:'tsconfig.integration.json'", "integration:{files:['integration.test.mjs','query-classification.test.mjs']"), /Unreviewed suite commands/],
  ['generic no-op in another group', text => replaceOne(text, "['npm','run','build:local']", "['echo','build skipped']"), /Unreviewed suite commands/],
  ['extra successful no-op command', text => replaceOne(text, "commands:[['node','--test','tests/homologation.test.mjs']]", "commands:[['node','--test','tests/homologation.test.mjs'],['echo','BYPASS']]"), /Unreviewed suite commands/]
]) test('M1-02: dispatcher explicitly rejects ' + name, () => inventoryFixture(directory => {
  fixtureWrite(directory, ciPath, mutate(readFileSync(resolve(directory, ciPath), 'utf8'))); probeRefused(directory, message);
}));
test('M1-02: separation preserves every command, both typechecks and all six other groups', async () => {
  const historical = collected.i1Base.get(ciPath);
  assert.deepEqual(historical, Buffer.from(expectedCIDispatcher(collected.m1Base.get(ciPath))));
  mkdirSync(resolve(project, 'work'), { recursive: true });
  const directory = mkdtempSync(resolve(project, 'work/ci-command-equivalence-'));
  try {
    const file = fixtureWrite(directory, 'ci.mjs', historical);
    const legacy = (await import(pathToFileURL(file).href)).suites;
    for (const name of ['mcp','persistence','recovery','vault','buffering','regression']) assert.deepEqual(suites[name], legacy[name]);
    const commands = s => [...(s.typecheck ? [['npm','exec','--','tsc','--noEmit','-p',s.typecheck]] : []), ...s.commands];
    assert.deepEqual([...commands(suites.integration),...commands(suites.homologation)], commands(legacy.integration));
    assert.deepEqual([...suites.integration.files,...suites.homologation.files], legacy.integration.files);
  } finally { rmSync(directory,{recursive:true,force:true}); }
});
test('M1-02: CI still requires the independent buffering probe', () => inventoryFixture(directory => {
  rmSync(resolve(directory, 'prototype/mcp-local/scripts/prove-buffering.mjs')); probeRefused(directory, /Missing independent probe/);
}));
test('M1-02: CI still refuses bypass of its workflow invocation', () => inventoryFixture(directory => {
  const path = '.github/workflows/b4-mcp-local.yml';
  fixtureWrite(directory, path, replaceOne(readFileSync(resolve(directory, path), 'utf8'),
    'run: node scripts/ci.mjs run "${{ matrix.suite }}"', 'run: true'));
  probeRefused(directory, /workflow\.includes/);
}));
for (const [name, mutate] of [
  ['conditional suppression', text => replaceOne(text, 'run: node scripts/ci.mjs run "${{ matrix.suite }}"', 'if: false\n        run: node scripts/ci.mjs run "${{ matrix.suite }}"')],
  ['soft failure', text => replaceOne(text, 'run: node scripts/ci.mjs run "${{ matrix.suite }}"', 'continue-on-error: true\n        run: node scripts/ci.mjs run "${{ matrix.suite }}"')],
  ['unreviewed deadline', text => replaceOne(text, '    timeout-minutes: 10\n', '    timeout-minutes: 20\n')]
]) test('M1-02: dispatcher rejects workflow ' + name, () => inventoryFixture(directory => {
  const path = '.github/workflows/b4-mcp-local.yml';
  fixtureWrite(directory, path, mutate(readFileSync(resolve(directory,path),'utf8')));
  probeRefused(directory, /Unreviewed MCP workflow/);
}));
for (const [name, change] of [
  ['unapproved dispatcher bytes', text => text + '\n'],
  ['disabled inventory call', text => replaceOne(text, 'const inventory=verifyInventory();', 'const inventory={};')],
  ['removed Node pin', text => replaceOne(text, "assert.equal(process.version,'v24.22.1','Unreviewed Node runtime');", '')],
  ['removed workspace audit', text => replaceOne(text, "['npm','run','audit:workspace']", "['echo','audit skipped']")],
  ['weakened recursive inventory', text => replaceOne(text, 'assert.deepEqual(actual,expected);', '')]
]) test('M1-02: closed preservation policy rejects ' + name, () => {
  const s = complete(); s.current.set(ciPath, Buffer.from(change(s.current.get(ciPath).toString()))); refused(s, 'CI_CHANGE_NOT_ALLOWED');
});
test('M1-02: removing the CI dispatcher is a missing required file', () => {
  const s = complete(); s.current.delete(ciPath); refused(s, 'CANDIDATE_INVENTORY');
});
for (const [name, change] of [
  ['missing PR head selector', text => replaceOne(text, " || github.head_ref == 'b4/cloudflare-access-mcp'", '')],
  ['unconditional B4 selection', text => replaceOne(text, 'if [[ "$B4_PRESERVATION" == "true" ]]', 'if [[ "true" == "true" ]]')],
  ['disabled B3 preservation', text => replaceOne(text, 'node scripts/verify-b3-preservation.mjs', 'true')]
]) test('M1-02: SQLite permits no ' + name, () => {
  const s = complete(); s.current.set(sqlitePath, Buffer.from(change(s.current.get(sqlitePath).toString()))); refused(s, 'SQLITE_CHANGE_NOT_ALLOWED');
});
test('M1-02: other workflows and Worker remain byte protected', () => {
  for (const path of ['.github/workflows/b4-mcp-local.yml','.github/workflows/ci.yml','src/b3/entrypoint.ts']) {
    const s = complete(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
    refused(s, /^(?:HISTORICAL_CHANGED:|M1_PUBLISHED_CHANGED:|MCP_WORKFLOW_CHANGE_NOT_ALLOWED$)/);
  }
});

const sqliteWorkflow = readFileSync(resolve(root, sqlitePath), 'utf8');
const selector = sqliteWorkflow.match(/^\s+B4_PRESERVATION: \$\{\{ (.+) \}\}$/m)?.[1];
assert.ok(selector);
// This expression is now a deny-only context hint. Real selection is tested against Git DAGs below.
const terms = selector.split(' || ').map(term => {
  const match = /^github\.(ref|base_ref|head_ref) == '([^']+)'$/.exec(term); assert.ok(match, 'Unexpected routing expression');
  return { field: match[1], value: match[2] };
});
const selected = context => terms.some(term => context[term.field] === term.value);
const b4Branch = 'b4/cloudflare-access-mcp';
const contexts = [
  { name: 'push B4', ref: 'refs/heads/' + b4Branch, base_ref: '', head_ref: '', b4: true },
  { name: 'PR B4 to main', ref: 'refs/pull/1/merge', base_ref: 'main', head_ref: b4Branch, b4: true },
  { name: 'PR feature to B4', ref: 'refs/pull/2/merge', base_ref: b4Branch, head_ref: 'feature', b4: true },
  { name: 'push main', ref: 'refs/heads/main', base_ref: '', head_ref: '', b4: false },
  { name: 'PR feature to main', ref: 'refs/pull/3/merge', base_ref: 'main', head_ref: 'feature', b4: false },
  { name: 'similar push name', ref: 'refs/heads/' + b4Branch + '-backup', base_ref: '', head_ref: '', b4: false },
  { name: 'similar PR name', ref: 'refs/pull/4/merge', base_ref: 'main', head_ref: b4Branch + '-backup', b4: false },
  { name: 'tag named B4', ref: 'refs/tags/' + b4Branch, base_ref: '', head_ref: '', b4: false },
  { name: 'missing branch metadata', ref: 'refs/pull/5/merge', base_ref: 'main', head_ref: '', b4: false }
];
for (const context of contexts) test('M1-02: SQLite routing ' + context.name, () => {
  assert.equal(selected(context), context.b4); ciContextEvidence.push({ ...context, denyOnlyB4Hint: selected(context), selectsVerifier: false });
});
const shellAnchor = '        run: |\n'; assert.equal(sqliteWorkflow.split(shellAnchor).length, 2);
const shell = sqliteWorkflow.split(shellAnchor)[1].split('\n').filter(Boolean).map(line => {
  assert.ok(line.startsWith('          ')); return line.slice(10);
}).join('\n');
for (const context of contexts.slice(0, 2)) test('M1-02: actual SQLite shell invokes B4 for ' + context.name, () => {
  const result = JSON.parse(execFileSync('bash', ['-eu', '-o', 'pipefail', '-c', shell], {
    cwd: root, env: { ...process.env, B4_PRESERVATION: String(selected(context)) }, stdio: 'pipe', timeout: 15000
  }));
  assert.equal(result.candidateFiles, 184); assert.equal(result.publishedByteIdentical, 155);
  assert.equal(result.activationBlocked, true);
});
test('M1-02: actual SQLite shell preserves B3 selection on the unchanged historical reference', () => {
  const directory = mkdtempSync(resolve(project, 'work/m1-b3-context-'));
  try {
    const repo = resolve(directory, 'reference');
    execFileSync('git', ['clone','--no-hardlinks',root,repo], { stdio: 'pipe' });
    execFileSync('git', ['checkout','--detach',B31], { cwd: repo, stdio: 'pipe' });
    assert.deepEqual(readFileSync(resolve(repo, 'scripts/verify-b3-preservation.mjs')), readFileSync(resolve(root, 'scripts/verify-b3-preservation.mjs')));
    const context = contexts.find(x => x.name === 'push main');
    const result = JSON.parse(execFileSync('bash', ['-eu','-o','pipefail','-c',shell], {
      cwd: repo, env: { ...process.env, B4_PRESERVATION: String(selected(context)) }, stdio: 'pipe', timeout: 15000
    }));
    assert.deepEqual(result.modified, []); assert.ok(Object.values(result.checks).every(value => value === true));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

// Actual Git object graphs, confined to disposable fixtures. No project commit or branch is created.
const m20RoutingEvidence = [];
const i2CommittedFixtureEvidence = [];
const mainBeforeB4 = 'ed36da553b4dbd0c3c5d574e7db0b0d61fb1cd6d';
const b3Checkpoint = 'a53f7f3af8c0edb0da856916b60706b342d0118a';
test('M2.0: exact SQLite transformation preserves shell dollar and quote bytes', () => {
  const expected = expectedSQLiteWorkflow(collected.historical.get(sqlitePath));
  assert.deepEqual(Buffer.from(expected), readFileSync(resolve(root, sqlitePath)));
  assert.ok(expected.includes(".promisor)$'"));
});
function gitFixture(run, { ref = M20_BASE, history = 'full', install = ref === M20_BASE } = {}) {
  mkdirSync(resolve(project, 'work'), { recursive: true });
  const directory = mkdtempSync(resolve(project, 'work/m20-git-')), repo = resolve(directory, 'repository');
  const gitEnv = { ...process.env, GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0',
    GIT_AUTHOR_NAME: 'Synthetic M2.0 Fixture', GIT_AUTHOR_EMAIL: 'm20@example.invalid',
    GIT_COMMITTER_NAME: 'Synthetic M2.0 Fixture', GIT_COMMITTER_EMAIL: 'm20@example.invalid',
    GIT_AUTHOR_DATE: '2001-01-01T00:00:00Z', GIT_COMMITTER_DATE: '2001-01-01T00:00:00Z' };
  const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], {
    cwd: repo, env: gitEnv, stdio: 'pipe', timeout: 15000 }).toString().trim();
  // Historical DAG fixtures must use the published f20 epoch, not the uncommitted I1 candidate.
  const installHistoricalSelection = () => { for (const path of M20_MODIFIED) fixtureWrite(repo, path,
    execFileSync('git', ['--no-replace-objects', 'show', I1_BASE + ':' + path], { cwd: root, stdio: 'pipe' })); };
  try {
    if (history === 'missing-checkpoint') {
      mkdirSync(repo); git('init', '--quiet'); git('fetch', '--quiet', '--no-tags', root, ref);
    } else {
      execFileSync('git', history === 'shallow'
        ? ['clone', '--quiet', '--no-local', '--no-hardlinks', '--no-tags', '--depth', '1', pathToFileURL(root).href, repo]
        : ['clone', '--quiet', '--no-hardlinks', root, repo], { env: gitEnv, stdio: 'pipe', timeout: 15000 });
    }
    // A depth-one clone contains the source HEAD, not an older checkpoint.
    git('checkout', '--quiet', '--detach', history === 'shallow' ? 'HEAD' : ref);
    if (install) installHistoricalSelection();
    const fixture = { repo, directory, git, installHistoricalSelection,
      commit: parents => git('commit-tree', git('rev-parse', M20_BASE + '^{tree}'),
        ...parents.flatMap(parent => ['-p', parent]), '-m', 'SYNTHETIC M2.0 DAG ONLY'),
      checkout: commit => { git('checkout', '--quiet', '--detach', commit); installHistoricalSelection(); }
    };
    return run(fixture);
  } finally { rmSync(directory, { recursive: true, force: true }); }
}
// Start from the immutable 178-file checkpoint even when the source HEAD is I2.
// Only this disposable repository may receive a synthetic candidate commit.
function i1GitFixture(run, { workingTree = false, ref = I2_BASE } = {}) {
  return gitFixture(fixture => {
    const { git, repo } = fixture;
    assert.equal(git('rev-parse', '--is-shallow-repository'), 'false');
    assert.equal(git('merge-base', '--is-ancestor', I1_BASE, 'HEAD'), '');
    const startingPaths = git('ls-files', '-z').split('\0').filter(Boolean).sort();
    assert.deepEqual(startingPaths, [...collected.i2Base.keys()].sort());
    if (workingTree) {
      const candidatePaths = Object.freeze([...I2_ADDED, ...I2_MODIFIED]);
      assert.deepEqual([...candidatePaths].sort(), [
        'prototype/mcp-local/i2/identity-worker.ts', 'prototype/mcp-local/i2/identity-config.ts',
        'prototype/mcp-local/scripts/build-i2-identity.mjs', 'prototype/mcp-local/scripts/i2-identity-harness.mjs',
        'prototype/mcp-local/lab/tests/i2-identity.node.mjs', 'prototype/mcp-local/docs/i2-identity.md',
        'prototype/mcp-local/scripts/homologation-harness.mjs', 'prototype/mcp-local/tests/homologation.test.mjs',
        'scripts/verify-b4-preservation.mjs', 'tests/b4/m21-preservation.node.mjs'].sort());
      const parent = git('rev-parse', 'HEAD'), changedPaths = [];
      assert.equal(parent, I2_BASE);
      for (const path of candidatePaths) {
        const bytes = readFileSync(resolve(root, path));
        const previous = collected.i2Base.get(path);
        if (previous === undefined || !bytes.equals(previous)) changedPaths.push(path);
        fixtureWrite(repo, path, bytes);
      }
      git('add', '--', ...candidatePaths);
      const stagedPaths = git('diff', '--cached', '--name-only').split('\n').filter(Boolean).sort();
      assert.deepEqual(stagedPaths, changedPaths.sort());
      const tree = git('write-tree'), commit = git('commit-tree', tree, '-p', parent, '-m', 'SYNTHETIC I1 WORKING CANDIDATE ONLY');
      git('checkout', '--quiet', '--detach', commit);
      assert.equal(git('rev-parse', 'HEAD^'), parent);
      assert.equal(git('rev-parse', 'HEAD^{tree}'), tree);
      assert.equal(git('merge-base', '--is-ancestor', I1_BASE, 'HEAD'), '');
      assert.equal(git('status', '--porcelain'), '');
      for (const path of candidatePaths) assert.deepEqual(readFileSync(resolve(repo, path)), readFileSync(resolve(root, path)));
      fixture.candidateSnapshot = { parent, commit, tree, startingFiles: startingPaths.length,
        copiedPaths: [...candidatePaths], changedPaths, stagedPaths, temporaryRepositoryOnly: true };
    }
    return run(fixture);
  }, { ref, install: false });
}
function selection(repo, extraEnv = {}) {
  try {
    return { exit: 0, signal: null, stdout: execFileSync('bash', ['-eu', '-o', 'pipefail', '-c', shell], {
      cwd: repo, env: { ...process.env, B4_PRESERVATION: 'false', ...extraEnv }, stdio: 'pipe', timeout: 15000
    }).toString(), stderr: '' };
  } catch (error) {
    return { exit: error.status, signal: error.signal, stdout: String(error.stdout ?? ''), stderr: String(error.stderr ?? '') };
  }
}
function workflowFailure(result, code) {
  assert.equal(result.exit, 1); assert.equal(result.signal, null);
  assert.match(result.stderr, new RegExp('(?:^|\\n)PRESERVATION_SELECTION_FAILED:' + code + '(?:\\n|$)'));
  assert.equal(result.stdout.includes('"allBaseFilesByteIdentical"'), false, 'Never fall back after a selector refusal');
}
function checkedB4Report(report, epoch) {
  assert.equal(report.m20Base, M20_BASE);
  assert.equal(report.byteIdentical, 94); assert.equal(report.activationBlocked, true);
  if (epoch === 'historical') {
    assert.equal(report.m20ProtectedFiles, 169); assert.equal(report.candidateFiles, 172);
  } else if (epoch === 'i1' || epoch === 'i1-ci') {
    assert.equal(report.m20ProtectedFiles, epoch === 'i1' ? 163 : 161); assert.equal(report.candidateFiles, 178);
    assert.equal(report.i1Base, I1_BASE); assert.equal(report.i1PublishedFiles, 172);
    assert.equal(report.i1ProtectedFiles, epoch === 'i1' ? 164 : 162); assert.equal(report.i1Added, 6);
    assert.equal(report.originalVerifierPreserved, true);
    if (epoch === 'i1-ci') assert.deepEqual(report.i1ciAuthorizedPaths, I1_CI_PATHS);
  } else if (epoch === 'i2') {
    assert.equal(report.candidateFiles, 184); assert.equal(report.i2Base, I2_BASE);
    assert.equal(report.i2PublishedFiles, 178); assert.equal(report.i2ProtectedFiles, 174);
    assert.equal(report.i2Added, 6); assert.equal(report.originalVerifierPreserved, true);
  } else assert.fail('Unknown preservation epoch');
}
function checkedSelection(fixture, name, expected, extraEnv) {
  const r = selection(fixture.repo, extraEnv);
  if (expected === 'B4' || expected === 'B4-I1' || expected === 'B4-I1-CI' || expected === 'B4-I2' || expected === 'B3') {
    assert.equal(r.exit, 0, r.stderr); assert.equal(r.signal, null); const report = JSON.parse(r.stdout);
    if (expected !== 'B3') {
      const epoch = expected === 'B4' ? 'historical' : expected === 'B4-I1' ? 'i1' : expected === 'B4-I2' ? 'i2' : 'i1-ci';
      checkedB4Report(report, epoch);
      for (const wrong of ['historical','i1','i1-ci','i2'].filter(other => other !== epoch))
        assert.throws(() => checkedB4Report(report, wrong), { code: 'ERR_ASSERTION' });
    } else {
      assert.equal(report.base, 'f59081e223006f3eb0739d01073ed2eba824687e');
      assert.deepEqual(report.modified, []); assert.ok(Object.values(report.checks).every(value => value === true));
    }
  } else workflowFailure(r, expected);
  m20RoutingEvidence.push({ name, expected, exit: r.exit, signal: r.signal, syntheticGitFixture: true });
  return r;
}
test('M2.0: only the three approved modifications are permitted in the 172-file checkpoint', () => {
  assert.equal(M20_BASE, '014a2a5a49211d31bb9275e236fd2c31c1be93d8');
  assert.deepEqual(M20_MODIFIED, ['.github/workflows/b3-sqlite.yml', 'scripts/verify-b4-preservation.mjs', 'prototype/mcp-local/tests/homologation.test.mjs']);
  assert.equal(Object.isFrozen(M20_MODIFIED), true);
  const report = validateSnapshot(complete()); assert.equal(report.m20PublishedFiles, 172); assert.equal(report.m20ProtectedFiles, 161);
  assert.equal(report.i1ProtectedFiles, 162);
});
test('M2.0: every other 169 checkpoint files still rejects an extra byte', () => {
  let count = 0;
  for (const path of collected.m20Base.keys()) if (!M20_MODIFIED.includes(path)) {
    const s = complete(); s.current.set(path, Buffer.concat([s.current.get(path), Buffer.from('\n')]));
    refused(s, /^(?:HISTORICAL_CHANGED:|B4_BASE_CHANGED:|APPROVED_DEPENDENCY_CHANGED:|SQLITE_CHANGE_NOT_ALLOWED$|CI_CHANGE_NOT_ALLOWED$|MCP_WORKFLOW_CHANGE_NOT_ALLOWED$|M1_PUBLISHED_CHANGED:|M20_PUBLISHED_CHANGED:|I1_CONTENT_CHANGED:)/); count++;
  }
  assert.equal(count, 169);
});
test('M2.0: fixed checkpoint ancestry and inventory cannot be omitted', () => {
  refused({ ...complete(), m20Ancestor: false }, 'M20_BASE_DIVERGED');
  const s = complete(); s.m20Base.delete('src/b3/adapter.ts'); refused(s, 'M20_BASE_INVENTORY');
});
for (const [name, env] of [
  ['checkpoint with no B4 context hint', {}],
  ['unset context hint', { B4_PRESERVATION: undefined }],
  ['B4 push context', { B4_PRESERVATION: 'true' }],
  ['missing branch metadata', { GITHUB_REF: '', GITHUB_HEAD_REF: '', GITHUB_BASE_REF: '' }],
  ['spoofed main metadata cannot downgrade B4', { GITHUB_REF: 'refs/heads/main', B4_PRESERVATION: 'false' }],
  ['external checkpoint variable is ignored', { checkpoint: B31, b3_checkpoint: mainBeforeB4, B4_CHECKPOINT: B31 }]
]) test('M2.0: actual selection ' + name, () => gitFixture(f => checkedSelection(f, name, 'B4', env)));
for (const [name, graph, env] of [
  ['PR B4 to main merge ref', f => f.commit([mainBeforeB4, M20_BASE]), { B4_PRESERVATION: 'true' }],
  ['main after merge commit', f => f.commit([mainBeforeB4, M20_BASE]), { B4_PRESERVATION: 'false', GITHUB_REF: 'refs/heads/main' }],
  ['future main descendant', f => f.commit([f.commit([mainBeforeB4, M20_BASE])]), {}],
  ['future feature and PR derived from B4', f => f.commit([f.commit([mainBeforeB4, M20_BASE]), f.commit([M20_BASE])]),
    { B4_PRESERVATION: 'false', GITHUB_BASE_REF: 'main', GITHUB_HEAD_REF: 'future-feature' }]
]) test('M2.0: real DAG selects B4 for ' + name, () => gitFixture(f => {
  const commit = graph(f); f.checkout(commit); checkedSelection(f, name, 'B4', env);
  assert.equal(f.git('merge-base', '--is-ancestor', M20_BASE, 'HEAD'), '');
}));
for (const [name, ref] of [['historical B3 branch', b3Checkpoint], ['historical B3.1 branch', B31], ['historical main on B3.1', B31]]) {
  test('M2.0: original B3 verifier remains required for ' + name, () => gitFixture(f => {
    assert.deepEqual(readFileSync(resolve(f.repo, 'scripts/verify-b3-preservation.mjs')), readFileSync(resolve(root, 'scripts/verify-b3-preservation.mjs')));
    checkedSelection(f, name, 'B3');
  }, { ref, install: false }));
}
test('M2.0: actual main before B3/B4 has no verifier and cannot acquire a permissive pass', () => gitFixture(f => {
  assert.throws(() => readFileSync(resolve(f.repo, 'scripts/verify-b3-preservation.mjs')), { code: 'ENOENT' });
  checkedSelection(f, 'actual main before incorporation', 'UNRECOGNIZED_LINEAGE');
}, { ref: mainBeforeB4, install: false }));
test('M2.0: B4 context metadata cannot authorize an unrelated historical B3 tree', () => gitFixture(f => {
  checkedSelection(f, 'spoofed B4 hint on B3', 'B4_CONTEXT_WITHOUT_ANCESTRY', { B4_PRESERVATION: 'true' });
}, { ref: B31, install: false }));
test('M2.0: malformed external context is denied instead of interpreted as permission', () => gitFixture(f => {
  checkedSelection(f, 'malformed context', 'INVALID_CONTEXT', { B4_PRESERVATION: 'true || echo BYPASS' });
}));
test('M2.0-FIX: full published descendant retains the checkpoint and selects B4', () => i1GitFixture(f => {
  assert.notEqual(f.git('rev-parse', 'HEAD'), M20_BASE);
  assert.equal(f.git('merge-base', '--is-ancestor', M20_BASE, 'HEAD'), '');
  assert.equal(f.git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(f.git('cat-file', '-t', M20_BASE), 'commit');
  checkedSelection(f, 'full published I1 descendant', 'B4-I1');
}, { ref: 'dccd2dd7dab1d0e99ae5f303099b6e6252cd43c7' }));
test('I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant', () => i1GitFixture(f => {
  checkedSelection(f, 'I2 working candidate snapshot', 'B4-I2');
  Object.assign(m20RoutingEvidence.at(-1), { candidateSnapshot: f.candidateSnapshot });
}, { workingTree: true }));
test('I1 fixture: 178 files mixed with the historical 172-file verifier remain refused', () => i1GitFixture(f => {
  f.installHistoricalSelection();
  const result = selection(f.repo);
  assert.equal(result.exit, 1); assert.equal(result.signal, null); assert.equal(result.stdout.trim(), '');
  assert.deepEqual(JSON.parse(result.stderr), { preservation: 'FAILED', code: 'CANDIDATE_INVENTORY' });
  assert.throws(() => workflowFailure(result, 'SHALLOW_HISTORY'));
  m20RoutingEvidence.push({ name: 'mixed I1 tree and historical verifier', expected: 'CANDIDATE_INVENTORY',
    exit: result.exit, signal: result.signal, noFallback: true, syntheticGitFixture: true });
}));
const committedFixtureTest = 'I2 fixture: committed candidate starts from the immutable base and selects its matching verifier';
test(committedFixtureTest, { timeout: 45000 }, () => i1GitFixture(f => {
  const sourceHead = f.git('rev-parse', 'HEAD'), sourceTree = f.git('rev-parse', 'HEAD^{tree}');
  assert.notEqual(sourceHead, I2_BASE);
  assert.equal(f.git('rev-parse', 'HEAD^'), I2_BASE);
  assert.equal(f.git('ls-files', '-z').split('\0').filter(Boolean).length, 184);
  assert.equal(f.candidateSnapshot.startingFiles, 178);
  assert.deepEqual(f.candidateSnapshot.stagedPaths, [...I2_ADDED, ...I2_MODIFIED].sort());
  for (const relative of ['node_modules', 'prototype/mcp-local/node_modules']) {
    const installed = resolve(root, relative), destination = resolve(f.repo, relative);
    mkdirSync(destination, { recursive: true });
    for (const entry of readdirSync(installed)) symlinkSync(resolve(installed, entry), resolve(destination, entry));
  }
  const pattern = '^(?:M2.0-FIX: full published descendant retains the checkpoint and selects B4|I2 fixture: uncommitted candidate snapshot selects its matching verifier in a temporary descendant|I1 fixture: 178 files mixed with the historical 172-file verifier remain refused)$';
  assert.equal(new RegExp(pattern).test(committedFixtureTest), false, 'The child must not recurse into this regression');
  const childEnv = { ...process.env }; delete childEnv.NODE_TEST_CONTEXT;
  const started = performance.now();
  const stdout = execFileSync(process.execPath, ['--test', '--test-reporter=tap', '--test-name-pattern=' + pattern,
    'tests/homologation.test.mjs'], { cwd: resolve(f.repo, 'prototype/mcp-local'), env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'], timeout: 40000, maxBuffer: 16 * 1024 * 1024 }).toString();
  const directory = resolve(project, 'work/i2-id-fix'); mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, 'committed-fixture.tap'), stdout);
  const count = name => {
    const matches = [...stdout.matchAll(new RegExp('^# ' + name + ' (\\d+)$', 'gm'))];
    assert.equal(matches.length, 1); return Number(matches[0][1]);
  };
  assert.equal(count('tests'), 3); assert.equal(count('pass'), 3);
  for (const name of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(count(name), 0);
  const childEvidence = JSON.parse(readFileSync(resolve(f.repo, 'prototype/mcp-local/work/homologation/test-evidence.json')));
  const routing = childEvidence.preservationRouting;
  assert.equal(routing.length, 3);
  assert.ok(routing.some(row => row.name === 'full published I1 descendant' && row.expected === 'B4-I1' && row.exit === 0));
  assert.ok(routing.some(row => row.name === 'mixed I1 tree and historical verifier' && row.expected === 'CANDIDATE_INVENTORY' && row.exit === 1 && row.noFallback === true));
  const current = routing.find(row => row.name === 'I2 working candidate snapshot');
  assert.equal(current.expected, 'B4-I2'); assert.equal(current.exit, 0);
  assert.equal(current.candidateSnapshot.parent, I2_BASE);
  assert.equal(current.candidateSnapshot.startingFiles, 178);
  assert.deepEqual(current.candidateSnapshot.stagedPaths, [...I2_ADDED, ...I2_MODIFIED].sort());
  assert.equal(current.candidateSnapshot.tree, sourceTree);
  assert.equal(f.git('rev-parse', 'HEAD'), sourceHead); assert.equal(f.git('status', '--porcelain'), '');
  const row = { sourceHead, sourceParent: I2_BASE, sourceTree, sourceFiles: 184,
    snapshot: current.candidateSnapshot, tests: count('tests'), pass: count('pass'), exit: 0,
    milliseconds: Math.round(performance.now() - started), recursionExcluded: true };
  i2CommittedFixtureEvidence.push(row); console.log('I2_ID_FIX_SUITE ' + JSON.stringify(row));
}, { workingTree: true }));
test('M2.0: a genuinely shallow clone never falls back', () => gitFixture(f => {
  const sourceHead = execFileSync('git', ['--no-replace-objects', 'rev-parse', 'HEAD'], { cwd: root, stdio: 'pipe' }).toString().trim();
  assert.notEqual(sourceHead, M20_BASE);
  execFileSync('git', ['--no-replace-objects', 'merge-base', '--is-ancestor', M20_BASE, sourceHead], { cwd: root, stdio: 'pipe' });
  assert.equal(f.git('rev-parse', 'HEAD'), sourceHead);
  assert.equal(f.git('rev-list', '--all', '--count'), '1');
  const commits = f.git('cat-file', '--batch-all-objects', '--batch-check=%(objectname) %(objecttype)')
    .split('\n').filter(line => line.endsWith(' commit'));
  assert.deepEqual(commits, [sourceHead + ' commit'], 'No extra reachable or unreachable historical commit objects');
  assert.throws(() => readFileSync(resolve(f.repo, '.git/objects/info/alternates')), { code: 'ENOENT' });
  const missing = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch-check'], {
    cwd: f.repo, input: [M20_BASE, B31, b3Checkpoint].join('\n') + '\n', stdio: ['pipe','pipe','pipe']
  }).toString().trim().split('\n');
  assert.deepEqual(missing, [M20_BASE, B31, b3Checkpoint].map(sha => sha + ' missing'));
  assert.equal(f.git('rev-parse', '--is-shallow-repository'), 'true'); checkedSelection(f, 'shallow history', 'SHALLOW_HISTORY');
  Object.assign(m20RoutingEvidence.at(-1), { fixturePrepared: true, sourceHead, retainedHead: sourceHead,
    storedCommitObjects: commits.length, checkpointPresent: false, objectAlternates: false, selectorInvoked: true });
}, { history: 'shallow' }));
test('M2.0: a missing B4 checkpoint never falls back to otherwise valid B3', () => gitFixture(f => {
  assert.equal(f.git('rev-parse', '--is-shallow-repository'), 'false');
  const absent = execFileSync('git', ['--no-replace-objects', 'cat-file', '--batch-check'], {
    cwd: f.repo, input: M20_BASE + '\n', stdio: ['pipe','pipe','pipe']
  }).toString().trim();
  assert.equal(absent, M20_BASE + ' missing');
  checkedSelection(f, 'missing checkpoint', 'CHECKPOINT_MISSING');
}, { ref: B31, install: false, history: 'missing-checkpoint' }));
test('M2.0-FIX: fixture preparation failure cannot count as shallow-history refusal', () => {
  const missingRef = '0000000000000000000000000000000000000000';
  let prepared = false, preparationError;
  try { gitFixture(() => { prepared = true; }, { ref: missingRef, install: false }); }
  catch (error) { preparationError = error; }
  assert.equal(prepared, false); assert.ok(preparationError instanceof Error);
  assert.equal(preparationError.status, 128); assert.equal(preparationError.signal, null);
  assert.equal(preparationError.message.split('\n')[0], 'Command failed: git --no-optional-locks checkout --quiet --detach ' + missingRef);
  assert.match(String(preparationError.stderr), new RegExp('^fatal: .*' + missingRef));
  assert.equal(String(preparationError.stderr).includes('PRESERVATION_SELECTION_FAILED:'), false);
  assert.throws(() => workflowFailure({ exit: preparationError.status, signal: preparationError.signal,
    stdout: String(preparationError.stdout ?? ''), stderr: String(preparationError.stderr ?? '') }, 'SHALLOW_HISTORY'));
});
test('M2.0: invalid Git configuration is an explicit failure rather than a historical selection', () => gitFixture(f => {
  writeFileSync(resolve(f.repo, '.git/config'), '[SYNTHETIC_INVALID_CONFIG'); checkedSelection(f, 'Git failure', 'GIT_FAILED');
}));
test('M2.0: missing HEAD is an explicit failure', () => gitFixture(f => {
  writeFileSync(resolve(f.repo, '.git/HEAD'), 'ref: refs/heads/nonexistent\n'); checkedSelection(f, 'missing HEAD', 'HEAD_MISSING');
}));
test('M2.0: another enclosing repository cannot silently supply missing history', () => gitFixture(f => {
  renameSync(resolve(f.repo, '.git'), resolve(f.directory, 'git-removed')); checkedSelection(f, 'repository discovery escape', 'REPOSITORY_ROOT');
}));
test('M2.0: replace refs cannot manufacture checkpoint ancestry', () => gitFixture(f => {
  f.git('update-ref', 'refs/replace/' + M20_BASE, B31); checkedSelection(f, 'replace refs', 'REPLACED_HISTORY');
}));
test('M2.0: grafted history is refused', () => gitFixture(f => {
  fixtureWrite(f.repo, '.git/info/grafts', M20_BASE + ' ' + B31 + '\n'); checkedSelection(f, 'grafted history', 'GRAFTED_HISTORY');
}));
for (const variable of ['GIT_GRAFT_FILE','GIT_SHALLOW_FILE','GIT_REPLACE_REF_BASE']) test('M2.0: untrusted history override ' + variable + ' is refused', () => gitFixture(f => {
  checkedSelection(f, variable, 'HISTORY_OVERRIDE', { [variable]: resolve(f.directory, 'untrusted') });
}));
test('M2.0: partial clone state is refused without lazy fetch', () => gitFixture(f => {
  f.git('config', 'remote.origin.promisor', 'true'); checkedSelection(f, 'partial clone', 'PARTIAL_HISTORY');
}));
for (const [name, parent, expected] of [['squash onto old main', mainBeforeB4, 'UNRECOGNIZED_LINEAGE'], ['rewritten/rebased B4 checkpoint', B31, 'B4_WITHOUT_ANCESTRY']]) {
  test('M2.0: incompatible history ' + name + ' cannot authorize B4 content', () => gitFixture(f => {
    const rewritten = f.commit([parent]); f.checkout(rewritten); checkedSelection(f, name, expected);
  }));
}
test('M2.0: untracked B4 markers prevent historical fallback', () => gitFixture(f => {
  fixtureWrite(f.repo, 'src/b4/local.ts', 'SYNTHETIC_UNPROVEN_B4'); checkedSelection(f, 'unproven working tree', 'B4_WITHOUT_ANCESTRY');
}, { ref: B31, install: false }));
test('M2.0: absent B4 verifier cannot fall back', () => gitFixture(f => {
  rmSync(resolve(f.repo, 'scripts/verify-b4-preservation.mjs')); checkedSelection(f, 'missing B4 verifier', 'B4_VERIFIER_MISSING');
}));
test('M2.0: symlinked B4 verifier cannot be executed', () => gitFixture(f => {
  const p = resolve(f.repo, 'scripts/verify-b4-preservation.mjs'); rmSync(p); symlinkSync('verify-b3-preservation.mjs', p);
  checkedSelection(f, 'B4 verifier symlink', 'B4_VERIFIER_MISSING');
}));
test('M2.0: B4 verifier exit is propagated without invoking B3', () => gitFixture(f => {
  fixtureWrite(f.repo, 'scripts/verify-b4-preservation.mjs', "console.error('SYNTHETIC_B4_VERIFIER_FAILURE');process.exit(27);\n");
  const r = selection(f.repo); assert.equal(r.exit, 27); assert.equal(r.signal, null);
  assert.equal(r.stderr.trim(), 'SYNTHETIC_B4_VERIFIER_FAILURE'); assert.equal(r.stdout, '');
  m20RoutingEvidence.push({ name: 'B4 verifier failure', exit: r.exit, noFallback: true });
}));
test('M2.0: actual B4 historical-file rejection is propagated intact', () => gitFixture(f => {
  fixtureWrite(f.repo, 'src/b3/adapter.ts', 'SYNTHETIC_UNAUTHORIZED_CHANGE');
  const r = selection(f.repo); assert.equal(r.exit, 1); assert.equal(r.signal, null); assert.equal(r.stdout, '');
  assert.deepEqual(JSON.parse(r.stderr), { preservation: 'FAILED', code: 'HISTORICAL_CHANGED:src/b3/adapter.ts' });
  m20RoutingEvidence.push({ name: 'B4 verification failure', exit: r.exit, code: 'HISTORICAL_CHANGED', noFallback: true });
}));
test('M2.0: absent B3 verifier is denied', () => gitFixture(f => {
  rmSync(resolve(f.repo, 'scripts/verify-b3-preservation.mjs')); checkedSelection(f, 'missing B3 verifier', 'B3_VERIFIER_MISSING');
}, { ref: B31, install: false }));
test('M2.0: altered B3 verifier is denied even if it would return success', () => gitFixture(f => {
  fixtureWrite(f.repo, 'scripts/verify-b3-preservation.mjs', 'process.exit(0);\n'); checkedSelection(f, 'B3 verifier tamper', 'B3_VERIFIER_CHANGED');
}, { ref: B31, install: false }));
test('M2.0: original B3 verifier still rejects its own protected-file mutations', () => gitFixture(f => {
  const file = 'src/preparation/config.ts'; fixtureWrite(f.repo, file, readFileSync(resolve(f.repo, file), 'utf8') + '\n');
  const r = selection(f.repo); assert.equal(r.exit, 1); assert.equal(r.signal, null);
  const report = JSON.parse(r.stdout); assert.ok(report.modified.includes(file)); assert.equal(report.checks.allBaseFilesByteIdentical, false);
  m20RoutingEvidence.push({ name: 'B3 verification failure', exit: r.exit, noFallback: true });
}, { ref: B31, install: false }));
test('M2.0: process/transport errors cannot satisfy an explicit selector refusal assertion', () => {
  for (const [exit, signal] of [[null, null], [null, 'SIGTERM'], [137, 'SIGKILL']]) {
    assert.throws(() => workflowFailure({ exit, signal, stdout: '', stderr: 'PRESERVATION_SELECTION_FAILED:GIT_FAILED\n' }, 'GIT_FAILED'));
  }
});

test('M1-03: integration and homologation independently receive five minutes; other limits remain unchanged', () => {
  const path = '.github/workflows/b4-mcp-local.yml';
  const current = readFileSync(resolve(root, path), 'utf8');
  const before = "        timeout-minutes: ${{ matrix.suite == 'recovery' && 5 || 3 }}\n";
  const after = "        timeout-minutes: ${{ (matrix.suite == 'recovery' || matrix.suite == 'integration' || matrix.suite == 'homologation') && 5 || 3 }}\n";
  const oldMatrix = '        suite: [mcp, persistence, recovery, vault, integration, buffering, regression]\n';
  const newMatrix = '        suite: [mcp, persistence, recovery, vault, integration, homologation, buffering, regression]\n';
  assert.deepEqual(Buffer.from(replaceOne(replaceOne(current, after, before), newMatrix, oldMatrix)), collected.m1Base.get(path));
  assert.match(current, /^    timeout-minutes: 10$/m);
  const budgets = { mcp: 3, persistence: 3, recovery: 5, vault: 3, integration: 5, homologation: 5, buffering: 3, regression: 3 };
  assert.deepEqual(Object.keys(budgets), groupNames);
  for (const name of ['integration','homologation']) {
    assert.equal(budgets[name] * 60, 300); assert.equal(10 * 60 - budgets[name] * 60, 300);
  }
});
for (const [name, change] of [
  ['integration six minutes', text => replaceOne(text, 'timeout-minutes: ${{ (', "timeout-minutes: ${{ matrix.suite == 'integration' && 6 || (")],
  ['homologation six minutes', text => replaceOne(text, 'timeout-minutes: ${{ (', "timeout-minutes: ${{ matrix.suite == 'homologation' && 6 || (")],
  ['homologation budget removed', text => replaceOne(text, " || matrix.suite == 'homologation'", '')],
  ['previous three-minute budget', text => replaceOne(text, " || matrix.suite == 'integration'", '')],
  ['general job limit changed', text => replaceOne(text, '    timeout-minutes: 10\n', '    timeout-minutes: 20\n')],
  ['audit removed', text => replaceOne(text, 'run: npm audit --audit-level=low', 'run: true')],
  ['suite group removed', text => replaceOne(text, 'recovery, vault, integration', 'recovery, integration')]
]) test('M1-03: closed workflow policy rejects ' + name, () => {
  const s = complete(), path = '.github/workflows/b4-mcp-local.yml';
  s.current.set(path, Buffer.from(change(s.current.get(path).toString()))); refused(s, 'MCP_WORKFLOW_CHANGE_NOT_ALLOWED');
});

// The local composition is exercised in workerd over actual loopback HTTP with the independent MCP client.
execFileSync(process.execPath, [resolve(project, 'scripts/build-homologation.mjs')], { cwd: project, stdio: 'pipe' });
const { createHomologationFixture } = await import('../scripts/homologation-harness.mjs');
const { createBoundPorts, LOCAL_MODE, PortUnavailable } = await import('../work/homologation/ports-library.mjs');
const { dataOf } = await import('../scripts/local-harness.mjs');
const { expectUnknownTool, expectInvalidArguments } = await import('../scripts/rejections.mjs');
const { generateKeyPair, exportJWK } = await import('jose');
const { randomBytes, randomUUID } = await import('node:crypto');
const { createConnection } = await import('node:net');
const unitPair = await generateKeyPair('RS256');
const unitJwks = { keys: [{ ...await exportJWK(unitPair.publicKey), alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral' }] };
const unitMaterial = Object.fromEntries(['a','b'].map(s => ['account-' + s, {
  key: randomBytes(32).toString('base64url'), access: 'SYNTHETIC_ACCESS_' + s.toUpperCase() + '_' + randomUUID(),
  refresh: 'SYNTHETIC_REFRESH_' + s.toUpperCase() + '_' + randomUUID()
}]));
const unitBindings = service => ({
  HML_MODE: LOCAL_MODE, HML_JWKS: structuredClone(unitJwks), HML_MATERIAL: structuredClone(unitMaterial),
  HML_IDENTITY: service, HML_REGISTRY: service, HML_REFERENCE: service, HML_VAULTS: service
});
const successPort = { fetch: async () => Response.json({ ok: true, value: null }) };
test('M1 ports expose only the closed read capabilities', () => {
  const p = createBoundPorts(unitBindings(successPort)); assert.equal(Object.isFrozen(p), true);
  assert.deepEqual(Object.keys(p.identity), ['issue','lookup','cancel']);
  assert.deepEqual(Object.keys(p.registry), ['snapshot','resolve','barrier','event']);
  assert.deepEqual(Object.keys(p.reference), ['current','permissions']);
  assert.deepEqual(Object.keys(p.vaults), ['execute','assertPrepared']);
});
for (const [label, mutate, expected] of [
  ['activation profile', b => { b.HML_MODE = 'production'; }, 'PortUnavailable'],
  ['extra credential binding', b => { b.UNAPPROVED_SECRET = 'NOT_A_CREDENTIAL'; }, 'PortUnavailable'],
  ['non-fictional access token', b => { b.HML_MATERIAL['account-a'].access = 'NON_FICTIONAL_FORMAT'; }, 'ZodError'],
  ['private key in JWKS', b => { b.HML_JWKS.keys[0].d = 'NOT_A_PRIVATE_KEY'; }, 'ZodError'],
  ['unregistered issuer key', b => { b.HML_JWKS.keys[0].kid = 'not-enrolled'; }, 'ZodError']
]) test('M1 refuses ' + label + ' before serving', () => {
  const b = unitBindings(successPort); mutate(b);
  assert.throws(() => createBoundPorts(b), e => e instanceof Error && e.name === expected);
});
for (const code of ['ECONNRESET','ETIMEDOUT','ECONNREFUSED','UNAVAILABLE']) test('M1 private port sanitizes ' + code + ' as dependency failure', async () => {
  const service = { fetch: async () => { throw Object.assign(new Error('PRIVATE_CANARY_CAUSE'), { code }); } };
  const p = createBoundPorts(unitBindings(service));
  await assert.rejects(() => p.reference.current(), e => e instanceof PortUnavailable
    && e.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE' && !e.message.includes('PRIVATE_CANARY'));
});
test('M1 private port deadline aborts a stalled call and never proves read denial', { timeout: 5000 }, async () => {
  let aborted = false;
  const p = createBoundPorts(unitBindings({ fetch: request => new Promise((_, fail) => {
    request.signal.addEventListener('abort', () => { aborted = true; fail(new Error('PRIVATE_TIMEOUT')); }, { once: true });
  }) }));
  await assert.rejects(() => p.reference.current(), e => e instanceof PortUnavailable && e.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
  assert.equal(aborted, true);
});
test('M1 execution deadline still aborts a stalled persistent decision without proving denial', { timeout: 6000 }, async () => {
  let aborted = false;
  const p = createBoundPorts(unitBindings({ fetch: request => new Promise((_, fail) => {
    request.signal.addEventListener('abort', () => { aborted = true; fail(new Error('PRIVATE_EXECUTION_TIMEOUT')); }, { once: true });
  }) }));
  await assert.rejects(() => p.reference.permissions({ account: 'account-a', subject: 'synthetic-operator-a' }, 'read'),
    e => e instanceof PortUnavailable && e.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
  assert.equal(aborted, true);
});
for (const capability of ['permissions','prepared']) test('M1 bounded execution budget preserves a slow ' + capability + ' result without granting read', async () => {
  const expected = capability === 'permissions' ? ['connect'] : { ok: false, code: 'INTEGRATION_TOKEN_UNAVAILABLE' };
  const p = createBoundPorts(unitBindings({ fetch: async () => {
    await new Promise(ok => setTimeout(ok, 1200));
    return Response.json({ ok: true, value: expected });
  } }));
  const actual = capability === 'permissions'
    ? await p.reference.permissions({ account: 'account-a', subject: 'synthetic-operator-a' }, 'read')
    : await p.vaults.assertPrepared('account-a', {});
  assert.deepEqual(actual, expected);
});
for (const [label, service] of [
  ['redirect', { fetch: async () => new Response(null, { status: 302, headers: { Location: 'https://api.mercadolibre.com' } }) }],
  ['unavailable', { fetch: async () => Response.json({ private: 'NEVER_RELAY' }, { status: 503 }) }],
  ['invalid envelope', { fetch: async () => Response.json({ ok: false, value: ['read'] }) }],
  ['unexpected envelope field', { fetch: async () => Response.json({ ok: true, value: ['read'], private: 'NEVER_RELAY' }) }]
]) test('M1 private port refuses ' + label, async () => {
  const p = createBoundPorts(unitBindings(service));
  await assert.rejects(() => p.reference.current(), e => e instanceof PortUnavailable && e.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
});

// Private-cause inspection exists only in an ignored, synthetic test view.
// Canonical modules export no diagnostics, observer, flag or extra Error field.
let privateCauseLab;
async function privateLab() {
  if (privateCauseLab) return privateCauseLab;
  const { build } = await import('esbuild');
  const file = resolve(project,'homologation/service-client.ts');
  const current = readFileSync(file,'utf8');
  const original = execFileSync('git',['--no-replace-objects','show',
    'dccd2dd7dab1d0e99ae5f303099b6e6252cd43c7:prototype/mcp-local/homologation/service-client.ts'],{cwd:root}).toString();
  const directory=resolve(project,'work/private-cause-unit');mkdirSync(directory,{recursive:true});
  const prefix=`
    let testClockId=0, testControllers=[], testObserved=[], testRequests;
    const testTimers=new Map(), testDelays=[];
    const setTimeout=(callback,ms)=>{const id=++testClockId;testTimers.set(id,callback);testDelays.push(ms);return id;};
    const clearTimeout=id=>testTimers.delete(id);
    const NativeAbortController=globalThis.AbortController;
    class AbortController extends NativeAbortController {constructor(){super();testControllers.push(this);}}
  `;
  const common=`
    export function testReset(){if(testRequests?.size||testTimers.size)throw new Error('TEST_RESOURCES_NOT_CLOSED');testControllers=[];testObserved=[];testDelays.length=0;}
    export function testFire(){const entry=testTimers.entries().next().value;if(!entry)throw new Error('TEST_TIMER_MISSING');testTimers.delete(entry[0]);entry[1]();}
    export function testController(){return testControllers.at(-1);}
    export function testStats(){return {active:testRequests?.size??0,timers:testTimers.size,delays:[...testDelays],aborted:testControllers.every(x=>x.signal.aborted)};}
  `;
  async function compile(name,text,privateView){
    assert.equal(text.split('const activeRequests = new Set<Request>();').length,2);
    text=text.replace('const activeRequests = new Set<Request>();','const activeRequests = testRequests = new Set<Request>();');
    if(privateView){
      const anchor='privateDiagnostics.set(error, { owner, diagnostic: Object.freeze(diagnostic) });';
      assert.equal(text.split(anchor).length,2);
      text=text.replace(anchor,anchor+' testObserved.push(Object.freeze({...diagnostic}));');
      text+='\nexport function testPrivate(error){return privateDiagnostics.get(error)?.diagnostic;}\nexport function testObservedRows(){return [...testObserved];}\n';
    }
    const outfile=resolve(directory,name+'.mjs');
    await build({stdin:{contents:prefix+text+common,loader:'ts',resolveDir:dirname(file)},outfile,bundle:true,
      platform:'browser',format:'esm',conditions:['workerd','browser']});
    return import(pathToFileURL(outfile).href);
  }
  const candidate=await compile('candidate',current,true),baseline=await compile('baseline',original,false);
  const outfile=resolve(directory,'public-contract.mjs');
  await build({stdin:{contents:"export {errorCode,toolError} from './integration/contracts.ts'; export {createVaultReadHandler} from './vault/server.ts';",resolveDir:project},
    outfile,bundle:true,platform:'browser',format:'esm',conditions:['workerd','browser']});
  privateCauseLab={candidate,baseline,publicCore:await import(pathToFileURL(outfile).href)};return privateCauseLab;
}
const privateServices=service=>({identity:service,registry:service,reference:service,vaults:service});
const privateTick=()=>new Promise(resolve=>setImmediate(resolve));
async function capturePrivate(view,operation){
  let error;try{await operation();}catch(value){error=value;}
  assert.ok(error instanceof view.PortUnavailable,'Only the private closed dependency Error is accepted');
  assert.equal(error.message,'INTEGRATION_DEPENDENCY_UNAVAILABLE');assert.equal(error.name,'PortUnavailable');
  assert.deepEqual(Object.keys(error),['name']);
  for(const key of ['cause','diagnostic','reason','privateCause','phase'])assert.equal(error[key],undefined);
  return error;
}
async function assertPrivatePublic(error,lab){
  async function encode(value){
    const handler=lab.publicCore.createVaultReadHandler(async()=>lab.publicCore.toolError(lab.publicCore.errorCode(value)));
    try{
      const response=await handler.fetch(new Request('http://127.0.0.1/mcp',{method:'POST',headers:{'Content-Type':'application/json',
        Accept:'application/json, text/event-stream','MCP-Protocol-Version':'2025-11-25'},body:JSON.stringify({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:'account',arguments:{account_ref:'account-a'}}})}));
      assert.equal(response.status,200);const raw=await response.text();
      assert.ok(!raw.includes('PRIVATE_CAUSE_CANARY'));assert.doesNotMatch(raw,/"(?:stack|cause|diagnostic|phase)"/);
      const envelope=response.headers.get('content-type')?.includes('text/event-stream')
        ?JSON.parse(raw.split('\n').find(x=>x.startsWith('data: ')).slice(6)):JSON.parse(raw);
      assert.equal(envelope.result.isError,true);assert.equal(envelope.result.structuredContent,undefined);
      assert.deepEqual(envelope.result.content,[{type:'text',text:'INTEGRATION_DEPENDENCY_UNAVAILABLE'}]);return envelope;
    }finally{await handler.close();}
  }
  assert.deepEqual(await encode(error),await encode(new lab.baseline.PortUnavailable()));
}
function assertPrivateClosed(view,error,cause,phase){
  const d=view.testPrivate(error);assert.equal(Object.isFrozen(d),true);
  assert.deepEqual(Object.keys(d).sort(),['cause','phase','port','method','deadlineMs','elapsedMs'].sort());
  assert.equal(d.cause,cause);assert.equal(d.phase,phase);
  assert.equal(d.port,'reference');assert.equal(d.method,'current');assert.equal(d.deadlineMs,1000);
  assert.ok(Number.isFinite(d.elapsedMs)&&d.elapsedMs>=0);
  assert.deepEqual(view.testStats().active,0);assert.equal(view.testStats().timers,0);assert.equal(view.testStats().aborted,true);
  const forbidden=/PRIVATE_CAUSE_CANARY|SYNTHETIC_ACCESS|SYNTHETIC_REFRESH|"(?:stack|request|response|headers|args)"\s*:/;
  assert.doesNotMatch(JSON.stringify(d),forbidden);
  assert.match(JSON.stringify({...d,request:{body:"PRIVATE_CAUSE_CANARY"}}),forbidden);
}
const privateCauseCases=[
  ...[302,401,503].map(status=>['HTTP '+status,'http_status','status',()=>({fetch:async()=>new Response('PRIVATE_CAUSE_CANARY',{status})})]),
  ['content type missing','content_type','content_type',()=>({fetch:async()=>new Response(new Uint8Array([123,125]))})],
  ['content type wrong','content_type','content_type',()=>({fetch:async()=>new Response('{}',{headers:{'Content-Type':'text/plain'}})})],
  ['body reader failure','body_read','body',()=>({fetch:async()=>new Response(new ReadableStream({start(c){c.error(new Error('PRIVATE_CAUSE_CANARY'));}}),{headers:{'Content-Type':'application/json'}})})],
  ['body size refusal','body_read','body',()=>({fetch:async()=>new Response('x'.repeat(16385),{headers:{'Content-Type':'application/json'}})})],
  ['invalid JSON','json','json',()=>({fetch:async()=>new Response('{PRIVATE_CAUSE_CANARY',{headers:{'Content-Type':'application/json'}})})],
  ['envelope false','envelope','envelope',()=>({fetch:async()=>Response.json({ok:false,value:'PRIVATE_CAUSE_CANARY'})})],
  ['envelope extra field','envelope','envelope',()=>({fetch:async()=>Response.json({ok:true,value:null,private:'PRIVATE_CAUSE_CANARY'})})],
  ['opaque primitive rejection','transport','fetch',()=>({fetch:async()=>{throw 'PRIVATE_CAUSE_CANARY';}})],
  ['response getter failure','unexpected','status',()=>({fetch:async()=>({get ok(){throw new Error('PRIVATE_CAUSE_CANARY');}})})],
  ['header getter failure','unexpected','content_type',()=>({fetch:async()=>({ok:true,headers:{get(){throw new Error('PRIVATE_CAUSE_CANARY');}}})})],
  ['cleanup failure','unexpected','cleanup',()=>{let reads=0;const response=Response.json({ok:true,value:null});return {fetch:async()=>({ok:true,headers:response.headers,
    get body(){if(++reads===1)return response.body;throw new Error('PRIVATE_CAUSE_CANARY');}})};}]
];
for(const [label,cause,phase,service]of privateCauseCases)test('M1-PORTDIAG: '+label+' stays private and preserves public MCP',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();const call=v.createReadServiceClient(privateServices(service()));
  const error=await capturePrivate(v,()=>call('reference','current',null));assertPrivateClosed(v,error,cause,phase);await assertPrivatePublic(error,lab);
});
for(const kind of ['ECONNRESET','ETIMEDOUT','AbortError','INTEGRATION_READ_DENIED'])test('M1-PORTDIAG: untrusted '+kind+' cannot choose an internal cause or authorization result',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let reads=0;
  const forged=Object.fromEntries(['message','code','name','stack'].map(key=>[key,null]));
  for(const key of Object.keys(forged))Object.defineProperty(forged,key,{get(){reads++;throw new Error('PRIVATE_CAUSE_CANARY');}});
  const call=v.createReadServiceClient(privateServices({fetch:async()=>{throw forged;}}));const error=await capturePrivate(v,()=>call('reference','current',null));
  assertPrivateClosed(v,error,'transport','fetch');assert.equal(reads,0);await assertPrivatePublic(error,lab);
});
test('M1-PORTDIAG: a previous invocation cannot forge the current failure category',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();const first=v.createReadServiceClient(privateServices({fetch:async()=>new Response(null,{status:503})}));
  const old=await capturePrivate(v,()=>first('reference','current',null));assert.equal(v.testPrivate(old).cause,'http_status');
  const second=v.createReadServiceClient(privateServices({fetch:async()=>{throw old;}}));const error=await capturePrivate(v,()=>second('reference','current',null));
  assert.notEqual(error,old);assertPrivateClosed(v,error,'transport','fetch');await assertPrivatePublic(error,lab);
});
test('M1-PORTDIAG: a publicly constructed Error does not acquire private authority',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();const forged=new v.PortUnavailable();assert.equal(v.testPrivate(forged),undefined);
  const call=v.createReadServiceClient(privateServices({fetch:async()=>{throw forged;}}));const e=await capturePrivate(v,()=>call('reference','current',null));
  assertPrivateClosed(v,e,'transport','fetch');await assertPrivatePublic(e,lab);
});
test('M1-PORTDIAG: unexpected argument serialization stays denied and closes resources',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let invoked=0;const args={};args.self=args;
  const call=v.createReadServiceClient(privateServices({fetch:async()=>{invoked++;return Response.json({ok:true,value:null});}}));
  const e=await capturePrivate(v,()=>call('reference','current',args));assertPrivateClosed(v,e,'unexpected','request');assert.equal(invoked,0);await assertPrivatePublic(e,lab);
});
test('M1-PORTDIAG: real owned cancellation differs from a forged AbortError',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();const call=v.createReadServiceClient(privateServices({fetch:request=>new Promise((_,reject)=>{
    request.signal.addEventListener('abort',()=>reject(new Error('PRIVATE_CAUSE_CANARY')),{once:true});})}));
  const pending=call('reference','current',null);await privateTick();v.testController().abort();const e=await capturePrivate(v,()=>pending);
  assertPrivateClosed(v,e,'abort','fetch');await assertPrivatePublic(e,lab);
});
for(const [port,method,budget]of [['reference','current',1000],['reference','permissions',3000]])test('M1-PORTDIAG: owned deadline retains exactly '+budget+' ms and wins abort races',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let aborted=false;const call=v.createReadServiceClient(privateServices({fetch:request=>new Promise((_,reject)=>{
    request.signal.addEventListener('abort',()=>{aborted=true;reject({code:'INTEGRATION_READ_DENIED'});},{once:true});})}));
  const pending=call(port,method,null);await privateTick();assert.deepEqual(v.testStats().delays,[budget]);v.testFire();const e=await capturePrivate(v,()=>pending);
  const d=v.testPrivate(e);assert.equal(d.cause,'deadline');assert.equal(d.phase,'fetch');assert.equal(d.deadlineMs,budget);assert.equal(d.method,method);
  assert.equal(aborted,true);assert.equal(v.testStats().active,0);assert.equal(v.testStats().timers,0);await assertPrivatePublic(e,lab);
});
test('M1-PORTDIAG: own deadline during body consumption remains fail closed',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let cancelled=false;const call=v.createReadServiceClient(privateServices({fetch:async()=>new Response(new ReadableStream({
    cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}})}));
  const pending=call('reference','current',null);await privateTick();v.testFire();const e=await capturePrivate(v,()=>pending);
  assertPrivateClosed(v,e,'deadline','body');await privateTick();assert.equal(cancelled,true);await assertPrivatePublic(e,lab);
});
test('M1-PORTDIAG: a late response remains cancelled, never becomes data, and releases its Request',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let deliver,cancelled=false;
  const call=v.createReadServiceClient(privateServices({fetch:()=>new Promise(resolve=>{deliver=resolve;})}));
  const pending=call('reference','current',null);await privateTick();v.testFire();const e=await capturePrivate(v,()=>pending);
  assertPrivateClosed(v,e,'deadline','fetch');deliver(new Response(new ReadableStream({cancel(){cancelled=true;}}),{headers:{'Content-Type':'application/json'}}));
  await privateTick();assert.equal(cancelled,true);assert.ok(v.testObservedRows().some(x=>x.cause==='abort'&&x.phase==='late-response'));
  assert.equal(v.testStats().active,0);assert.equal(v.testStats().timers,0);await assertPrivatePublic(e,lab);
});
for(const [label,make]of [['configuration',()=>new Proxy({},{ownKeys(){throw new Error('PRIVATE_CAUSE_CANARY');}})],['capability',()=>null]])
 test('M1-PORTDIAG: invalid '+label+' produces no public diagnostic fields',async()=>{
  const lab=await privateLab(),v=lab.candidate;v.testReset();let e;
  if(label==='configuration')e=await capturePrivate(v,()=>v.createReadServiceClient(make()));
  else{const call=v.createReadServiceClient(privateServices(successPort));e=await capturePrivate(v,()=>call('reference','admin',null));}
  assert.equal(v.testPrivate(e).cause,'unexpected');assert.equal(v.testPrivate(e).phase,label);assert.equal(v.testPrivate(e).port,null);await assertPrivatePublic(e,lab);
 });
test('M1-PORTDIAG: successful values stay identical to the prior client and carry no diagnostic',async()=>{
  const lab=await privateLab();for(const value of [null,{safe:true},['read']]){
    const results=[];for(const v of [lab.baseline,lab.candidate]){v.testReset();const call=v.createReadServiceClient(privateServices({fetch:async()=>Response.json({ok:true,value})}));
      results.push(await call('reference','current',null));assert.equal(v.testStats().active,0);assert.equal(v.testStats().timers,0);assert.equal(v.testStats().aborted,true);}
    assert.deepEqual(results[0],results[1]);
  }
});
test('M1-PORTDIAG: canonical public artifacts expose no private reader, sink, flag or Error extension',async()=>{
  const {build}=await import('esbuild');const artifacts=await build({absWorkingDir:project,entryPoints:['homologation/worker.ts'],bundle:true,format:'esm',platform:'browser',
    conditions:['workerd','browser'],external:['cloudflare:workers'],metafile:true,write:false,outfile:resolve(project,'work/private-public-inspection.mjs')});
  assert.deepEqual(Object.values(artifacts.metafile.outputs).flatMap(x=>x.exports),['default']);
  for(const output of artifacts.outputFiles)assert.doesNotMatch(output.text,/testPrivate|testObservedRows|testController|testFire|__mcpResponseDiag|mutationSchema|recoveryPlanSchema|simulatedMfa|updateSchema|revokeSchema/);
  const real=await import('../work/homologation/ports-library.mjs');assert.deepEqual(Object.keys(real).sort(),['LOCAL_MODE','PORT_DEADLINE_MS','PortUnavailable','createBoundPorts','registry']);
  const error=new real.PortUnavailable();assert.deepEqual(Object.keys(error),['name']);for(const key of ['cause','diagnostic','reason','phase'])assert.equal(error[key],undefined);
});

// GC belongs to isolated Node children, never to the whole workerd suite or production.
const cancellationEvidence = [];
function cancellationDirectory() {
  return mkdtempSync(resolve(project, 'work/m1-cancellation-'));
}
function childRun(directory, name, args, extraEnv = {}) {
  const started = performance.now(); let result;
  const childEnv = { ...process.env, ...extraEnv };
  // A nested --test invocation must start its own runner, not inherit child-v8 mode.
  delete childEnv.NODE_TEST_CONTEXT;
  try {
    const stdout = execFileSync(process.execPath, args, { cwd: project, timeout: 45000,
      env: childEnv, stdio: ['ignore','pipe','pipe'] }).toString();
    writeFileSync(resolve(directory, name + '.log'), stdout);
    result = { name, exit: 0, milliseconds: Math.round(performance.now() - started) };
    return stdout;
  } catch (error) {
    writeFileSync(resolve(directory, name + '.log'), String(error.stdout ?? '') + String(error.stderr ?? ''));
    result = { name, exit: error.status ?? null, signal: error.signal ?? null,
      milliseconds: Math.round(performance.now() - started) };
    throw error;
  } finally { cancellationEvidence.push(result); }
}
test('M1-03B: both original cancellation assertions survive forced GC in three independent processes', { timeout: 45000 }, () => {
  const directory = cancellationDirectory(), prelude = resolve(directory, 'gc-prelude.mjs');
  writeFileSync(prelude, "import {writeFileSync} from 'node:fs'; let calls=0; const timer=setInterval(()=>{global.gc();calls++;},40).unref(); process.on('exit',()=>{clearInterval(timer);writeFileSync(process.env.M1_GC_RECORD+process.pid+'.json',JSON.stringify({calls,node:process.version,undici:process.versions.undici}));});\n");
  const pattern = '^M1 (private port deadline aborts a stalled call and never proves read denial|execution deadline still aborts a stalled persistent decision without proving denial)$';
  for (let run = 1; run <= 3; run++) {
    const prefix = resolve(directory, 'gc-' + run + '-');
    const stdout = childRun(directory, 'original-assertions-' + run,
      ['--expose-gc','--import',prelude,'--test','--test-reporter=tap','--test-name-pattern=' + pattern,'tests/homologation.test.mjs'],
      { M1_GC_RECORD: prefix });
    assert.match(stdout, /# tests 2\b/); assert.match(stdout, /# pass 2\b/); assert.match(stdout, /# fail 0\b/);
    const records = readdirSync(directory).filter(n => n.startsWith('gc-' + run + '-') && n.endsWith('.json'))
      .map(n => JSON.parse(readFileSync(resolve(directory, n))));
    assert.ok(records.some(r => r.calls >= 20), 'GC must actually run in the test processes');
    cancellationEvidence.push({ name: 'forced-gc-observations-' + run, records });
  }
});

// Kept in this already enrolled test file: no new publication path or test discovery rule.
async function cancellationProbe({ moduleUrl, mode }) {
  const assert = (await import('node:assert/strict')).default;
  const { setTimeout: delay } = await import('node:timers/promises');
  const { randomBytes, randomUUID } = await import('node:crypto');
  const { createServer } = await import('node:http');
  const { createBoundPorts, LOCAL_MODE, PortUnavailable } = await import(moduleUrl);
  assert.equal(process.version, 'v24.22.1'); assert.equal(process.versions.undici, '7.30.1');
  assert.equal(typeof global.gc, 'function');
  const material = Object.fromEntries(['a','b'].map(s => ['account-' + s, {
    key: randomBytes(32).toString('base64url'), access: 'SYNTHETIC_ACCESS_' + s.toUpperCase() + '_' + randomUUID(),
    refresh: 'SYNTHETIC_REFRESH_' + s.toUpperCase() + '_' + randomUUID()
  }]));
  const rows = [], references = []; let aborts = 0;
  function observe(request, label) {
    const symbol = Object.getOwnPropertySymbols(request).find(s => s.description === 'abortController');
    assert.ok(symbol, 'Pinned Node Request must own its dependent controller');
    references.push({ label, request: new WeakRef(request), controller: new WeakRef(request[symbol]) });
    request.signal.addEventListener('abort', () => { aborts++; }, { once: true });
  }
  function ports(service) {
    const p = createBoundPorts({ HML_MODE: LOCAL_MODE,
      HML_JWKS: { keys: [{ kty: 'RSA', alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral', n: 'A'.repeat(342), e: 'AQAB' }] },
      HML_MATERIAL: material, HML_IDENTITY: service, HML_REGISTRY: service, HML_REFERENCE: service, HML_VAULTS: service });
    globalThis.__M1PortsLifetimeRoot = p; return p;
  }
  async function collected(label) {
    // Fixed GC observation cycles, not retries of the operation or its assertions.
    for (let i = 0; i < 8; i++) { await delay(15); global.gc(); }
    await delay(0);
    for (const r of references) {
      assert.equal(r.request.deref(), undefined, 'Request retained after cleanup: ' + r.label);
      assert.equal(r.controller.deref(), undefined, 'Dependent controller retained: ' + r.label);
    }
    assert.ok(globalThis.__M1PortsLifetimeRoot, 'Port instance must remain rooted while testing for leaks');
    rows.push({ label, requestsCollectible: references.length, controllersCollectible: references.length });
    references.length = 0;
  }
  const isDependency = e => e instanceof PortUnavailable && e.message === 'INTEGRATION_DEPENDENCY_UNAVAILABLE';
  let gcTimer = setInterval(() => global.gc(), 40);
  try {
    if (mode === 'lifetime') {
      let kind = 'success', bodyCancelled = false, bodyEnded = false, premature = false;
      const p = ports({ fetch: request => {
        observe(request, kind);
        if (kind === 'throw') throw new Error('SYNTHETIC_TRANSPORT');
        if (kind === 'invalid') return Response.json({ invalid: true });
        if (kind === 'body-error') return new Response(new ReadableStream({ start(c) { c.error(new Error('SYNTHETIC_BODY')); } }), { headers: { 'Content-Type': 'application/json' } });
        if (kind === 'body-timeout') return new Response(new ReadableStream({ cancel() { bodyCancelled = true; } }), { headers: { 'Content-Type': 'application/json' } });
        if (kind === 'slow-body') {
          request.signal.addEventListener('abort', () => { if (!bodyEnded) premature = true; }, { once: true });
          return new Response(new ReadableStream({ start(c) {
            setTimeout(() => { bodyEnded = true; c.enqueue(new TextEncoder().encode('{"ok":true,"value":"complete"}')); c.close(); }, 160);
          } }), { headers: { 'Content-Type': 'application/json' } });
        }
        return Response.json({ ok: true, value: 'complete' });
      } });
      for (kind of ['success','throw','invalid','body-error','body-timeout','slow-body']) {
        const before = aborts;
        if (kind === 'success' || kind === 'slow-body') assert.equal(await p.reference.current(), 'complete');
        else await assert.rejects(() => p.reference.current(), isDependency);
        await delay(0); assert.equal(aborts, before + 1);
        if (kind === 'body-timeout') assert.equal(bodyCancelled, true);
        if (kind === 'slow-body') { assert.equal(bodyEnded, true); assert.equal(premature, false); }
        await collected(kind);
      }
      // One call's finally must not release another call's still-active Request.
      const q = ports({ fetch: request => {
        const persistent = request.url.endsWith('/permissions'); observe(request, persistent ? 'long-concurrent' : 'short-concurrent');
        return new Promise((_, fail) => request.signal.addEventListener('abort', () => fail(new Error('SYNTHETIC_ABORT')), { once: true }));
      } });
      const a = q.reference.current(), b = q.reference.permissions({ account: 'account-a', subject: 'synthetic-operator-a' }, 'read');
      a.catch(() => {}); b.catch(() => {});
      await assert.rejects(a, isDependency); await assert.rejects(b, isDependency);
      assert.equal(aborts, 8); await collected('concurrent-one-and-three-second-deadlines');
    } else if (mode === 'http') {
      clearInterval(gcTimer); gcTimer = undefined;
      const nativeFetch = globalThis.fetch;
      for (let iteration = 1; iteration <= 3; iteration++) {
        let work, reply, ticks = 0, sent = false, acknowledged = false, manual = false, closeAt, errorAt;
        let nativeFailure, nativeFailureAt, signalAt, operationStarted;
        let start, failStart, stopped, failStop;
        const started = new Promise((ok, fail) => { start = ok; failStart = fail; }); started.catch(() => {});
        const stop = new Promise((ok, fail) => { stopped = ok; failStop = fail; }); stop.catch(() => {});
        const server = createServer((incoming, response) => {
          assert.equal(incoming.socket.remoteAddress, '127.0.0.1'); incoming.resume(); start();
          work = setInterval(() => { ticks++; }, 20);
          reply = setTimeout(() => { sent = true; response.end('SYNTHETIC_LATE_RESPONSE'); }, 1500);
          response.once('close', () => {
            clearInterval(work); clearTimeout(reply);
            if (manual) return;
            if (response.writableFinished) failStop(new Error('LATE_RESPONSE_WAS_SENT'));
            else { acknowledged = true; closeAt = performance.now(); stopped(); }
          });
        });
        await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
        const url = 'http://127.0.0.1:' + server.address().port + '/synthetic';
        const p = ports({ fetch: request => { observe(request, 'http-' + iteration);
          request.signal.addEventListener('abort', () => { signalAt = performance.now(); }, { once: true });
          const task = nativeFetch(url, { method: 'POST', body: 'SYNTHETIC_ONLY', signal: request.signal });
          task.catch(error => { nativeFailure = error; nativeFailureAt = performance.now(); });
          return task; } });
        let startLimit, stopLimit;
        try {
          operationStarted = performance.now();
          const operation = p.reference.current(); operation.catch(() => {});
          startLimit = setTimeout(() => failStart(new Error('NO_LOCAL_IO_STARTED')), 750);
          await started; clearTimeout(startLimit);
          gcTimer = setInterval(() => global.gc(), 40);
          await assert.rejects(operation, isDependency); errorAt = performance.now();
          stopLimit = setTimeout(() => failStop(new Error('NO_COOPERATIVE_STOP_ACK')), 1000);
          await stop; clearTimeout(stopLimit); clearInterval(gcTimer); gcTimer = undefined;
          assert.ok(nativeFailure instanceof DOMException); assert.equal(nativeFailure.name, 'AbortError');
          assert.ok(signalAt <= nativeFailureAt, 'Signal must precede the native transport rejection');
          assert.ok(signalAt - operationStarted >= 900, 'An early transport failure cannot impersonate the one-second deadline');
          const finalTicks = ticks; await delay(120);
          assert.equal(ticks, finalTicks); assert.equal(sent, false); assert.equal(acknowledged, true);
          rows.push({ label: 'http-cancellation-' + iteration, signalDelivered: aborts === iteration,
            ioClosed: acknowledged, lateResponseSent: sent, workAfterStopAck: ticks - finalTicks,
            stopAckAfterCallerRejectionMs: Math.round(closeAt - errorAt), nativeTransportError: nativeFailure.name,
            signalPrecededTransportRejection: true, manualCleanupUsedAsProof: false });
          assert.equal(aborts, iteration);
        } finally {
          manual = true; clearTimeout(startLimit); clearTimeout(stopLimit); clearInterval(gcTimer); gcTimer = undefined;
          clearInterval(work); clearTimeout(reply); server.closeAllConnections(); await new Promise(ok => server.close(ok));
        }
        await collected('http-release-' + iteration);
      }
    } else if (mode === 'noncooperative') {
      let ticks = 0, work, finish, bodyCancelled = false;
      const p = ports({ fetch: request => {
        observe(request, 'noncooperative'); work = setInterval(() => { ticks++; }, 20);
        return new Promise(ok => { finish = () => { clearInterval(work); ok(new Response(new ReadableStream({
          cancel() { bodyCancelled = true; }
        }))); }; });
      } });
      try {
        await assert.rejects(() => p.reference.current(), isDependency); assert.equal(aborts, 1);
        const atRejection = ticks; await delay(160); assert.ok(ticks > atRejection);
        rows.push({ label: 'noncooperative-counterexample', responseRejected: true, signalDelivered: true,
          underlyingStoppedBySignal: false, workAfterRejection: ticks - atRejection });
        finish(); finish = undefined; await delay(0); assert.equal(bodyCancelled, true);
        rows.push({ label: 'late-response', discardedAndBodyCancelled: true });
        await collected('noncooperative-release-after-manual-completion');
      } finally { clearInterval(work); if (finish) finish(); finish = undefined; }
    } else throw new Error('UNKNOWN_CANCELLATION_PROBE');
    return { mode, rows, aborts, forcedGc: true, noRealCredentials: true };
  } finally { clearInterval(gcTimer); delete globalThis.__M1PortsLifetimeRoot; }
}
function runCancellationProbe(mode) {
  const directory = cancellationDirectory(), file = resolve(directory, 'probe.mjs');
  writeFileSync(file, '(' + cancellationProbe.toString() + ')(JSON.parse(process.argv[2])).then(value=>console.log(JSON.stringify(value))).catch(error=>{console.error(error);process.exitCode=1;});\n');
  const moduleUrl = new URL('../work/homologation/ports-library.mjs', import.meta.url).href;
  const stdout = childRun(directory, mode, ['--expose-gc',file,JSON.stringify({ moduleUrl, mode })]);
  const result = JSON.parse(stdout); cancellationEvidence.push(result); return result;
}
for (const mode of ['lifetime','http','noncooperative']) test('M1-03B: cancellation proof and reference cleanup: ' + mode,
  { timeout: 20000 }, () => { const result = runCancellationProbe(mode); assert.equal(result.mode, mode); });

const evidence = [], portEvidence = [];
function scenario(name, run) {
  test('M1 workerd: ' + name, { timeout: 30000 }, async t => { await run(t); evidence.push({ name, completed: true }); });
}
async function portClosed(url) {
  await new Promise((ok, fail) => {
    const socket = createConnection({ host: '127.0.0.1', port: Number(url.port) });
    const timer = setTimeout(() => finish(new Error('M1_PORT_PROBE_TIMEOUT')), 1000);
    const finish = error => { clearTimeout(timer); socket.destroy(); error ? fail(error) : ok(); };
    socket.once('connect', () => finish(new Error('M1_PORT_LEFT_OPEN')));
    socket.once('error', error => finish(error.code === 'ECONNREFUSED' ? undefined : error));
  });
}
async function setup(t, { initialize = true, enabled = true } = {}) {
  const fixture = await createHomologationFixture();
  const directory = mkdtempSync(resolve(project, 'work/m1-case-')), handles = [];
  const open = async () => {
    const h = await fixture.open({ path: resolve(directory, 'state'), enabled }); handles.push(h); return h;
  };
  t.after(async () => {
    try {
      const results = await Promise.allSettled(handles.map(h => h.close()));
      const errors = results.filter(r => r.status === 'rejected').map(r => r.reason);
      if (errors.length) throw new AggregateError(errors, 'M1_TEST_CLEANUP_FAILED');
      for (const h of handles) {
        portEvidence.push({ test: t.name, trace: h.driver.trace() });
        assert.equal(h.outboundAttempts(), 0);
        assert.deepEqual(h.resources(), {
          front: { closed: true, clients: 0, requests: 0, fetches: 0 },
          backend: { closed: true, clients: 0, requests: 0, fetches: 0 }, portTasks: 0
        });
        h.assertRedacted(h.wire); h.assertRedacted(h.driver.trace());
        for (const url of h.urls) await portClosed(url);
      }
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
  const h = await open();
  if (initialize) { await h.driver.provision(); await h.driver.seed(); }
  return { h, open };
}
const args = (suffix = 'a', tool = 'account') => ({
  account_ref: 'account-' + suffix, ...(tool === 'listing' ? { item_id: 'MLB_SYNTH_' + suffix.toUpperCase() + '_001' } : {})
});
const rejectCode = (r, expected) => {
  assert.equal(r.isError, true); assert.equal(r.structuredContent, undefined);
  assert.deepEqual(r.content, [{ type: 'text', text: expected }]); return r;
};
async function using(h, suffix, run, mode = { pin: '2026-07-28' }) {
  const c = await h.connect('synthetic-operator-' + suffix, mode);
  try { return await run(c); } finally { await c.close(); }
}
async function read(h, suffix = 'a', tool = 'account') {
  return using(h, suffix, async c => {
    const r = await c.callTool({ name: tool, arguments: args(suffix, tool) });
    assert.equal(r.isError, undefined); const d = dataOf(r); assert.equal(d.source, 'synthetic');
    assert.equal(d.untrusted_data, true); h.assertRedacted(r); return d.data;
  });
}
async function waitBuffered(h) {
  for (let n=0;n<100;n++) { if ((await h.driver.waiting()).length) return; await new Promise(ok => setTimeout(ok, 5)); }
  assert.fail('EXPECTED_REAL_BUFFERED_BARRIER');
}
scenario('exactly three tools and both approved profiles work for both accounts', async t => {
  const { h } = await setup(t);
  for (const mode of [{ pin: '2026-07-28' }, 'legacy']) for (const suffix of ['a','b']) {
    await using(h, suffix, async c => {
      const tools = (await c.listTools()).tools; assert.deepEqual(tools.map(x => x.name), ['account','listings','listing']);
      assert.ok(tools.every(x => x.annotations.readOnlyHint === true));
      for (const tool of ['account','listings','listing']) {
        const r = await c.callTool({ name: tool, arguments: args(suffix, tool) });
        assert.equal(r.isError, undefined); h.assertRedacted(r);
      }
    }, mode);
  }
  const names = new Set(h.driver.trace().map(x => x.port));
  assert.deepEqual([...names].sort(), ['identity','reference','registry','vaults']);
});
scenario('verified A and B identities never access the other account', async t => {
  const { h } = await setup(t);
  for (const [who, other] of [['a','b'],['b','a']]) await using(h, who, async c => {
    for (const tool of ['account','listings','listing']) rejectCode(await c.callTool({ name: tool, arguments: args(other, tool) }), 'INTEGRATION_READ_DENIED');
  });
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
});
scenario('invalid JWT or unknown operator is refused before any private port', async t => {
  const { h } = await setup(t);
  const tokens = ['', 'not-a-jwt', await h.assertion('unknown-operator'), await h.assertion('synthetic-operator-a', { aud: 'wrong' })];
  for (const token of tokens) assert.equal((await h.raw({ token, body: {} })).status, 401);
  assert.deepEqual(h.driver.trace(), []);
});
scenario('extra selectors and administrative tools remain rejected by MCP', async t => {
  const { h } = await setup(t);
  await using(h, 'a', async c => {
    for (const field of ['seller_id','vault_ref','keyId','environment','token','subject'])
      await expectInvalidArguments(c, 'account', { ...args(), [field]: 'untrusted' });
    for (const name of ['connect','refresh','fixture','seed','restore','grant','recover']) await expectUnknownTool(c, name);
  });
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
});
scenario('fixture, OAuth and internal HTTP routes are not exposed', async t => {
  const { h } = await setup(t);
  for (const path of ['/fixture','/seed','/restore','/admin','/oauth/start','/oauth/mercadolivre/callback','/internal/vault','/mcp?url=https://api.mercadolibre.com'])
    assert.equal((await h.raw({ path, method: 'GET', token: '' })).status, 404);
  assert.deepEqual(h.driver.trace(), []);
});
scenario('registry port cannot retarget an authorized account to another vault', async t => {
  const { h } = await setup(t); h.driver.swapRegistry(true);
  await using(h, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_BINDING_DENIED'));
  assert.equal(h.driver.trace().some(x => x.port === 'vaults' && x.method === 'execute'), false);
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
});
scenario('read never refreshes, mutates tokens or implies connect', async t => {
  const { h } = await setup(t); const before = await h.driver.tokenState();
  for (const tool of ['account','listings','listing']) await read(h, 'a', tool);
  assert.deepEqual((await h.driver.tokenState()).row, before.row);
  await h.driver.tokenRecord({ expiresAt: Date.now() - 1 }); const expired = await h.driver.tokenState();
  await using(h, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_TOKEN_UNAVAILABLE'));
  assert.deepEqual((await h.driver.tokenState()).row, expired.row);
  assert.equal(h.driver.trace().some(x => /refresh|connect|grant/.test(x.method)), false);
});
scenario('connect-only grant is never a read grant', async t => {
  const { h } = await setup(t); await h.driver.connectOnly();
  await using(h, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_READ_DENIED'));
});
scenario('normal restart proves current state; confirmed revocation survives the next restart', async t => {
  const { h, open } = await setup(t); await read(h); await h.close();
  const second = await open(); await read(second); await second.driver.revoke();
  const confirmed = await second.driver.head(); assert.equal(confirmed.pending, null);
  assert.equal(confirmed.state.anchors.find(x => x.account === 'account-a').status, 'revoked');
  await second.close(); const third = await open();
  await using(third, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_READ_DENIED'));
  assert.deepEqual(await third.driver.head(), confirmed);
});
scenario('constructors and requests do not seed an empty deployment', async t => {
  const { h } = await setup(t, { initialize: false });
  await using(h, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_DEPENDENCY_UNAVAILABLE'));
  assert.equal((await h.driver.tokenState()).row, undefined);
});
for (const mutation of ['revocation','registry-revision']) scenario('buffered payload is discarded after ' + mutation, async t => {
  const { h } = await setup(t); const c = await h.connect(); t.after(() => c.close());
  await h.driver.configure({ pauseAt: 'buffered' }); const wire = h.wire.length;
  const pending = c.callTool({ name: 'account', arguments: args() }); pending.catch(() => {});
  try {
    await waitBuffered(h); assert.equal(h.wire.length, wire, 'No response headers before final proof');
    if (mutation === 'revocation') { const confirmed = await h.driver.revoke(); assert.equal(confirmed.pending, null); }
    else await h.driver.configure({ revision: 2 });
  } finally { await h.driver.release(); }
  rejectCode(await pending, 'INTEGRATION_REVISION_CHANGED');
  assert.equal(h.driver.administrativeEvidence, 'LOCAL_SIMULATION_NOT_REAL_MFA_OR_QUORUM');
});
scenario('client cancellation during confirmed revocation releases no buffered data', async t => {
  const { request: httpRequest } = await import('node:http');
  const { h } = await setup(t); await h.driver.configure({ pauseAt: 'buffered' });
  const body = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: args() } });
  const sentinel = new Error('SYNTHETIC_CLIENT_CANCEL');
  let headers = 0, bytes = 0, resolveClosed, rejectClosed, released = false;
  const closed = new Promise((ok, fail) => { resolveClosed = ok; rejectClosed = fail; }); closed.catch(() => {});
  const request = httpRequest(h.url, { method: 'POST', agent: false, headers: {
    'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': '2025-11-25', 'Cf-Access-Jwt-Assertion': await h.assertion(),
    'Content-Length': Buffer.byteLength(body)
  } }, response => { headers++; response.on('data', chunk => { bytes += chunk.length; }); response.resume(); });
  request.once('error', error => error === sentinel ? resolveClosed() : rejectClosed(error));
  request.setTimeout(5000, () => request.destroy(new Error('UNEXPECTED_LOCAL_TRANSPORT_TIMEOUT')));
  try {
    request.end(body);
    let buffered = false;
    for (let n = 0; n < 300; n++) {
      if ((await h.driver.waiting()).length) { buffered = true; break; }
      await new Promise(ok => setTimeout(ok, 10));
    }
    assert.equal(buffered, true); assert.equal(headers, 0); assert.equal(bytes, 0);
    const original = (await h.driver.events()).find(event => event.phase === 'buffered'); assert.ok(original);
    const confirmed = await h.driver.revoke(); assert.equal(confirmed.pending, null);
    assert.equal(confirmed.state.anchors.find(a => a.account === 'account-a').status, 'revoked');
    request.destroy(sentinel); await closed;
    await h.driver.release(); released = true;
    // Transport closure is not the authorization assertion: use a fresh, valid MCP request.
    await using(h, 'a', async c => rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_READ_DENIED'));
    assert.equal((await h.driver.events()).some(event => event.operationId === original.operationId && event.phase === 'delivery-audit'), false);
    await h.close(); assert.equal(headers, 0); assert.equal(bytes, 0);
    cancellationEvidence.push({ name: 'revocation-and-client-cancellation', confirmedRevoked: true,
      headerCount: headers, deliveredBytes: bytes, freshAuthorizationResult: 'INTEGRATION_READ_DENIED', transportClosureUsedAsDenialProof: false });
  } finally { request.setTimeout(0); request.destroy(); if (!released) await h.driver.release(); }
});
scenario('private port timeout during confirmed revocation discards buffered data', async t => {
  const { h } = await setup(t), c = await h.connect(); t.after(() => c.close());
  await h.driver.configure({ pauseAt: 'buffered' });
  const wire = h.wire.length; let settled = false, released = false;
  const pending = c.callTool({ name: 'account', arguments: args() });
  pending.then(() => { settled = true; }, () => { settled = true; });
  try {
    let buffered = false;
    for (let n = 0; n < 300; n++) {
      if ((await h.driver.waiting()).length) { buffered = true; break; }
      await new Promise(ok => setTimeout(ok, 10));
    }
    assert.equal(buffered, true); assert.equal(h.wire.length, wire);
    const original = (await h.driver.events()).find(event => event.phase === 'buffered'); assert.ok(original);
    const confirmed = await h.driver.revoke(); assert.equal(confirmed.pending, null);
    assert.equal(confirmed.state.anchors.find(a => a.account === 'account-a').status, 'revoked');
    assert.equal(settled, false, 'Revocation must be confirmed while the buffered call is still pending');
    // Do not release the backend pause until the unchanged private-port deadline fires.
    const result = await pending; rejectCode(result, 'INTEGRATION_DEPENDENCY_UNAVAILABLE'); h.assertRedacted(result);
    const pendingBackendTasks = h.resources().portTasks;
    await h.driver.release(); released = true;
    // The same valid JWT/session must now get an explicit authorization denial.
    rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_READ_DENIED');
    assert.equal((await h.driver.events()).some(event => event.operationId === original.operationId && event.phase === 'delivery-audit'), false);
    cancellationEvidence.push({ name: 'private-timeout-and-revocation', confirmedRevoked: true,
      timeoutResult: 'INTEGRATION_DEPENDENCY_UNAVAILABLE', sameSessionResult: 'INTEGRATION_READ_DENIED',
      bufferedCommercialDataDelivered: false, pendingBackendTasksAtCallerReturn: pendingBackendTasks,
      manualBackendReleaseCountedAsCancellation: false });
  } finally { if (!released) await h.driver.release(); }
});
scenario('port transport, timeout and unavailability produce dependency errors, not authorization evidence', async t => {
  const { h } = await setup(t);
  await using(h, 'a', async c => {
    const before = await h.driver.head();
    for (const fault of ['ECONNRESET','ETIMEDOUT','unavailable','timeout']) {
      h.driver.portFault('reference', fault);
      rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
      h.driver.portFault('reference', '');
    }
    assert.deepEqual(await h.driver.head(), before);
  });
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
  await read(h);
});
for (const port of ['identity','vaults']) scenario(port + ' service failure cannot turn into permission or token data', async t => {
  const { h } = await setup(t);
  await using(h, 'a', async c => {
    const before = await h.driver.head(); h.driver.portFault(port, 'ECONNRESET');
    h.assertRedacted(rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_DEPENDENCY_UNAVAILABLE'));
    h.driver.portFault(port, ''); assert.deepEqual(await h.driver.head(), before);
  });
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
});
scenario('registry outage is explicit HTTP unavailability, never proven authorization rejection', async t => {
  const { h } = await setup(t); h.driver.portFault('registry', 'unavailable');
  const response = await h.raw({ headers: { 'MCP-Protocol-Version': '2025-11-25' },
    body: { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'account', arguments: args() } } });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { error: 'INTEGRATION_DEPENDENCY_UNAVAILABLE' });
  assert.equal((await h.driver.events()).filter(e => e.phase === 'provider').length, 0);
});
scenario('generic client transport errors cannot satisfy negative MCP assertions', async () => {
  for (const code of ['ECONNRESET','ETIMEDOUT','ECONNREFUSED']) {
    const error = Object.assign(new Error('PRIVATE_TEST_FAILURE'), { code });
    const operation = async () => { const c = { callTool: async () => { throw error; } };
      rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_READ_DENIED'); };
    await assert.rejects(operation, e => e === error);
  }
});
scenario('concurrent accounts keep distinct bindings and unchanged ciphertexts', async t => {
  const { h } = await setup(t); const a = await h.driver.tokenState('account-a'), b = await h.driver.tokenState('account-b');
  const results = await Promise.all([read(h, 'a'), read(h, 'b')]);
  assert.deepEqual(results.map(x => x.account_ref), ['account-a','account-b']);
  assert.deepEqual((await h.driver.tokenState('account-a')).row, a.row);
  assert.deepEqual((await h.driver.tokenState('account-b')).row, b.row);
});
scenario('provider seller mismatch and secret canary never reach MCP', async t => {
  const { h } = await setup(t);
  for (const fault of ['wrong-identity','leak-identity']) {
    await h.driver.vaultFault(fault);
    await using(h, 'a', async c => h.assertRedacted(rejectCode(await c.callTool({ name: 'account', arguments: args() }), 'INTEGRATION_TOKEN_UNAVAILABLE')));
  }
  h.assertRedacted(await h.driver.events());
});
scenario('disabled local profile is inert', async t => {
  const { h } = await setup(t, { enabled: false });
  const response = await h.raw({ body: {} }); assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { error: 'INTEGRATION_DEPENDENCY_UNAVAILABLE' });
  assert.deepEqual(h.driver.trace(), []);
});
test('M1 public build exports only the handler and excludes private fixtures and harness', () => {
  const report = JSON.parse(readFileSync(resolve(project, 'work/homologation/build-report.json')));
  assert.deepEqual(report.publicExports, ['default']); assert.equal(report.productionReady, false);
  assert.equal(report.deployAuthorized, false);
  assert.ok(report.publicInputs.every(x => !x.includes('tests/fixtures/') && !x.includes('scripts/') && !x.endsWith('recovery/storage.ts')));
});
// Explicitly enrolled through this already-required CI test file. No discovery,
// workflow mutation, retry or additional privilege is involved.
const i1qCIEvidence = [];
const i1qSuites = Object.freeze([
  Object.freeze({ file: 'lab/tests/boundaries.node.mjs', expectedTests: 62 }),
  Object.freeze({ file: '../../tests/b4/m21-preservation.node.mjs', expectedTests: 54 }),
  Object.freeze({ file: 'lab/tests/i2-identity.node.mjs', expectedTests: 11 })
]);
for (const suite of i1qSuites) test('I1-Q CI runs all tests in ' + suite.file, { timeout: 45000 }, () => {
  const directory=resolve(project,'work/i1q-ci'); mkdirSync(directory,{recursive:true});
  const childEnv={...process.env}; delete childEnv.NODE_TEST_CONTEXT;
  const started=performance.now();
  const stdout=execFileSync(process.execPath, ['--test', '--test-reporter=tap', suite.file], {
    cwd:project, env:childEnv, stdio:['ignore','pipe','pipe'], timeout:40000, maxBuffer:16*1024*1024
  }).toString();
  writeFileSync(resolve(directory,suite.file.includes('boundaries')?'boundaries.tap':suite.file.includes('i2-identity')?'i2-identity.tap':'preservation.tap'),stdout);
  const count=name=>{ const matches=[...stdout.matchAll(new RegExp('^# '+name+' (\\d+)$','gm'))];
    assert.equal(matches.length,1,'Exactly one child summary is required');return Number(matches[0][1]); };
  assert.equal(count('tests'),suite.expectedTests); assert.equal(count('pass'),suite.expectedTests);
  for (const name of ['fail','cancelled','skipped','todo']) assert.equal(count(name),0);
  const row={file:suite.file,tests:count('tests'),pass:count('pass'),exit:0,milliseconds:Math.round(performance.now()-started)};
  i1qCIEvidence.push(row); console.log('I1Q_CI_SUITE '+JSON.stringify(row));
});
after(() => writeFileSync(resolve(project, 'work/homologation/test-evidence.json'), JSON.stringify({
  syntheticOnly: true, productionReady: false, administrativeMfaProven: false, realQuorumProven: false,
  independentReferenceProven: false, completedScenarios: evidence, portEvidence, ciContexts: ciContextEvidence, cancellationEvidence,
  preservationRouting: m20RoutingEvidence, i1qCIEvidence, gitBatchEvidence, i2CommittedFixtureEvidence
}, null, 2) + '\n'));
