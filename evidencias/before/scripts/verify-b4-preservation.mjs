import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const B31 = '6252e84f11891c40ff974e6eb1217836c4365902';
export const B4 = '6e595e99f2bc0a84cc216b817cf7eab779502065';
export const M1_BASE = '5f06c69dc3ace96419f4e78a9675d257cc12b45a';
export const M20_BASE = '014a2a5a49211d31bb9275e236fd2c31c1be93d8';
export const I1_BASE = 'f20cf44ccf401080f28ff4bb068e27d436d08f66';
export const I1_ADDED = Object.freeze([
  'prototype/mcp-local/integration/profile.ts',
  'prototype/mcp-local/integration/identity-core.ts',
  'prototype/mcp-local/homologation/service-client.ts',
  'prototype/mcp-local/lab/tests/boundaries.node.mjs',
  'tests/b4/m21-preservation.node.mjs',
  'prototype/mcp-local/recovery/core.ts'
]);
export const I1_MODIFIED = Object.freeze([
  'prototype/mcp-local/integration/composition.ts',
  'prototype/mcp-local/integration/identity.ts',
  'prototype/mcp-local/homologation/ports.ts',
  'scripts/verify-b4-preservation.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs',
  'prototype/mcp-local/recovery/model.ts',
  'prototype/mcp-local/integration/guardian-adapter.ts',
  'prototype/mcp-local/src/persistent-model.ts',
  'prototype/mcp-local/scripts/ci.mjs',
  '.github/workflows/b4-mcp-local.yml'
]);
export const I1_CI_PATHS = Object.freeze([
  '.github/workflows/b4-mcp-local.yml',
  'prototype/mcp-local/scripts/ci.mjs',
  'scripts/verify-b4-preservation.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs',
  'tests/b4/m21-preservation.node.mjs'
]);
export const I1Q_PATHS = Object.freeze([
  'prototype/mcp-local/recovery/core.ts',
  'prototype/mcp-local/recovery/model.ts',
  'prototype/mcp-local/integration/guardian-adapter.ts',
  'prototype/mcp-local/src/persistent-model.ts',
  'prototype/mcp-local/lab/tests/boundaries.node.mjs',
  'scripts/verify-b4-preservation.mjs',
  'tests/b4/m21-preservation.node.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs'
]);
// Closed content authorization, not a path-only exception. The verifier digest is
// normalized solely at its own 64-hex declaration to avoid a recursive self-hash.
const I1_VERIFIER_HASH = '19df2de86284c03633c120c73e941293325ff654feb35fde029e4adbae557700';
const I1_CONTENT = Object.freeze({
  'prototype/mcp-local/scripts/ci.mjs': '2c8ae2bce7a02608f924c57f77af9240e836f83a599addfb716e4e03de7dc712',
  '.github/workflows/b4-mcp-local.yml': '3af89bf098982f127eb35312de8bf35b363c92b09fb5058fddc32bb0cb5f9e33',
  'prototype/mcp-local/recovery/core.ts': 'cab56a3ff02268700c97fbbdb7bf7b6ae6c4735a5d2e5114dfa454ac12244fc0',
  'prototype/mcp-local/recovery/model.ts': '3a5f0abdc38f07e8ae2d9cfda69b66f44911f489151e0ef242030a77fd3f5cfc',
  'prototype/mcp-local/integration/guardian-adapter.ts': '262019868c9502d5e1a29155499811ee32bdcbafd91ea402a9922b9662ba6c55',
  'prototype/mcp-local/src/persistent-model.ts': 'f7e10d8fe5b3af3fca1d666ed170d353bf62c793859cb348992cff05d053566c',
  'prototype/mcp-local/integration/profile.ts': '0356eb2c14dfd2ee79d0a221292397f9dbbd16c5420fd8a951398ffb34bc9989',
  'prototype/mcp-local/integration/identity-core.ts': '2a317dc87ce5e5160f9e1b684972f20a5390132bc4266f64c017140359e42568',
  'prototype/mcp-local/homologation/service-client.ts': '01692aba26c650feac59ffcbe685f75fa59780d2c101abb228514bdb7c0260df',
  'prototype/mcp-local/lab/tests/boundaries.node.mjs': '2676d2a00747ba711688f678b2c49706b981f908f56687aaf1d76c11b48b6bbe',
  'tests/b4/m21-preservation.node.mjs': '3eb19072da24cf389581920412a8efb4fe91ced425d57684a8849afbfe225740',
  'prototype/mcp-local/integration/composition.ts': 'd35cf5a51698f2da21ac946c600b5b2d8fc8c4290035cc2f606eaec6fc755fbd',
  'prototype/mcp-local/integration/identity.ts': 'ec172fa441d05c004ffb943a5d7374bb488204fbda715fd18367599e8ddf539e',
  'prototype/mcp-local/homologation/ports.ts': '491af00348dd0cab9bd45a98b75e8100611c88510c0724494f367dfd4e0c3822',
  'prototype/mcp-local/tests/homologation.test.mjs': '9cbe38dbddd554f899df0e37efd08585fa6ec077c717b2fef2df3cf7b259d73d'
});
// I2 is a new, closed epoch. I1 content pins and its normalized self-hash above stay immutable.
export const I2_BASE = 'b3df5def93688d9d68fad39a9a61e96b5c4ba437';
export const I2_ADDED = Object.freeze([
  'prototype/mcp-local/i2/identity-worker.ts',
  'prototype/mcp-local/i2/identity-config.ts',
  'prototype/mcp-local/scripts/build-i2-identity.mjs',
  'prototype/mcp-local/scripts/i2-identity-harness.mjs',
  'prototype/mcp-local/lab/tests/i2-identity.node.mjs',
  'prototype/mcp-local/docs/i2-identity.md'
]);
export const I2_MODIFIED = Object.freeze([
  'prototype/mcp-local/scripts/homologation-harness.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs',
  'scripts/verify-b4-preservation.mjs',
  'tests/b4/m21-preservation.node.mjs'
]);
const I2_VERIFIER_HASH = 'ab7209fc26bfdf1a118b912ee450f4cb1ae3f61b4f48efd216c71e167f7f8b55';
const I2_CONTENT = Object.freeze({
  'prototype/mcp-local/i2/identity-worker.ts': 'ee78ad92c1cc7fe7da40f08aea50350400b446990a9140e2b3b1ed7f83a5c8d8',
  'prototype/mcp-local/i2/identity-config.ts': '52b16732e1d7f1f83a09512cd88e4312b3e6bccfed27516fc91caf75376089c2',
  'prototype/mcp-local/scripts/build-i2-identity.mjs': '670f53ebf90add286f175579832626e11f1a3e3e193c062b128c0c85d83efa04',
  'prototype/mcp-local/scripts/i2-identity-harness.mjs': 'a09ca1c11bc2651b2d71608eb1625db6ea89b6bed3e2f6ac301c7a95dc55da6a',
  'prototype/mcp-local/lab/tests/i2-identity.node.mjs': 'cf86aca09dd74baec8c9f710aa69a00706c641955cc5e3512ecc4a29ba32be53',
  'prototype/mcp-local/docs/i2-identity.md': '5b4dcd9457fe24a7c62fa2a90e3193fad6b5a41a1c9afac2f052423e4496a126',
  'prototype/mcp-local/scripts/homologation-harness.mjs': '4bc4b1574c713643e35cbaab74ac525de540fa086e425c231f54876d72a5a708',
  'prototype/mcp-local/tests/homologation.test.mjs': 'f7c79ca493c93c246d1762110565e7308af677be81ccbed03be07ae01d2e5ac6',
  'tests/b4/m21-preservation.node.mjs': 'b6cb5883f23373723c496a2edb7320cf9ab894683e8470582dde379934121d9d',
});
export const M20_MODIFIED = Object.freeze(['.github/workflows/b3-sqlite.yml',
  'scripts/verify-b4-preservation.mjs', 'prototype/mcp-local/tests/homologation.test.mjs']);
export const M1_ADDED = Object.freeze([
  'prototype/mcp-local/homologation/ports.ts',
  'prototype/mcp-local/homologation/composition.ts',
  'prototype/mcp-local/homologation/worker.ts',
  'prototype/mcp-local/scripts/build-homologation.mjs',
  'prototype/mcp-local/scripts/homologation-harness.mjs',
  'prototype/mcp-local/tests/homologation.test.mjs',
  'prototype/mcp-local/tsconfig.homologation.json',
  'prototype/mcp-local/docs/homologation-m1.md'
]);
export const M1_MODIFIED = Object.freeze(['scripts/verify-b4-preservation.mjs',
  'prototype/mcp-local/scripts/ci.mjs', '.github/workflows/b3-sqlite.yml', '.github/workflows/b4-mcp-local.yml']);
export const EXCEPTIONS = ['package.json', 'package-lock.json', '.github/workflows/b3-sqlite.yml'];
const immutable = {
  'package.json': '2f183327aee7ff66c9177e9652538d77647506b70cf1060f893bad8b443e1b9a',
  'package-lock.json': 'd671586fc0ba1fb05d8a6f0f6762984b223644657ff98f6acc651d7ac745b46a',
  'prototype/mcp-local/package.json': 'b3a99c88f32a797a1987cd80f746d5cbba5e6a731e02d485c4ec7fc2461f66c9',
  'prototype/mcp-local/package-lock.json': '29e5a5711005587691a70a8f8e9c9e13d4b2f1a9078de1bf90043e957f913949'
};
export const MODIFIED = ['package.json','package-lock.json','prototype/mcp-local/package.json','prototype/mcp-local/package-lock.json',
  'prototype/mcp-local/vault/server.ts','prototype/mcp-local/vault/storage.ts','.github/workflows/b4-mcp-local.yml',
  '.github/workflows/b3-sqlite.yml','prototype/mcp-local/README.md'];
export const ADDED = [
  'prototype/mcp-local/docs/integration.md','prototype/mcp-local/integration/composition.ts','prototype/mcp-local/integration/contracts.ts',
  'prototype/mcp-local/integration/guardian-adapter.ts','prototype/mcp-local/integration/identity.ts','prototype/mcp-local/integration/registry.ts',
  'prototype/mcp-local/scripts/build-integration.mjs','prototype/mcp-local/scripts/integrated-harness.mjs',
  'prototype/mcp-local/tests/fixtures/integrated-worker.ts','prototype/mcp-local/tests/integration.test.mjs',
  'prototype/mcp-local/tsconfig.integration.json','prototype/mcp-local/vault/read-core.ts',
  'scripts/verify-b4-preservation.mjs','scripts/audit-cloudflare-bundles.mjs','tests/b4/preservation.node.mjs',
  'prototype/mcp-local/scripts/ci.mjs','prototype/mcp-local/integration/read-failure.ts',
  'prototype/mcp-local/tests/query-classification.test.mjs','prototype/mcp-local/scripts/prove-buffering.mjs',
  'prototype/mcp-local/tests/fixtures/buffering-worker.ts'
];
const sqliteStep = `      - name: Verify preservation for the target branch
        env:
          B4_PRESERVATION: \${{ github.ref == 'refs/heads/b4/cloudflare-access-mcp' || github.base_ref == 'b4/cloudflare-access-mcp' || github.head_ref == 'b4/cloudflare-access-mcp' }}
        run: |
          set -euo pipefail
          fail() { printf 'PRESERVATION_SELECTION_FAILED:%s\\n' "$1" >&2; exit 1; }
          readonly checkpoint='014a2a5a49211d31bb9275e236fd2c31c1be93d8'
          readonly b3_checkpoint='a53f7f3af8c0edb0da856916b60706b342d0118a'
          readonly b3_verifier_sha256='1c555944f05a3d87158cfe807a3058201df2ca973c1ae565c8ed94e6fabf7931'
          # Branch metadata can forbid fallback; it never selects a verifier by itself.
          B4_PRESERVATION="\${B4_PRESERVATION:-false}"
          case "\${B4_PRESERVATION:-false}" in true|false) ;; *) fail INVALID_CONTEXT ;; esac
          [[ -z "\${GIT_GRAFT_FILE+x}\${GIT_SHALLOW_FILE+x}\${GIT_REPLACE_REF_BASE+x}" ]] || fail HISTORY_OVERRIDE
          if ! toplevel=$(git --no-replace-objects rev-parse --show-toplevel); then fail GIT_FAILED; fi
          [[ "$toplevel" == "$(pwd -P)" ]] || fail REPOSITORY_ROOT
          if ! shallow=$(git --no-replace-objects rev-parse --is-shallow-repository); then fail GIT_FAILED; fi
          [[ "$shallow" == false ]] || fail SHALLOW_HISTORY
          if ! replacements=$(git --no-replace-objects for-each-ref --format='%(refname)' refs/replace/); then fail GIT_FAILED; fi
          [[ -z "$replacements" ]] || fail REPLACED_HISTORY
          if ! grafts=$(git --no-replace-objects rev-parse --git-path info/grafts); then fail GIT_FAILED; fi
          [[ ! -s "$grafts" ]] || fail GRAFTED_HISTORY
          if git --no-replace-objects config --get-regexp '^(extensions\\.partialclone|remote\\..*\\.promisor)$' >/dev/null; then
            fail PARTIAL_HISTORY
          else
            status=$?; [[ "$status" == 1 ]] || fail GIT_FAILED
          fi
          git --no-replace-objects cat-file -e "$checkpoint^{commit}" || fail CHECKPOINT_MISSING
          git --no-replace-objects cat-file -e "$b3_checkpoint^{commit}" || fail B3_CHECKPOINT_MISSING
          git --no-replace-objects cat-file -e 'HEAD^{commit}' || fail HEAD_MISSING
          git --no-replace-objects merge-base --is-ancestor "$b3_checkpoint" "$checkpoint" || fail CHECKPOINT_CHAIN
          if git --no-replace-objects merge-base --is-ancestor "$checkpoint" HEAD; then
            [[ ! -L scripts && -f scripts/verify-b4-preservation.mjs && ! -L scripts/verify-b4-preservation.mjs ]] || fail B4_VERIFIER_MISSING
            node scripts/verify-b4-preservation.mjs
          else
            status=$?; [[ "$status" == 1 ]] || fail GIT_FAILED
            if [[ "$B4_PRESERVATION" == "true" ]]; then fail B4_CONTEXT_WITHOUT_ANCESTRY; fi
            if git --no-replace-objects merge-base --is-ancestor "$b3_checkpoint" HEAD; then
              for marker in scripts/verify-b4-preservation.mjs src/b4/local.ts prototype/mcp-local/package.json; do
                [[ ! -e "$marker" && ! -L "$marker" ]] || fail B4_WITHOUT_ANCESTRY
              done
            else
              status=$?; [[ "$status" == 1 ]] || fail GIT_FAILED
              fail UNRECOGNIZED_LINEAGE
            fi
            [[ ! -L scripts && -f scripts/verify-b3-preservation.mjs && ! -L scripts/verify-b3-preservation.mjs ]] || fail B3_VERIFIER_MISSING
            printf '%s  %s\\n' "$b3_verifier_sha256" scripts/verify-b3-preservation.mjs | sha256sum --check --status || fail B3_VERIFIER_CHANGED
            node scripts/verify-b3-preservation.mjs
          fi
`;
class PreservationFailure extends Error {}
export function expectedSQLiteWorkflow(original) {
  original = Buffer.from(original).toString('utf8');
  const before = '      - run: node scripts/verify-b3-preservation.mjs\n';
  if (original.split(before).length !== 2) throw new PreservationFailure('SQLITE_BASE_UNEXPECTED');
  // A callback preserves literal shell $ sequences instead of replacement-string metacharacters.
  return original.replace(before, () => sqliteStep);
}
// Historical M1 dispatcher transformation retained as a baseline proof. The
// current split dispatcher additionally requires its exact approved content pin.
export function expectedCIDispatcher(original) {
  original = Buffer.from(original).toString('utf8');
  const before = " integration:{files:['integration.test.mjs','query-classification.test.mjs'],typecheck:'tsconfig.integration.json',commands:[['node','--test','tests/integration.test.mjs','tests/query-classification.test.mjs']]},\n";
  const after = " integration:{files:['integration.test.mjs','query-classification.test.mjs','homologation.test.mjs'],typecheck:'tsconfig.integration.json',commands:[['node','--test','tests/integration.test.mjs','tests/query-classification.test.mjs'],['npm','exec','--','tsc','--noEmit','-p','tsconfig.homologation.json'],['node','--test','tests/homologation.test.mjs']]},\n";
  const anchor = " for(const [name,s] of Object.entries(suites))for(const file of s.files)assert.ok(s.commands.some(args=>args.includes('tests/'+file)),'Missing execution: '+name+'/'+file);\n";
  const checks = " assert.ok(suites.integration.commands.some(args=>JSON.stringify(args)==='[\"npm\",\"exec\",\"--\",\"tsc\",\"--noEmit\",\"-p\",\"tsconfig.homologation.json\"]'),'Missing M1 typecheck');\n"
    + " assert.ok(suites.integration.commands.some(args=>JSON.stringify(args)==='[\"node\",\"--test\",\"tests/homologation.test.mjs\"]'),'Missing M1 execution');\n";
  if (original.split(before).length !== 2 || original.split(anchor).length !== 2) throw new PreservationFailure('CI_BASE_UNEXPECTED');
  return original.replace(before, after).replace(anchor, anchor + checks);
}
export function expectedMCPWorkflow(original) {
  original = Buffer.from(original).toString('utf8');
  const before = "        timeout-minutes: ${{ matrix.suite == 'recovery' && 5 || 3 }}\n";
  const after = "        timeout-minutes: ${{ (matrix.suite == 'recovery' || matrix.suite == 'integration' || matrix.suite == 'homologation') && 5 || 3 }}\n";
  const oldMatrix = '        suite: [mcp, persistence, recovery, vault, integration, buffering, regression]\n';
  const newMatrix = '        suite: [mcp, persistence, recovery, vault, integration, homologation, buffering, regression]\n';
  if (original.split(before).length !== 2 || original.split(oldMatrix).length !== 2) throw new PreservationFailure('MCP_WORKFLOW_BASE_UNEXPECTED');
  return original.replace(before, after).replace(oldMatrix, newMatrix);
}
const sameBytes = (a,b) => Buffer.from(a).equals(Buffer.from(b));
const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v === 'object'
  ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const must = (v, code) => { if (!v) throw new PreservationFailure(code); };
// Fresh, per-collection reads of the five fixed Git trees. Only immutable blob
// OIDs are deduplicated inside this call; no state or decision is cached.
export function readGitSnapshots(runGit, refs = [B31, B4, M1_BASE, M20_BASE, I1_BASE]) {
  const trees = new Map(), oids = new Set();
  const read = (args, input) => {
    let value;
    try { value = runGit(args, input); } catch { throw new PreservationFailure('GIT_READ_FAILED'); }
    must(Buffer.isBuffer(value), 'GIT_OUTPUT_NOT_BUFFER'); return value;
  };
  for (const ref of refs) {
    const raw = read(['ls-tree', '-r', '-z', '--full-tree', ref]);
    const text = raw.toString('utf8');
    must(Buffer.from(text, 'utf8').equals(raw), 'GIT_TREE_ENCODING');
    must(raw.length === 0 || raw[raw.length - 1] === 0, 'GIT_TREE_TRUNCATED');
    const entries = new Map();
    for (const record of text.split('\0').slice(0, -1)) {
      const tab = record.indexOf('\t'), header = tab < 0 ? '' : record.slice(0, tab);
      const match = /^(100644|100755) blob ([a-f0-9]{40})$/.exec(header);
      must(match, 'GIT_TREE_ENTRY');
      const name = record.slice(tab + 1), parts = name.split('/');
      must(name && !name.startsWith('/') && !name.includes('\\') && parts.every(p => p && p !== '.' && p !== '..')
        && !entries.has(name), 'GIT_TREE_PATH');
      entries.set(name, match[2]); oids.add(match[2]);
    }
    trees.set(ref, entries);
  }
  const objects = new Map(), requested = [...oids];
  if (requested.length) {
    const raw = read(['cat-file', '--batch'], Buffer.from(requested.join('\n') + '\n', 'ascii'));
    let offset = 0;
    for (const oid of requested) {
      const end = raw.indexOf(10, offset);
      must(end >= offset && end - offset <= 128, 'GIT_BATCH_HEADER');
      const header = raw.toString('latin1', offset, end);
      must(!/^[a-f0-9]{40} missing$/.test(header), 'GIT_OBJECT_MISSING');
      const match = /^([a-f0-9]{40}) blob (0|[1-9][0-9]*)$/.exec(header);
      must(match, 'GIT_BATCH_HEADER'); must(match[1] === oid, 'GIT_BATCH_OBJECT_MISMATCH');
      const size = Number(match[2]);
      must(Number.isSafeInteger(size) && size <= 16*1024*1024, 'GIT_OBJECT_SIZE');
      offset = end + 1;
      must(offset + size < raw.length, 'GIT_BATCH_TRUNCATED');
      const bytes = raw.subarray(offset, offset + size); offset += size;
      must(raw[offset] === 10, 'GIT_BATCH_DELIMITER'); offset++;
      must(createHash('sha1').update('blob ' + size + '\0').update(bytes).digest('hex') === oid, 'GIT_OBJECT_INTEGRITY');
      objects.set(oid, bytes);
    }
    must(offset === raw.length, 'GIT_BATCH_TRAILING');
  }
  return new Map([...trees].map(([ref, entries]) => [ref,
    new Map([...entries].map(([name, oid]) => [name, Buffer.from(objects.get(oid))]))]));
}
export function collectSnapshot(root = process.cwd()) {
  const git = (args, input) => execFileSync('git', ['--no-optional-locks', '--no-replace-objects', ...args],
    { cwd: root, input, maxBuffer: 16*1024*1024, stdio:[input === undefined ? 'ignore' : 'pipe','pipe','pipe'] });
  let ancestor = false;
  try { git(['merge-base','--is-ancestor',B4,'HEAD']); ancestor = true; } catch { /* Absence/divergence never passes. */ }
  const snapshots = readGitSnapshots(git);
  const historical = snapshots.get(B31), base = snapshots.get(B4);
  let m1Ancestor = false;
  try { git(['merge-base','--is-ancestor',M1_BASE,'HEAD']); m1Ancestor = true; } catch { /* Fail closed. */ }
  const m1Base = snapshots.get(M1_BASE);
  let m20Ancestor = false;
  try { git(['merge-base','--is-ancestor',M20_BASE,'HEAD']); m20Ancestor = true; } catch { /* Never downgrade a missing checkpoint. */ }
  const m20Base = snapshots.get(M20_BASE);
  let i1Ancestor = false;
  try { git(['merge-base','--is-ancestor',I1_BASE,'HEAD']); i1Ancestor = true; } catch { /* No branch-name or historical fallback. */ }
  const i1Base = snapshots.get(I1_BASE);
  const files = [...new Set(git(['ls-files','-z']).toString().split('\0').filter(Boolean)
    .concat(git(['ls-files','--others','--exclude-standard','-z']).toString().split('\0').filter(Boolean)))];
  const current = new Map(files.map(n=>{
    const parts = n.split('/');
    must(!n.startsWith('/') && !n.includes('\\') && parts.every(p=>p && p!=='.' && p!=='..'),'CANDIDATE_PATH');
    for (let i=1;i<=parts.length;i++) must(!lstatSync(resolve(root,...parts.slice(0,i))).isSymbolicLink(),'SYMLINK_REJECTED');
    must(lstatSync(resolve(root,n)).isFile(),'CANDIDATE_FILE');
    return [n,readFileSync(resolve(root,n))];
  }));
  let i2Ancestor = false;
  try { git(['merge-base','--is-ancestor',I2_BASE,'HEAD']); i2Ancestor = true; } catch { /* No historical downgrade. */ }
  const i2Base = readGitSnapshots(git, [I2_BASE]).get(I2_BASE);
  return { ancestor, historical, base, current, m1Ancestor, m1Base, m20Ancestor, m20Base, i1Ancestor, i1Base, i2Ancestor, i2Base };
}
function validateI1Snapshot(s) {
  must(s.ancestor,'BASE_DIVERGED'); must(s.historical.size === 97 && s.base.size === 144,'HISTORICAL_INVENTORY');
  const allowed = new Set([...s.base.keys(), ...ADDED, ...M1_ADDED, ...I1_ADDED]);
  must(s.current.size === allowed.size && [...allowed].every(n=>s.current.has(n)) && [...s.current.keys()].every(n=>allowed.has(n)),'CANDIDATE_INVENTORY');
  let identical = 0;
  for (const [n,v] of s.historical) if (!EXCEPTIONS.includes(n)) { must(sameBytes(s.current.get(n),v),'HISTORICAL_CHANGED:'+n); identical++; }
  must(identical===94,'HISTORICAL_COUNT');
  for (const [n,v] of s.base) if (!MODIFIED.includes(n)) {
    if (I1_MODIFIED.includes(n)) must(hash(s.current.get(n))===I1_CONTENT[n],'I1_CONTENT_CHANGED:'+n);
    else must(sameBytes(s.current.get(n),v),'B4_BASE_CHANGED:'+n);
  }
  for (const [n,h] of Object.entries(immutable)) must(hash(s.current.get(n))===h,'APPROVED_DEPENDENCY_CHANGED:'+n);
  const expected = JSON.parse(s.historical.get('package.json'));
  Object.assign(expected.devDependencies, {'@cloudflare/vitest-plugin':'1.4.8','@cloudflare/workers-types':'5.20261023.1','wrangler':'4.153.0'});
  const pkg = JSON.parse(s.current.get('package.json'));
  must(canonical(pkg)===canonical(expected) && !Object.hasOwn(pkg,'overrides'),'PACKAGE_CHANGE_NOT_ALLOWED');
  const lock = JSON.parse(s.current.get('package-lock.json'));
  must(lock.lockfileVersion===3 && canonical(lock.packages[''].devDependencies)===canonical(pkg.devDependencies),'LOCK_INCONSISTENT');
  must(sameBytes(s.current.get('.github/workflows/b3-sqlite.yml'),expectedSQLiteWorkflow(s.historical.get('.github/workflows/b3-sqlite.yml'))),'SQLITE_CHANGE_NOT_ALLOWED');
  const prod=JSON.parse(s.current.get('wrangler.production.jsonc')),readiness=JSON.parse(s.current.get('config/b3-readiness.json'));
  must(prod.main==='src/preparation/entrypoint.ts' && prod.vars.PREPARATION_CONFIG.transport==='disabled','PRODUCTION_ENTRY_CHANGED');
  must(s.current.get('src/preparation/config.ts').includes('LIVE_TRANSPORT_ENABLED = false') && s.current.get('src/preparation/config.ts').includes('PRODUCTION_OAUTH_ENABLED = false'),'ACTIVATION_CHANGED');
  must(s.current.get('src/b3/entrypoint.ts').includes('PRODUCTION_DISABLED') && s.current.get('src/b3/entrypoint.ts').includes('status: 503'),'B3_NOT_INERT');
  must(['liveTransportEnabled','productionOAuthEnabled','officialMercadoLivreContractsValidated','accessPolicyConfigured','identityProviderMfaVerified','sellerIdentityValidatedLive','realCredentialsConfigured','deploymentAuthorized'].every(k=>readiness[k]===false),'READINESS_CHANGED');
  must(s.m1Ancestor,'M1_BASE_DIVERGED');
  must(s.m1Base instanceof Map && s.m1Base.size===164,'M1_BASE_INVENTORY');
  const ciPath = 'prototype/mcp-local/scripts/ci.mjs';
  must(s.i1Base instanceof Map && Buffer.isBuffer(s.i1Base.get(ciPath))
    && sameBytes(s.i1Base.get(ciPath),expectedCIDispatcher(s.m1Base.get(ciPath)))
    && hash(s.current.get(ciPath))===I1_CONTENT[ciPath],'CI_CHANGE_NOT_ALLOWED');
  must(sameBytes(s.current.get('.github/workflows/b4-mcp-local.yml'),expectedMCPWorkflow(s.m1Base.get('.github/workflows/b4-mcp-local.yml'))),'MCP_WORKFLOW_CHANGE_NOT_ALLOWED');
  let publishedIdentical = 0;
  for (const [n,v] of s.m1Base) if (!M1_MODIFIED.includes(n)) {
    if (I1_MODIFIED.includes(n)) { must(hash(s.current.get(n))===I1_CONTENT[n],'I1_CONTENT_CHANGED:'+n); continue; }
    must(sameBytes(s.current.get(n),v),'M1_PUBLISHED_CHANGED:'+n); publishedIdentical++;
  }
  must(publishedIdentical===155,'M1_PUBLISHED_COUNT');
  must(s.m20Ancestor,'M20_BASE_DIVERGED');
  must(s.m20Base instanceof Map && s.m20Base.size===172,'M20_BASE_INVENTORY');
  let m20Identical = 0;
  for (const [n,v] of s.m20Base) if (!M20_MODIFIED.includes(n)) {
    if (I1_MODIFIED.includes(n)) { must(hash(s.current.get(n))===I1_CONTENT[n],'I1_CONTENT_CHANGED:'+n); continue; }
    must(sameBytes(s.current.get(n),v),'M20_PUBLISHED_CHANGED:'+n); m20Identical++;
  }
  must(m20Identical===161,'M20_PUBLISHED_COUNT');
  must(s.i1Ancestor,'I1_BASE_DIVERGED');
  must(s.i1Base instanceof Map && s.i1Base.size===172,'I1_BASE_INVENTORY');
  const i1Allowed = new Set([...s.i1Base.keys(),...I1_ADDED]);
  must(s.current.size===178 && [...i1Allowed].every(n=>s.current.has(n))
    && [...s.current.keys()].every(n=>i1Allowed.has(n)),'I1_INVENTORY');
  let i1Identical = 0;
  for (const [n,v] of s.i1Base) if (!I1_MODIFIED.includes(n)) {
    must(sameBytes(s.current.get(n),v),'I1_PUBLISHED_CHANGED:'+n); i1Identical++;
  }
  must(i1Identical===162,'I1_PUBLISHED_COUNT');
  must(Object.keys(I1_CONTENT).length===15 && [...I1_ADDED,...I1_MODIFIED].filter(n=>n!=='scripts/verify-b4-preservation.mjs')
    .every(n=>Object.hasOwn(I1_CONTENT,n)),'I1_CONTENT_INVENTORY');
  for (const [n,h] of Object.entries(I1_CONTENT)) must(hash(s.current.get(n))===h,'I1_CONTENT_CHANGED:'+n);
  const verifierBytes = s.current.get('scripts/verify-b4-preservation.mjs');
  const verifierText = Buffer.from(verifierBytes).toString('utf8');
  const marker = /^const I1_VERIFIER_HASH = '[a-f0-9]{64}';$/m;
  const normalized = verifierText.replace(marker, "const I1_VERIFIER_HASH = '"+'0'.repeat(64)+"';");
  must(sameBytes(Buffer.from(verifierText),verifierBytes)
    && marker.exec(verifierText)?.[0] === "const I1_VERIFIER_HASH = '"+I1_VERIFIER_HASH+"';"
    && hash(normalized)===I1_VERIFIER_HASH,'I1_CONTENT_CHANGED:scripts/verify-b4-preservation.mjs');
  return { base:B4,historicalBase:B31,historicalFiles:97,byteIdentical:94,exceptions:EXCEPTIONS,
    dependencyFilesPinned:Object.keys(immutable),originalVerifierPreserved:true,activationBlocked:true,
    candidateFiles:s.current.size,allowedAdded:ADDED.length,allowedModified:MODIFIED.length,
    m1Base:M1_BASE,publishedFiles:164,publishedByteIdentical:publishedIdentical,
    authorizedPublishedModifications:M1_MODIFIED,m1Added:M1_ADDED.length,
    m20Base:M20_BASE,m20PublishedFiles:172,m20ProtectedFiles:m20Identical,m20AuthorizedModifications:M20_MODIFIED,
    i1Base:I1_BASE,i1PublishedFiles:172,i1ProtectedFiles:i1Identical,i1Added:I1_ADDED.length,i1AuthorizedModifications:I1_MODIFIED,i1qAuthorizedPaths:I1Q_PATHS,i1ciAuthorizedPaths:I1_CI_PATHS };
}
export function validateSnapshot(s) {
  must(s.i2Base instanceof Map && s.i2Base.size === 178, 'I2_BASE_INVENTORY');
  const expected = new Set([...s.i2Base.keys(), ...I2_ADDED]);
  must(s.current.size === 184 && expected.size === 184 && [...expected].every(p => s.current.has(p))
    && [...s.current.keys()].every(p => expected.has(p)), 'CANDIDATE_INVENTORY');
  // Prove the published I1 checkpoint under its unchanged historical rules.
  const checkpoint = validateI1Snapshot({ ...s, current: s.i2Base });
  const projected = new Map(s.current);
  for (const p of I2_ADDED) projected.delete(p);
  for (const p of I2_MODIFIED) projected.set(p, s.i2Base.get(p));
  // Non-authorized old bytes still face every historical negative check.
  validateI1Snapshot({ ...s, current: projected });
  must(s.i2Ancestor, 'I2_BASE_DIVERGED');
  const refusedContent = p => p === 'prototype/mcp-local/scripts/homologation-harness.mjs'
    ? 'M1_PUBLISHED_CHANGED:' + p : (I2_MODIFIED.includes(p) ? 'I1_CONTENT_CHANGED:' : 'I2_CONTENT_CHANGED:') + p;
  must(Object.keys(I2_CONTENT).length === 9 && [...I2_ADDED, ...I2_MODIFIED]
    .filter(p => p !== 'scripts/verify-b4-preservation.mjs').every(p => Object.hasOwn(I2_CONTENT,p)), 'I2_CONTENT_INVENTORY');
  for (const [p,h] of Object.entries(I2_CONTENT)) must(hash(s.current.get(p)) === h, refusedContent(p));
  const bytes = s.current.get('scripts/verify-b4-preservation.mjs'), text = Buffer.from(bytes).toString('utf8');
  const marker = /^const I2_VERIFIER_HASH = '[a-f0-9]{64}';$/m;
  const normalized = text.replace(marker, "const I2_VERIFIER_HASH = '"+'0'.repeat(64)+"';");
  must(sameBytes(Buffer.from(text),bytes) && marker.exec(text)?.[0] === "const I2_VERIFIER_HASH = '"+I2_VERIFIER_HASH+"';"
    && hash(normalized) === I2_VERIFIER_HASH, 'I1_CONTENT_CHANGED:scripts/verify-b4-preservation.mjs');
  return { ...checkpoint, candidateFiles: s.current.size,
    historicalCountersDescribe: 'validated I1 checkpoint and I2 projection; actual unchanged I2 files counted separately',
    i2Base: I2_BASE, i2PublishedFiles: 178, i2ProtectedFiles: 174, i2Added: I2_ADDED.length,
    i2AuthorizedModifications: I2_MODIFIED };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { if(process.argv.length!==2)throw new Error('UNSUPPORTED_ARGUMENTS'); console.log(JSON.stringify(validateSnapshot(collectSnapshot()),null,2)); }
  catch (e) { console.error(JSON.stringify({preservation:'FAILED',code:e instanceof PreservationFailure?e.message:'PRESERVATION_UNVERIFIED'}));process.exitCode=1; }
}
