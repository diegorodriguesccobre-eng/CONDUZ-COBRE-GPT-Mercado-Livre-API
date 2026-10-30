import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, renameSync, readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collectSnapshot, validateSnapshot, expectedSQLiteWorkflow, M1_ADDED, M1_MODIFIED, M1_BASE, B31, M20_BASE, M20_MODIFIED, I1_BASE } from '../../../scripts/verify-b4-preservation.mjs';
import { verifyInventory } from '../scripts/ci.mjs';

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

test('M1-01: exactly the eight previously approved names are accepted', () => {
  assert.deepEqual(M1_ADDED, paths); assert.equal(Object.isFrozen(M1_ADDED), true);
  const r = validateSnapshot(complete());
  assert.equal(r.candidateFiles, 178); assert.equal(r.m1Added, 8);
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
const groupNames = ['mcp','persistence','recovery','vault','integration','buffering','regression'];
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
test('M1-02: real dispatcher accepts exactly eight named test files and all seven existing groups', () => {
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
  ['M1 typecheck removal', text => replaceOne(text, ",['npm','exec','--','tsc','--noEmit','-p','tsconfig.homologation.json']", ''), /Missing M1 typecheck/],
  ['M1 execution removal', text => replaceOne(text, ",['node','--test','tests/homologation.test.mjs']", ''), /Missing execution: integration\/homologation\.test\.mjs/],
  ['M1 execution replaced by a no-op', text => replaceOne(text, "['node','--test','tests/homologation.test.mjs']", "['echo','--test','tests/homologation.test.mjs']"), /Missing M1 execution/]
]) test('M1-02: dispatcher explicitly rejects ' + name, () => inventoryFixture(directory => {
  fixtureWrite(directory, ciPath, mutate(readFileSync(resolve(directory, ciPath), 'utf8'))); probeRefused(directory, message);
}));
test('M1-02: CI still requires the independent buffering probe', () => inventoryFixture(directory => {
  rmSync(resolve(directory, 'prototype/mcp-local/scripts/prove-buffering.mjs')); probeRefused(directory, /Missing independent probe/);
}));
test('M1-02: CI still refuses bypass of its workflow invocation', () => inventoryFixture(directory => {
  const path = '.github/workflows/b4-mcp-local.yml';
  fixtureWrite(directory, path, replaceOne(readFileSync(resolve(directory, path), 'utf8'),
    'run: node scripts/ci.mjs run "${{ matrix.suite }}"', 'run: true'));
  probeRefused(directory, /workflow\.includes/);
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
  assert.equal(result.candidateFiles, 178); assert.equal(result.publishedByteIdentical, 155);
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
  const installCandidate = () => { for (const path of M20_MODIFIED) fixtureWrite(repo, path,
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
    if (install) installCandidate();
    const fixture = { repo, directory, git, installCandidate,
      commit: parents => git('commit-tree', git('rev-parse', M20_BASE + '^{tree}'),
        ...parents.flatMap(parent => ['-p', parent]), '-m', 'SYNTHETIC M2.0 DAG ONLY'),
      checkout: commit => { git('checkout', '--quiet', '--detach', commit); installCandidate(); }
    };
    return run(fixture);
  } finally { rmSync(directory, { recursive: true, force: true }); }
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
function checkedSelection(fixture, name, expected, extraEnv) {
  const r = selection(fixture.repo, extraEnv);
  if (expected === 'B4' || expected === 'B3') {
    assert.equal(r.exit, 0, r.stderr); assert.equal(r.signal, null); const report = JSON.parse(r.stdout);
    if (expected === 'B4') {
      assert.equal(report.m20Base, M20_BASE); assert.equal(report.m20ProtectedFiles, 169);
      assert.equal(report.candidateFiles, 172); assert.equal(report.byteIdentical, 94); assert.equal(report.activationBlocked, true);
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
  const report = validateSnapshot(complete()); assert.equal(report.m20PublishedFiles, 172); assert.equal(report.m20ProtectedFiles, 163);
  assert.equal(report.i1ProtectedFiles, 164);
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
test('M2.0-FIX: full published descendant retains the checkpoint and selects B4', () => gitFixture(f => {
  assert.notEqual(f.git('rev-parse', 'HEAD'), M20_BASE);
  assert.equal(f.git('merge-base', '--is-ancestor', M20_BASE, 'HEAD'), '');
  assert.equal(f.git('rev-parse', '--is-shallow-repository'), 'false');
  assert.equal(f.git('cat-file', '-t', M20_BASE), 'commit');
  checkedSelection(f, 'full published descendant', 'B4');
}, { ref: 'HEAD', install: true }));
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

test('M1-03: only integration receives five minutes; recovery stays five and other groups three', () => {
  const path = '.github/workflows/b4-mcp-local.yml';
  const current = readFileSync(resolve(root, path), 'utf8');
  const before = "        timeout-minutes: ${{ matrix.suite == 'recovery' && 5 || 3 }}\n";
  const after = "        timeout-minutes: ${{ (matrix.suite == 'recovery' || matrix.suite == 'integration') && 5 || 3 }}\n";
  assert.deepEqual(Buffer.from(replaceOne(current, after, before)), collected.m1Base.get(path));
  assert.match(current, /^    timeout-minutes: 10$/m);
  const budgets = { mcp: 3, persistence: 3, recovery: 5, vault: 3, integration: 5, buffering: 3, regression: 3 };
  assert.deepEqual(Object.keys(budgets), groupNames);
  assert.equal(budgets.integration * 60, 300); assert.equal(10 * 60 - budgets.integration * 60, 300);
});
for (const [name, change] of [
  ['integration six minutes', text => replaceOne(text, "== 'integration') && 5", "== 'integration') && 6")],
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
  Object.freeze({ file: 'lab/tests/boundaries.node.mjs', expectedTests: 55 }),
  Object.freeze({ file: '../../tests/b4/m21-preservation.node.mjs', expectedTests: 45 })
]);
for (const suite of i1qSuites) test('I1-Q CI runs all tests in ' + suite.file, { timeout: 45000 }, () => {
  const directory=resolve(project,'work/i1q-ci'); mkdirSync(directory,{recursive:true});
  const childEnv={...process.env}; delete childEnv.NODE_TEST_CONTEXT;
  const started=performance.now();
  const stdout=execFileSync(process.execPath, ['--test', '--test-reporter=tap', suite.file], {
    cwd:project, env:childEnv, stdio:['ignore','pipe','pipe'], timeout:40000, maxBuffer:16*1024*1024
  }).toString();
  writeFileSync(resolve(directory,suite.file.includes('boundaries')?'boundaries.tap':'preservation.tap'),stdout);
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
  preservationRouting: m20RoutingEvidence, i1qCIEvidence
}, null, 2) + '\n'));
