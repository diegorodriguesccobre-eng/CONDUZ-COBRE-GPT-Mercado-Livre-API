import { z } from 'zod';
import { digest } from '../../../src/crypto';

// Server-owned synthetic registry. These partitions contain grants, NOT operational vaults.
export const PARTITIONS = { 'account-a': 'synthetic-partition-a', 'account-b': 'synthetic-partition-b' } as const;
// Same issuer-bound SHA-256/base64url pseudonym produced by the inherited verifier.
export const subjectSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const pairSchema = z.object({ account: z.enum(['account-a', 'account-b']), subject: subjectSchema }).strict();
export const revisionSchema = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const grantSchema = pairSchema.extend({
  permissions: z.array(z.enum(['read', 'connect'])).min(1).max(2).refine(p => new Set(p).size === p.length),
  validFrom: z.number().int().nonnegative().safe(), validUntil: z.number().int().nonnegative().safe(),
  revision: revisionSchema.positive()
}).strict().refine(g => g.validUntil > g.validFrom && g.validUntil - g.validFrom <= 86400000);
export type Grant = z.infer<typeof grantSchema>;
export type Pair = z.infer<typeof pairSchema>;
export type Anchor = Pair & { revision: number; state: 'pending' | 'active' | 'revoked'; fingerprint: string };
export const updateSchema = z.object({ grant: grantSchema, expectedRevision: revisionSchema }).strict();
export const revokeSchema = pairSchema.extend({ expectedRevision: revisionSchema }).strict();
export async function fingerprint(grant: Grant): Promise<string> {
  return digest(JSON.stringify([grant.account, grant.subject, [...grant.permissions].sort(),
    grant.validFrom, grant.validUntil, grant.revision]));
}
