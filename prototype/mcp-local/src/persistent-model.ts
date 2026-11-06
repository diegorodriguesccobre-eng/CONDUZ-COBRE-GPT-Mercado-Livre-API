import { z } from 'zod';
import { digest } from '../../../src/crypto';
import { pairSchema, revisionSchema, grantSchema, type Grant } from '../recovery/core';
export { subjectSchema, pairSchema, revisionSchema, grantSchema } from '../recovery/core';
export type { Grant, Pair, Anchor } from '../recovery/core';

// Server-owned synthetic registry. These partitions contain grants, NOT operational vaults.
export const PARTITIONS = { 'account-a': 'synthetic-partition-a', 'account-b': 'synthetic-partition-b' } as const;
export const updateSchema = z.object({ grant: grantSchema, expectedRevision: revisionSchema }).strict();
export const revokeSchema = pairSchema.extend({ expectedRevision: revisionSchema }).strict();
export async function fingerprint(grant: Grant): Promise<string> {
  return digest(JSON.stringify([grant.account, grant.subject, [...grant.permissions].sort(),
    grant.validFrom, grant.validUntil, grant.revision]));
}
