import { execFileSync } from 'node:child_process';
import { readFileSync, lstatSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const B31 = '6252e84f11891c40ff974e6eb1217836c4365902';
export const B4 = '6e595e99f2bc0a84cc216b817cf7eab779502065';
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
          B4_PRESERVATION: \${{ github.ref == 'refs/heads/b4/cloudflare-access-mcp' || github.base_ref == 'b4/cloudflare-access-mcp' }}
        run: |
          if [[ "$B4_PRESERVATION" == "true" ]]; then
            node scripts/verify-b4-preservation.mjs
          else
            node scripts/verify-b3-preservation.mjs
          fi
`;
class PreservationFailure extends Error {}
export function expectedSQLiteWorkflow(original) {
  original = Buffer.from(original).toString('utf8');
  const before = '      - run: node scripts/verify-b3-preservation.mjs\n';
  if (original.split(before).length !== 2) throw new PreservationFailure('SQLITE_BASE_UNEXPECTED');
  return original.replace(before, sqliteStep);
}
const sameBytes = (a,b) => Buffer.from(a).equals(Buffer.from(b));
const hash = v => createHash('sha256').update(v).digest('hex');
const canonical = v => Array.isArray(v) ? '['+v.map(canonical).join(',')+']' : v && typeof v === 'object'
  ? '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}' : JSON.stringify(v);
const must = (v, code) => { if (!v) throw new PreservationFailure(code); };
export function collectSnapshot(root = process.cwd()) {
  const git = (...args) => execFileSync('git', ['--no-optional-locks', ...args], { cwd: root, maxBuffer: 16*1024*1024, stdio:['ignore','pipe','pipe'] });
  const names = ref => git('ls-tree','-r','--name-only','-z',ref).toString().split('\0').filter(Boolean);
  let ancestor = false;
  try { git('merge-base','--is-ancestor',B4,'HEAD'); ancestor = true; } catch { /* Absence/divergence never passes. */ }
  const historical = new Map(names(B31).map(n=>[n,git('show',`${B31}:${n}`)]));
  const base = new Map(names(B4).map(n=>[n,git('show',`${B4}:${n}`)]));
  const files = [...new Set(git('ls-files','-z').toString().split('\0').filter(Boolean)
    .concat(git('ls-files','--others','--exclude-standard','-z').toString().split('\0').filter(Boolean)))];
  const current = new Map(files.map(n=>{ must(!lstatSync(resolve(root,n)).isSymbolicLink(),'SYMLINK_REJECTED'); return [n,readFileSync(resolve(root,n))]; }));
  return { ancestor, historical, base, current };
}
export function validateSnapshot(s) {
  must(s.ancestor,'BASE_DIVERGED'); must(s.historical.size === 97 && s.base.size === 144,'HISTORICAL_INVENTORY');
  const allowed = new Set([...s.base.keys(), ...ADDED]);
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
  return { base:B4,historicalBase:B31,historicalFiles:97,byteIdentical:94,exceptions:EXCEPTIONS,
    dependencyFilesPinned:Object.keys(immutable),originalVerifierPreserved:true,activationBlocked:true,
    candidateFiles:s.current.size,allowedAdded:ADDED.length,allowedModified:MODIFIED.length };
}
if (process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try { if(process.argv.length!==2)throw new Error('UNSUPPORTED_ARGUMENTS'); console.log(JSON.stringify(validateSnapshot(collectSnapshot()),null,2)); }
  catch (e) { console.error(JSON.stringify({preservation:'FAILED',code:e instanceof PreservationFailure?e.message:'PRESERVATION_UNVERIFIED'}));process.exitCode=1; }
}
