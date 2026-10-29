import { z } from 'zod';
import type { JSONWebKeySet } from 'jose';
import { digest } from '../../../src/crypto';
import type { VaultEnv } from '../vault/storage';
import type { IntegrationIdentity } from './identity';
import type { IntegratedVault, IntegrationControl } from '../tests/fixtures/integrated-worker';
import type { RecoveryReference } from '../recovery/storage';
import { accountSchema } from '../vault/model';

export const SCOPE = Object.freeze({ tenant: 'conduz_cobre', environment: 'synthetic-r2',
  enrollment: 'synthetic-r2-enrollment-v1', contract: 'b4-integration-v1', profile: 'synthetic' } as const);
export const uuid = z.string().uuid();
export const hash = z.string().regex(/^[\w-]{43}$/);
const time = z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1);
export const querySchema = z.discriminatedUnion('operation', [
  z.strictObject({ operation: z.literal('account') }),
  z.strictObject({ operation: z.literal('listings'), limit: z.number().int().min(1).max(20), offset: z.number().int().min(0).max(1) }),
  z.strictObject({ operation: z.literal('listing'), itemId: z.string().regex(/^MLB_SYNTH_[AB]_00[12]$/) })
]);
export const commandSchema = z.strictObject({ operationId: uuid, nonce: uuid, account: accountSchema,
  subject: hash, identityExpiresAt: time, deadlineAt: time, registryDigest: hash, bindingDigest: hash,
  query: querySchema, commandDigest: hash, identityHandle: uuid });
export type Command = z.infer<typeof commandSchema>;
export type Principal = Readonly<{ subject: string; expiresAt: number; role: 'administrator' | 'viewer' }>;
export type Code = 'INTEGRATION_READ_DENIED' | 'INTEGRATION_IDENTITY_DENIED' | 'INTEGRATION_DEPENDENCY_UNAVAILABLE'
  | 'INTEGRATION_RECOVERY_REQUIRED' | 'INTEGRATION_REVISION_CHANGED' | 'INTEGRATION_BINDING_DENIED'
  | 'INTEGRATION_TOKEN_UNAVAILABLE' | 'INTEGRATION_REPLAY' | 'INTEGRATION_BUSY';
export class IntegrationFailure extends Error {
  constructor(readonly code: Code) { super(code); }
}
export const reject = (code: Code): never => { throw new IntegrationFailure(code); };
// Hash named fields, preserving array order. No untrusted hash or profile is accepted.
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}';
  return JSON.stringify(value);
}
export async function commandHash(c: Omit<Command, 'commandDigest' | 'identityHandle'>): Promise<string> {
  return digest(canonical({ scope: SCOPE, operationId: c.operationId, nonce: c.nonce, account: c.account,
    subject: c.subject, identityExpiresAt: c.identityExpiresAt, deadlineAt: c.deadlineAt,
    registryDigest: c.registryDigest, bindingDigest: c.bindingDigest, query: c.query }));
}
export function current(c: Command, now = Date.now()): void {
  if (c.identityExpiresAt <= now) reject('INTEGRATION_IDENTITY_DENIED');
  if (c.deadlineAt <= now) reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
}
export interface ControlState { revision: number; registryFault: string; pauseAt: string; deadlineMs: number; streamFault: string }
export interface IntegrationEnv extends VaultEnv {
  SYNTHETIC_JWKS: JSONWebKeySet;
  INTEGRATED_VAULTS: DurableObjectNamespace<IntegratedVault>;
  INTEGRATION_IDENTITY: DurableObjectNamespace<IntegrationIdentity>;
  INTEGRATION_CONTROL: DurableObjectNamespace<IntegrationControl>;
  RECOVERY_REFERENCE: DurableObjectNamespace<RecoveryReference>;
}
const principalSchema = z.strictObject({ subject: hash, expiresAt: time, role: z.enum(['administrator', 'viewer']) });
const codes = z.enum(['INTEGRATION_READ_DENIED', 'INTEGRATION_IDENTITY_DENIED', 'INTEGRATION_DEPENDENCY_UNAVAILABLE',
  'INTEGRATION_RECOVERY_REQUIRED', 'INTEGRATION_REVISION_CHANGED', 'INTEGRATION_BINDING_DENIED',
  'INTEGRATION_TOKEN_UNAVAILABLE', 'INTEGRATION_REPLAY', 'INTEGRATION_BUSY']);
export function identityValue(input: unknown): { principal: Principal; handle?: string | undefined } {
  const value = z.discriminatedUnion('ok', [
    z.strictObject({ ok: z.literal(true), principal: principalSchema, handle: uuid.optional() }),
    z.strictObject({ ok: z.literal(false), code: codes })
  ]).parse(input);
  if (!value.ok) return reject(value.code);
  return value;
}
// Validate JSON syntax first, then reject duplicate (including escaped) keys in each object.
// A depth bound avoids adversarial recursion; ordinary SDK schemas still validate the message.
export function parseMessage(text: string): unknown {
  const value: unknown = JSON.parse(text); let at = 0;
  const space = () => { while (/\s/.test(text[at] ?? '') && at < text.length) at++; };
  const string = () => {
    const start = at++; for (;;) { const c = text[at++]; if (c === '\\') { at++; continue; }
      if (c === '"') return JSON.parse(text.slice(start, at)) as string; }
  };
  const scan = (depth: number): void => {
    if (depth > 32) return reject('INTEGRATION_BINDING_DENIED'); space();
    if (text[at] === '{') {
      at++; space(); const keys = new Set<string>(); if (text[at] === '}') { at++; return; }
      for (;;) { space(); const key = string(); if (keys.has(key)) return reject('INTEGRATION_BINDING_DENIED'); keys.add(key);
        space(); at++; scan(depth + 1); space(); if (text[at++] === '}') return; }
    }
    if (text[at] === '[') {
      at++; space(); if (text[at] === ']') { at++; return; }
      for (;;) { scan(depth + 1); space(); if (text[at++] === ']') return; }
    }
    if (text[at] === '"') { string(); return; }
    while (at < text.length && !/[\s,}\]]/.test(text[at]!)) at++;
  };
  scan(0); return value;
}
export const control = (env: IntegrationEnv) => env.INTEGRATION_CONTROL.get(env.INTEGRATION_CONTROL.idFromName('local-integration-control'));
export const identities = (env: IntegrationEnv) => env.INTEGRATION_IDENTITY.get(env.INTEGRATION_IDENTITY.idFromName('local-identity-authority'));
export const errorCode = (error: unknown, fallback: Code = 'INTEGRATION_DEPENDENCY_UNAVAILABLE'): Code =>
  error instanceof IntegrationFailure ? error.code : fallback;
export const toolError = (code: Code) => ({ isError: true as const, content: [{ type: 'text' as const, text: code }] });

export async function bounded(body: ReadableStream<Uint8Array> | null, milliseconds: number, signal?: AbortSignal): Promise<Uint8Array> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  try {
    return await Promise.race([
      (async () => {
        for (;;) { const r = await reader.read(); if (r.done) break; length += r.value.byteLength;
          if (length > 16384) reject('INTEGRATION_DEPENDENCY_UNAVAILABLE'); chunks.push(r.value); }
        const result = new Uint8Array(length); let p = 0; for (const c of chunks) { result.set(c, p); p += c.byteLength; } return result;
      })(),
      new Promise<never>((_, fail) => { timer = setTimeout(() => fail(new IntegrationFailure('INTEGRATION_DEPENDENCY_UNAVAILABLE')), Math.max(1, milliseconds)); }),
      new Promise<never>((_, fail) => { onAbort = () => fail(new IntegrationFailure('INTEGRATION_DEPENDENCY_UNAVAILABLE'));
        if (signal?.aborted) onAbort(); else signal?.addEventListener('abort', onAbort, { once: true }); })
    ]);
  } finally { if (timer) clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); void reader.cancel().catch(() => {}); }
}
