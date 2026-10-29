import { createPublicKey, verify } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// This verifies registry ECDSA signatures and lockfile integrity, NOT Sigstore provenance.
export function verifyRegistrySignature(manifest, lockIntegrity, keys, publishedAt) {
  if (!manifest?.name || !manifest?.version || !manifest.dist?.integrity || manifest.dist.integrity !== lockIntegrity) {
    throw new Error('INTEGRITY_MISMATCH');
  }
  const signatures = manifest.dist.signatures;
  if (!Array.isArray(signatures) || signatures.length === 0) return 'unsigned';
  const message = Buffer.from(`${manifest.name}@${manifest.version}:${manifest.dist.integrity}`);
  for (const signature of signatures) {
    const key = keys.find(key => key.keyid === signature.keyid);
    if (!key) continue;
    // Same validity rule as npm/pacote: evaluate key expiry at package publication, not today.
    if (key.expires && (!Number.isFinite(Date.parse(key.expires)) || !publishedAt || !Number.isFinite(Date.parse(publishedAt))
      || Date.parse(publishedAt) >= Date.parse(key.expires))) continue;
    try {
      const publicKey = createPublicKey({ key: Buffer.from(key.key, 'base64'), format: 'der', type: 'spki' });
      if (verify('sha256', message, publicKey, Buffer.from(signature.sig, 'base64'))) return 'verified';
    } catch { /* Try another advertised, trusted key; never accept an invalid signature. */ }
  }
  throw new Error('SIGNATURE_INVALID_OR_KEY_UNAVAILABLE');
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15000), redirect: 'error' });
  if (!response.ok) throw new Error(`REGISTRY_HTTP_${response.status}`);
  return response.json();
}
async function main() {
  const lock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
  const { keys } = await json('https://registry.npmjs.org/-/npm/v1/keys');
  if (!Array.isArray(keys) || !keys.length) throw new Error('REGISTRY_KEYS_UNAVAILABLE');
  const results = []; const pending = Object.entries(lock.packages).filter(([path]) => path.startsWith('node_modules/'));
  let index = 0;
  async function worker() {
    while (index < pending.length) {
      const [path, entry] = pending[index++];
      if (!existsSync(resolve(path, 'package.json'))) { results.push({ path, status: 'not-installed-platform-optional' }); continue; }
      const installed = JSON.parse(readFileSync(resolve(path, 'package.json'), 'utf8'));
      try {
        if (!entry.resolved?.startsWith('https://registry.npmjs.org/')) throw new Error('NON_REGISTRY_DEPENDENCY');
        const manifest = await json(`https://registry.npmjs.org/${encodeURIComponent(installed.name)}/${encodeURIComponent(installed.version)}`);
        if (manifest.name !== installed.name || manifest.version !== installed.version) throw new Error('MANIFEST_MISMATCH');
        let publishedAt;
        if (manifest.dist?.signatures?.some(sig => keys.find(key => key.keyid === sig.keyid)?.expires)) {
          const packument = await json(`https://registry.npmjs.org/${encodeURIComponent(installed.name)}`);
          publishedAt = packument.time?.[installed.version];
        }
        results.push({ package: `${installed.name}@${installed.version}`, status: verifyRegistrySignature(manifest, entry.integrity, keys, publishedAt) });
      } catch (error) { results.push({ package: `${installed.name}@${installed.version}`, status: 'failed', reason: error.message }); }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  const counts = {};
  for (const result of results) counts[result.status] = (counts[result.status] ?? 0) + 1;
  const complete = !counts.failed && !counts.unsigned;
  const report = { registrySignatures: counts, allInstalledVerified: complete,
    sigstoreProvenance: 'NOT_VERIFIED_BY_THIS_SCRIPT', results };
  writeFileSync('/tmp/conduz-b1-registry-signatures.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ ...report, results: undefined }, null, 2));
  if (!complete) process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(`Registry signature audit failed: ${error.message}`); process.exitCode = 1; });
}
