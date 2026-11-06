import { z } from 'zod';
import { grantSchema, subjectSchema, ENVIRONMENT, ENROLLMENT, accounts, stateSchema, type SecurityState, type ReferenceHead } from './core';
// Compatibility surface for historical private consumers. The public reader imports ./core directly.
export { ENVIRONMENT, ENROLLMENT, accounts, stateSchema, canonical, fingerprint, headSchema } from './core';
export type { SecurityState, ReferenceHead } from './core';
const integer = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER - 1);
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
