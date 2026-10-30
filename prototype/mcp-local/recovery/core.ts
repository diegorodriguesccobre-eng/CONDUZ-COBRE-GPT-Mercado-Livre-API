import { z } from 'zod';
import { digest } from '../../../src/crypto';

// Shared read contracts only. Private mutation/recovery wrappers depend on this core, never the reverse.
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

export const ENVIRONMENT = 'synthetic-r2';
export const ENROLLMENT = 'synthetic-r2-enrollment-v1';
export const accounts = ['account-a', 'account-b'] as const;
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
export const stateSchema = z.strictObject({
  environment: z.literal(ENVIRONMENT), enrollment: z.literal(ENROLLMENT), protocol: z.literal(1), seq: integer,
  operators: z.array(z.strictObject({ subject: subjectSchema, enabled: z.boolean(), revision: integer })).max(2),
  accounts: z.array(z.strictObject({ account: z.enum(accounts), partition: z.enum(accounts) })).max(2),
  anchors: z.array(z.strictObject({ account: z.enum(accounts), subject: subjectSchema, revision: integer,
    status: z.enum(['active', 'revoked']), grant: grantSchema.nullable() })).max(4)
}).superRefine((s, ctx) => {
  const unique = (values: string[]) => new Set(values).size === values.length;
  if (!unique(s.operators.map(o => o.subject)) || !unique(s.accounts.map(a => a.account)) ||
      !unique(s.anchors.map(a => `${a.account}:${a.subject}`)) || s.accounts.some(a => a.account !== a.partition)) {
    ctx.addIssue({ code: 'custom', message: 'INCONSISTENT_STATE' });
  }
  for (const a of s.anchors) {
    if (!s.accounts.some(c => c.account === a.account) || !s.operators.some(o => o.subject === a.subject) ||
      (a.status === 'revoked' ? a.grant !== null : !a.grant || a.grant.account !== a.account ||
       a.grant.subject !== a.subject || a.grant.revision !== a.revision)) ctx.addIssue({ code: 'custom', message: 'INCONSISTENT_ANCHOR' });
  }
});
export type SecurityState = z.infer<typeof stateSchema>;
// Normalize key and set ordering; snapshots do not supply their own trusted hash.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([key, val]) => JSON.stringify(key) + ':' + canonical(val)).join(',') + '}';
  return JSON.stringify(value);
}
export const fingerprint = (value: unknown) => digest(canonical(value));
export interface ReferenceHead { state: SecurityState; root: string; gate: 'ACTIVE' | 'HOLD' | 'PENDING'; gateRevision: number;
  reason: string; pending: string | null; adminCount: number }
export const headSchema = z.strictObject({ state: stateSchema, root: z.string().regex(/^[\w-]{43}$/),
  gate: z.enum(['ACTIVE', 'HOLD', 'PENDING']), gateRevision: integer, reason: z.string().max(80),
  pending: z.string().nullable(), adminCount: z.number().int().min(0).max(2) });
