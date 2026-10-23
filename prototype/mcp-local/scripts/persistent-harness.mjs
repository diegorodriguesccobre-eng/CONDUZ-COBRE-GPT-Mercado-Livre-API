import { Miniflare } from 'miniflare';
import { createHash } from 'node:crypto';
import { startLocal } from './local-harness.mjs';

export const subjects = ['a', 'b'].map(suffix => createHash('sha256')
  .update(`https://synthetic-mcp-team.cloudflareaccess.com\0synthetic-operator-${suffix}`).digest('base64url'));
const partitionNames = { 'account-a': 'synthetic-partition-a', 'account-b': 'synthetic-partition-b' };
const managementErrors = new Set(['REVISION_CONFLICT', 'GRANT_FENCED', 'PARTITION_MISMATCH',
  'UNREGISTERED_PAIR', 'PROJECTION_CONFLICT', 'SYNTHETIC_PROJECTION_UNAVAILABLE', 'INVALID_INPUT',
  'SYNTHETIC_AFTER_DURABLE_revoked', 'SYNTHETIC_AFTER_DURABLE_grant-pending']);
export async function managementValue(operation) {
  const result = await operation; // Transport/runtime failures propagate unchanged.
  if (result?.ok === true && Object.keys(result).every(key => ['ok', 'value'].includes(key))) return result.value;
  if (result?.ok === false && Object.keys(result).sort().join(',') === 'code,ok' && managementErrors.has(result.code)) {
    const error = new Error(result.code); error.name = 'SyntheticManagementError'; throw error;
  }
  throw new Error('INVALID_LOCAL_MANAGEMENT_ENVELOPE');
}
export function grantFor(suffix = 'a', overrides = {}) {
  return { account: `account-${suffix}`, subject: subjects[suffix === 'a' ? 0 : 1], permissions: ['read'],
    validFrom: Date.now() - 1000, validUntil: Date.now() + 3600000, revision: 1, ...overrides };
}

// Privileged local driver. No administration URL, MCP tool, bearer credential or deploy configuration.
export async function startPersistent({ path, keyPair, omitAuthority = false } = {}) {
  if (!path) throw new Error('EXPLICIT_LOCAL_STORAGE_PATH_REQUIRED');
  let mf;
  const local = await startLocal({}, {
    ...(keyPair ? { createKeyPair: async () => keyPair } : {}),
    configureRuntime: options => ({ ...options, scriptPath: 'work/persistent-worker.mjs',
      bindings: { ...options.bindings, SYNTHETIC_POLICY: 'persistent' }, resourcePersistencePath: path,
      durableObjects: {
        ...(omitAuthority ? {} : { GRANT_AUTHORITY: { className: 'GrantAuthority', useSQLite: true, unsafeUniqueKey: 'synthetic-security-authority' } }),
        GRANT_PARTITIONS: { className: 'GrantPartition', useSQLite: true, unsafeUniqueKey: 'synthetic-grant-partitions' }
      } }),
    createRuntime: options => { mf = new Miniflare(options); return mf; }
  });
  try {
    const authorityNamespace = omitAuthority ? null : await mf.getDurableObjectNamespace('GRANT_AUTHORITY');
    const partitions = await mf.getDurableObjectNamespace('GRANT_PARTITIONS');
    const rawAuthority = authorityNamespace?.get(authorityNamespace.idFromName('synthetic-security-authority'));
    const authority = rawAuthority ? {
      initializeSyntheticRegistry: () => rawAuthority.initializeSyntheticRegistry(),
      permissions: input => rawAuthority.permissions(input), inspect: input => rawAuthority.inspect(input),
      audit: () => rawAuthority.audit(), setFault: value => rawAuthority.setFault(value), release: () => rawAuthority.release(),
      update: input => managementValue(rawAuthority.localAdmin('update', input)),
      revoke: input => managementValue(rawAuthority.localAdmin('revoke', input)),
      setOperator: input => managementValue(rawAuthority.localAdmin('setOperator', input))
    } : undefined;
    const partition = account => {
      const name = partitionNames[account]; if (!name) throw new Error('UNKNOWN_INTERNAL_ACCOUNT');
      const stub = partitions.get(partitions.idFromName(name));
      return { read: input => stub.read(input), put: input => managementValue(stub.localPut(input)),
        setFault: value => stub.setFault(value), restoreProjection: input => stub.restoreProjection(input),
        removeProjection: subject => stub.removeProjection(subject) };
    };
    async function provision() {
      if (!authority) throw new Error('AUTHORITY_REQUIRED');
      await authority.initializeSyntheticRegistry();
      for (const suffix of ['a', 'b']) await authority.update({ grant: grantFor(suffix), expectedRevision: 0 });
    }
    return { ...local, authority, partition, provision };
  } catch (error) {
    try { await local.close(); } catch (cleanup) { throw new AggregateError([error, cleanup], 'PERSISTENT_START_AND_CLEANUP_FAILED'); }
    throw error;
  }
}
