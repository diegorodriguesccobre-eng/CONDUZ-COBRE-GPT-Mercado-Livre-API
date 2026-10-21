import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
const base = 'f59081e223006f3eb0739d01073ed2eba824687e';
const git = (...args) => execFileSync('git', args, { maxBuffer: 8 * 1024 * 1024 });
const files = git('ls-tree', '-r', '--name-only', '-z', base).toString().split('\0').filter(Boolean);
const hash = value => createHash('sha256').update(value).digest('hex');
const modified = files.filter(file => {
  try { return hash(readFileSync(file)) !== hash(git('show', `${base}:${file}`)); }
  catch { return true; }
});
const production = readFileSync('wrangler.production.jsonc', 'utf8');
const preparation = readFileSync('src/preparation/config.ts', 'utf8');
const b3 = readFileSync('src/b3/entrypoint.ts', 'utf8');
const readiness = JSON.parse(readFileSync('config/b3-readiness.json', 'utf8'));
const checks = {
  allBaseFilesByteIdentical: modified.length === 0,
  b2EntryPreserved: production.includes('src/preparation/entrypoint.ts'),
  b1LocksPreserved: preparation.includes('LIVE_TRANSPORT_ENABLED = false') && preparation.includes('PRODUCTION_OAUTH_ENABLED = false'),
  b3EntryInert: b3.includes('status: 503') && b3.includes('PRODUCTION_DISABLED') && !b3.includes('localB3Router'),
  noReadinessToActivate: ['liveTransportEnabled', 'productionOAuthEnabled', 'officialMercadoLivreContractsValidated',
    'accessPolicyConfigured', 'identityProviderMfaVerified', 'sellerIdentityValidatedLive', 'realCredentialsConfigured', 'deploymentAuthorized']
    .every(name => readiness[name] === false)
};
console.log(JSON.stringify({ base, baseFilesCompared: files.length, checks, modified }, null, 2));
if (Object.values(checks).some(value => !value)) process.exitCode = 1;
