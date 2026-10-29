import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const B31 = '6252e84f11891c40ff974e6eb1217836c4365902';
export const B4 = '6e595e99f2bc0a84cc216b817cf7eab779502065';
export const M1_BASE = '5f06c69dc3ace96419f4e78a9675d257cc12b45a';
export const M20_BASE = '014a2a5a49211d31bb9275e236fd2c31c1be93d8';
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
// M1-02 permits only these literal additions to the published dispatcher. The
// other commands, runtime pins, inventory checks and workflow checks stay intact.
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
  const after = "        timeout-minutes: ${{ (matrix.suite == 'recovery' || matrix.suite == 'integration') && 5 || 3 }}\n";
  if (original.split(before).length !== 2) throw new PreservationFailure('MCP_WORKFLOW_BASE_UNEXPECTED');
  return original.replace(before, after);
}
const sameBytes = (a,b) => Buffer.from(a).equals(Buffer.from(b));
const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v === 'object'
  ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const must = (v, code) => { if (!v) throw new PreservationFailure(code); };
export function collectSnapshot(root = process.cwd()) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', '--no-replace-objects', ...args], { cwd: root, maxBuffer: 16*1024*1024, stdio:['ignore','pipe','pipe'] });
  const names = ref => git('ls-tree','-r','--name-only','-z',ref).toString().split('\0').filter(Boolean);
  let ancestor = false;
  try { git('merge-base','--is-ancestor',B4,'HEAD'); ancestor = true; } catch { /* Absence/divergence never passes. */ }
  const historical = new Map(names(B31).map(n=>[n,git('show',`${B31}:${n}`)]));
  const base = new Map(names(B4).map(n=>[n,git('show',`${B4}:${n}`)]));
  let m1Ancestor = false;
  try { git('merge-base','--is-ancestor',M1_BASE,'HEAD'); m1Ancestor = true; } catch { /* Fail closed. */ }
  const m1Base = new Map(names(M1_BASE).map(n=>[n,git('show',`${M1_BASE}:${n}`)]));
  let m20Ancestor = false;
  try { git('merge-base','--is-ancestor',M20_BASE,'HEAD'); m20Ancestor = true; } catch { /* Never downgrade a missing checkpoint. */ }
  const m20Base = new Map(names(M20_BASE).map(n=>[n,git('show',`${M20_BASE}:${n}`)]));
  const files = [...new Set(git('ls-files','-z').toString().split('\0').filter(Boolean)
    .concat(git('ls-files','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean)))];
  const current = new Map(files.map(n=>{
    const parts = n.split('/');
    must(!n.startsWith('/') && !n.includes('\\') && parts.every(p=>p && p!=='.' && p!=='..'),'CANDIDATE_PATH');
    for (let i=1;i<=parts.length;i++) must(!lstatSync(resolve(root,...parts.slice(0,i))).isSymbolicLink(),'SYMLINK_REJECTED');
    must(lstatSync(resolve(root,n)).isFile(),'CANDIDATE_FILE');
    return [n,readFileSync(resolve(root,n))];
  }));
  return { ancestor, historical, base, current, m1Ancestor, m1Base, m20Ancestor, m20Base };
}
export function validateSnapshot(s) {
  must(s.ancestor,'BASE_DIVERGED'); must(s.historical.size === 97 && s.base.size === 144,'HISTORICAL_INVENTORY');
  const allowed = new Set([...s.base.keys(), ...ADDED, ...M1_ADDED]);
  must(s.current.size === allowed.size && [...allowed].every(n=>s.current.has(n)) && [...s.current.keys()].every(n=>allowed.has(n)),'CANDIDATE_INVENTORY');
  let identical = 0;
  for (const [n,v] of s.historical) if (!EXCEPTIONS.includes(n)) { must(sameBytes(s.current.get(n),v),'HISTORICAL_CHANGED:'+n); identical++; }
  must(identical===94,'HISTORICAL_COUNT');
  for (const [n,v] of s.base) if (!MODIFIED.includes(n)) must(sameBytes(s.current.get(n),v),'B4_BASE_CHANGED:'+n);
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
  must(sameBytes(s.current.get('prototype/mcp-local/scripts/ci.mjs'),expectedCIDispatcher(s.m1Base.get('prototype/mcp-local/scripts/ci.mjs'))),'CI_CHANGE_NOT_ALLOWED');
  must(sameBytes(s.current.get('.github/workflows/b4-mcp-local.yml'),expectedMCPWorkflow(s.m1Base.get('.github/workflows/b4-mcp-local.yml'))),'MCP_WORKFLOW_CHANGE_NOT_ALLOWED');
  let publishedIdentical = 0;
  for (const [n,v] of s.m1Base) if (!M1_MODIFIED.includes(n)) {
    must(sameBytes(s.current.get(n),v),'M1_PUBLISHED_CHANGED:'+n); publishedIdentical++;
  }
  must(publishedIdentical===160,'M1_PUBLISHED_COUNT');
  must(s.m20Ancestor,'M20_BASE_DIVERGED');
  must(s.m20Base instanceof Map && s.m20Base.size===172,'M20_BASE_INVENTORY');
  let m20Identical = 0;
  for (const [n,v] of s.m20Base) if (!M20_MODIFIED.includes(n)) {
    must(sameBytes(s.current.get(n),v),'M20_PUBLISHED_CHANGED:'+n); m20Identical++;
  }
  must(m20Identical===169,'M20_PUBLISHED_COUNT');
  return { base:B4,historicalBase:B31,historicalFiles:97,byteIdentical:94,exceptions:EXCEPTIONS,
    dependencyFilesPinned:Object.keys(immutable),originalVerifierPreserved:true,activationBlocked:true,
    candidateFiles:s.current.size,allowedAdded:ADDED.length,allowedModified:MODIFIED.length,
    m1Base:M1_BASE,publishedFiles:164,publishedByteIdentical:publishedIdentical,
    authorizedPublishedModifications:M1_MODIFIED,m1Added:M1_ADDED.length,
    m20Base:M20_BASE,m20PublishedFiles:172,m20ProtectedFiles:m20Identical,m20AuthorizedModifications:M20_MODIFIED };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { if(process.argv.length!==2)throw new Error('UNSUPPORTED_ARGUMENTS'); console.log(JSON.stringify(validateSnapshot(collectSnapshot()),null,2)); }
  catch (e) { console.error(JSON.stringify({preservation:'FAILED',code:e instanceof PreservationFailure?e.message:'PRESERVATION_UNVERIFIED'}));process.exitCode=1; }
}
