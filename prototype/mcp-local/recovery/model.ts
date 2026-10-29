import { z } from 'zod';
import { grantSchema, subjectSchema } from '../src/persistent-model';
import { digest } from '../../../src/crypto';
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
export class RecoveryError extends Error { constructor(public readonly code: string) { super(code); } }
export const fail = (code: string): never => { throw new RecoveryError(code); };
export const identitySchema = z.strictObject({ environment: z.literal(ENVIRONMENT), enrollment: z.literal(ENROLLMENT),
  protocol: z.literal(1), lastSeq: integer, root: z.string(), mode: z.enum(['VERIFYING', 'READY', 'UNAVAILABLE', 'RECOVERY_REQUIRED']) });
export const requestSchema = z.strictObject({ account: z.enum(accounts), subject: subjectSchema,
  required: z.enum(['read', 'connect']), nonce: z.string().uuid(), environment: z.literal(ENVIRONMENT),
  enrollment: z.literal(ENROLLMENT), protocol: z.literal(1) });
export const mutationSchema = z.strictObject({ operationId: z.string().uuid(), expectedSeq: integer,
  expectedRevision: integer, kind: z.enum(['grant', 'revoke', 'operator']), account: z.enum(accounts),
  subject: subjectSchema, grant: grantSchema.optional(), enabled: z.boolean().optional(), actor: z.literal('sim-security') });
export type Mutation = z.infer<typeof mutationSchema>;
export const recoveryPlanSchema = z.strictObject({ operationId: z.string().uuid(), nonce: z.string().uuid(),
  expectedSeq: integer, expectedGate: integer, root: z.string(), environment: z.literal(ENVIRONMENT),
  enrollment: z.literal(ENROLLMENT), approvals: z.array(z.strictObject({ person: z.enum(['sim-proposer', 'sim-reviewer']),
    role: z.enum(['proposer', 'reviewer']), simulatedMfa: z.literal(true), at: integer })).length(2) });
export type RecoveryPlan = z.infer<typeof recoveryPlanSchema>;
export interface ReferenceHead { state: SecurityState; root: string; gate: 'ACTIVE' | 'HOLD' | 'PENDING'; gateRevision: number;
  reason: string; pending: string | null; adminCount: number }
export const headSchema = z.strictObject({ state: stateSchema, root: z.string().regex(/^[\w-]{43}$/),
  gate: z.enum(['ACTIVE', 'HOLD', 'PENDING']), gateRevision: integer, reason: z.string().max(80),
  pending: z.string().nullable(), adminCount: z.number().int().min(0).max(2) });
export function nextState(head: ReferenceHead, input: Mutation): SecurityState {
  if (head.state.seq !== input.expectedSeq) fail('REVISION_CONFLICT');
  if (input.expectedSeq >= Number.MAX_SAFE_INTEGER - 1) fail('COUNTER_EXHAUSTED');
  const s = structuredClone(head.state); const op = s.operators.find(o => o.subject === input.subject);
  if (!op || !s.accounts.some(a => a.account === input.account)) fail('UNREGISTERED_PAIR');
  const anchor = s.anchors.find(a => a.account === input.account && a.subject === input.subject);
  if (input.kind === 'operator') {
    if (input.enabled === undefined || input.grant !== undefined || op!.revision !== input.expectedRevision) fail('INVALID_MUTATION');
    op!.enabled = input.enabled!; op!.revision++;
  } else {
    if ((anchor?.revision ?? 0) !== input.expectedRevision) fail('REVISION_CONFLICT');
    if (input.expectedRevision >= Number.MAX_SAFE_INTEGER - 1) fail('COUNTER_EXHAUSTED');
    if (input.enabled !== undefined) fail('INVALID_MUTATION');
    if (input.kind === 'grant') {
      if (anchor?.status === 'revoked') fail('TERMINAL_REVOCATION');
      if (!op!.enabled || !input.grant || input.grant.subject !== input.subject || input.grant.account !== input.account ||
          input.grant.revision !== input.expectedRevision + 1) fail('INVALID_MUTATION');
    } else if (input.grant !== undefined) fail('INVALID_MUTATION');
    const next = { account: input.account, subject: input.subject, revision: input.expectedRevision + 1,
      status: input.kind === 'revoke' ? 'revoked' as const : 'active' as const, grant: input.kind === 'revoke' ? null : input.grant! };
    if (anchor) Object.assign(anchor, next); else s.anchors.push(next);
  }
  s.seq++; return stateSchema.parse(s);
}
