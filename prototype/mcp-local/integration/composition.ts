import { z } from 'zod';
import { TokenKeyring } from '../../../src/b3/keyring';
import { SqliteStore } from '../../../src/vault/sqlite-store';
import { digest } from '../../../src/crypto';
import { VAULTS, requestSchema, materialSchema, context, type Account } from '../vault/model';
import { tokenCheckpoint, type TokenCheckpoint, type ReadHooks, type ReadPhase } from '../vault/read-core';
import { result } from '../src/server';
import { createVaultReadHandler, type VaultToolCall } from '../vault/server';
import { verifier } from './identity';
import { check, type GuardPin } from './guardian-adapter';
import { resolve, registry } from './registry';
import { classifyReadFailure } from './read-failure';
import { commandSchema, commandHash, current, reject, control, identities, errorCode, toolError,
  bounded, canonical, identityValue, parseMessage, type Command, type Code, type IntegrationEnv, type Principal } from './contracts';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
const reply = (code: Code, status: number) => Response.json({ error: code }, { status, headers: HEADERS });
const lookup = (c: Command) => ({ handle: c.identityHandle, commandDigest: c.commandDigest, subject: c.subject, expiresAt: c.identityExpiresAt });
const stampSchema = z.strictObject({ account: z.enum(['account-a', 'account-b']), keyId: z.string().max(32),
  rowDigest: z.string().regex(/^[\w-]{43}$/), generation: z.number().int().positive(), expiresAt: z.number().int().positive() });
const preparedSchema = z.strictObject({ command: commandSchema, stamp: stampSchema,
  pin: z.strictObject({ seq: z.number().int().nonnegative(), root: z.string().regex(/^[\w-]{43}$/), gateRevision: z.number().int().nonnegative() }) });
type Prepared = z.infer<typeof preparedSchema>;
type Active = { command: Command; pin: GuardPin; stamp?: TokenCheckpoint; failure?: Code; dependencyCause?: 'transport' | 'timeout' | 'upstream' };

export function createVaultExtension(ctx: DurableObjectState, env: IntegrationEnv) {
  const active = new Map<string, Active>(); let queued = 0;
  const store = new SqliteStore(ctx.storage);
  const keys = (account: Account) => {
    const v = VAULTS[account], m = materialSchema.parse(env.SYNTHETIC_VAULT_MATERIAL)[account];
    return new TokenKeyring(v.keyId, { [v.keyId]: m.key }, context(account));
  };
  const identity = async (c: Command) => identityValue(await identities(env).lookup(lookup(c))).principal;
  const validateStamp = async (c: Command, expected: TokenCheckpoint) => {
    const actual = await tokenCheckpoint(store, keys(c.account), c.account);
    if (canonical(actual) !== canonical(expected)) return reject('INTEGRATION_TOKEN_UNAVAILABLE');
    return actual;
  };
  async function phase(a: Active, name: ReadPhase, stamp?: TokenCheckpoint) {
    const c = a.command;
    await control(env).barrier({ phase: name, operationId: c.operationId, account: c.account, deadlineAt: c.deadlineAt });
    current(c); const p = await identity(c);
    await check(env, c, p, a.pin);
    if (stamp) { await validateStamp(c, stamp); a.stamp = stamp; }
    if (name === 'before-provider') await control(env).event({ phase: 'provider', operationId: c.operationId, account: c.account });
    current(c);
  }
  return {
    hooks(r: z.infer<typeof requestSchema>): ReadHooks | undefined {
      const a = active.get(r.nonce); if (!a) return { phase: async () => reject('INTEGRATION_BINDING_DENIED'), failed: () => {} };
      // First local cause wins. A later sanitized adapter exception must not overwrite it.
      const failed = (e: unknown) => {
        if (a.failure) return;
        const classified = classifyReadFailure(e);
        a.failure = classified.code;
        if (classified.cause) a.dependencyCause = classified.cause;
      };
      return { deadlineAt: a.command.deadlineAt, phase: async (name, stamp) => {
        try { await phase(a, name, stamp); } catch (e) { failed(e); throw e; }
      }, failed };
    },
    async execute(input: unknown, legacy: (request: z.infer<typeof requestSchema>) => Promise<unknown>) {
      let c: Command | undefined; let admitted = false; let owned = false;
      try {
        c = commandSchema.parse(input); current(c);
        if (queued >= 9) return reject('INTEGRATION_BUSY');
        queued++; admitted = true;
        const p = await identity(c); const pin = await check(env, c, p);
        const reg = await resolve(env, c.account);
        if (ctx.id.toString() !== env.INTEGRATED_VAULTS.idFromName(reg.binding.vault).toString()) return reject('INTEGRATION_BINDING_DENIED');
        if (active.has(c.nonce) || ctx.storage.sql.exec('SELECT nonce FROM isolation_nonces WHERE nonce=?', c.nonce).toArray().length) return reject('INTEGRATION_REPLAY');
        const a: Active = { command: c, pin }; active.set(c.nonce, a); owned = true;
        const legacyRequest = requestSchema.parse({ account: c.account, subject: p.subject, identityExpiresAt: p.expiresAt, nonce: c.nonce, ...c.query });
        const value = await legacy(legacyRequest) as { ok: boolean; data?: Record<string, unknown> };
        if (!value.ok || !value.data || !a.stamp) {
          if (a.dependencyCause) await control(env).event({ phase: `failure-${a.dependencyCause}`, operationId: c.operationId, account: c.account });
          return reject(a.failure ?? 'INTEGRATION_TOKEN_UNAVAILABLE');
        }
        return { ok: true, data: value.data, prepared: { command: c, pin, stamp: a.stamp } };
      } catch (e) { return { ok: false, code: errorCode(e) }; }
      finally { if (c && owned) active.delete(c.nonce); if (admitted) queued--; }
    },
    async assertPrepared(input: unknown) {
      try {
        const a = preparedSchema.parse(input); current(a.command);
        const p = await identity(a.command); await validateStamp(a.command, a.stamp);
        await check(env, a.command, p, a.pin); return { ok: true as const };
      } catch (e) { return { ok: false as const, code: errorCode(e, 'INTEGRATION_TOKEN_UNAVAILABLE') }; }
    }
  };
}

function noSecrets(env: IntegrationEnv, bytes: Uint8Array): void {
  const text = new TextDecoder().decode(bytes), m = materialSchema.parse(env.SYNTHETIC_VAULT_MATERIAL);
  if (Object.values(m).flatMap(v => [v.key, v.access, v.refresh]).some(v => text.includes(v)) || /SYNTHETIC_(?:ACCESS|REFRESH)_[AB]_/i.test(text)) reject('INTEGRATION_TOKEN_UNAVAILABLE');
}
function cloneRequest(request: Request, body: Uint8Array) {
  return new Request(request.url, { method: request.method, headers: request.headers,
    ...(request.method === 'POST' ? { body: body as Uint8Array<ArrayBuffer> } : {}), signal: request.signal });
}
async function safeError(request: Request, bytes: Uint8Array, code: Code): Promise<Response> {
  const handler = createVaultReadHandler(async () => toolError(code));
  try {
    const response = await handler.fetch(cloneRequest(request, bytes));
    const body = await bounded(response.body, 2000, request.signal);
    return new Response(body.byteLength ? body as Uint8Array<ArrayBuffer> : null, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
  } finally { await handler.close(); }
}

export async function integratedFetch(request: Request, env: IntegrationEnv): Promise<Response> {
  const url = new URL(request.url);
  if (env.SYNTHETIC_ONLY !== 'B4_MCP_LOCAL_ONLY' || env.SYNTHETIC_POLICY !== 'persistent' || !env.SYNTHETIC_JWKS) return reply('INTEGRATION_DEPENDENCY_UNAVAILABLE', 503);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || request.headers.get('Host') !== url.host || url.hash
    || (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin)) return reply('INTEGRATION_BINDING_DENIED', 403);
  // Owns only /mcp; public OAuth callback remains with the inherited, disabled composition.
  if (url.pathname !== '/mcp' || url.search) return reply('INTEGRATION_BINDING_DENIED', 404);
  if (!['POST', 'GET', 'DELETE'].includes(request.method)) return reply('INTEGRATION_BINDING_DENIED', 405);
  let principal: Principal;
  try { principal = await verifier(env).authenticate(request); } catch { return reply('INTEGRATION_IDENTITY_DENIED', 401); }
  let body = new Uint8Array(); let prepared: Prepared | undefined; let ownedHandle: string | undefined;
  let operationId = crypto.randomUUID(); let command: Command | undefined;
  try {
    if (request.method === 'POST') {
      if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return reply('INTEGRATION_BINDING_DENIED', 415);
      body = await bounded(request.body, 2000, request.signal) as Uint8Array<ArrayBuffer>;
      const parsed = parseMessage(new TextDecoder().decode(body)); if (Array.isArray(parsed)) return reply('INTEGRATION_BINDING_DENIED', 400);
    }
    const state = await control(env).snapshot(); await registry(state); const started = Date.now();
    const dispatch = async (call: VaultToolCall) => {
      try {
        if (command) return reject('INTEGRATION_REPLAY');
        const account = z.enum(['account-a', 'account-b']).parse(call.account_ref); const reg = await resolve(env, account);
        const query = call.tool === 'account' ? { operation: 'account' as const } : call.tool === 'listings'
          ? { operation: 'listings' as const, limit: call.limit, offset: call.offset } : { operation: 'listing' as const, itemId: call.item_id };
        const draft = { operationId, nonce: crypto.randomUUID(), account, subject: principal.subject, identityExpiresAt: principal.expiresAt,
          deadlineAt: started + state.deadlineMs, registryDigest: reg.snapshot.digest, bindingDigest: reg.bindingDigest, query };
        const commandDigest = await commandHash(draft);
        const issued = identityValue(await identities(env).issue({ assertion: request.headers.get('Cf-Access-Jwt-Assertion'), commandDigest }));
        if (!issued.handle) return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE'); ownedHandle = issued.handle;
        command = commandSchema.parse({ ...draft, commandDigest, identityHandle: ownedHandle });
        const pin = await check(env, command, issued.principal);
        await control(env).barrier({ phase: 'before-vault', operationId, account, deadlineAt: command.deadlineAt });
        const response = await env.INTEGRATED_VAULTS.get(env.INTEGRATED_VAULTS.idFromName(reg.binding.vault)).execute(command) as {
          ok: boolean; code?: Code; data?: Record<string, unknown>; prepared?: Prepared };
        if (!response.ok || !response.data || !response.prepared) return reject(response.code ?? 'INTEGRATION_DEPENDENCY_UNAVAILABLE');
        prepared = preparedSchema.parse(response.prepared);
        if (canonical(prepared.pin) !== canonical(pin) || prepared.command.commandDigest !== commandDigest) return reject('INTEGRATION_REVISION_CHANGED');
        return result(response.data);
      } catch (e) { return toolError(errorCode(e)); }
    };
    const handler = createVaultReadHandler(dispatch); let response: Response; let bytes: Uint8Array;
    try {
      response = await handler.fetch(cloneRequest(request, body));
      let stream = response.body;
      if (prepared && state.streamFault === 'infinite') stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode('SYNTHETIC_INCOMPLETE_DATA')); } });
      if (prepared && state.streamFault === 'broken') stream = new ReadableStream({ start(c) { c.error(new Error('INJECTED_STREAM_FAILURE')); } });
      bytes = await bounded(stream, Math.max(1, started + state.deadlineMs - Date.now()), request.signal);
    } finally { await handler.close(); }
    noSecrets(env, bytes);
    if (!prepared || !command) {
      if (ownedHandle) { await identities(env).cancel(ownedHandle); ownedHandle = undefined; }
      return new Response(bytes.byteLength ? bytes as Uint8Array<ArrayBuffer> : null, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
    }
    const wireDigest = await digest(new TextDecoder().decode(bytes));
    await control(env).barrier({ phase: 'buffered', operationId, account: command.account, deadlineAt: command.deadlineAt });
    current(command);
    const reg = await resolve(env, command.account);
    const vault = env.INTEGRATED_VAULTS.get(env.INTEGRATED_VAULTS.idFromName(reg.binding.vault));
    const confirmed = await vault.assertPrepared(prepared);
    if (!confirmed.ok) return reject(confirmed.code);
    principal = identityValue(await identities(env).lookup(lookup(command), true)).principal; ownedHandle = undefined;
    await control(env).event({ phase: 'delivery-audit', operationId, account: command.account });
    await check(env, command, principal, prepared.pin); // Last application await: after SDK/body/digest/cleanup/audit.
    current(command);
    if (prepared.stamp.expiresAt <= Date.now() + 30000 || request.signal.aborted || wireDigest.length !== 43) return reject('INTEGRATION_TOKEN_UNAVAILABLE');
    return new Response(bytes as Uint8Array<ArrayBuffer>, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
  } catch (e) {
    if (ownedHandle) { try { await identities(env).cancel(ownedHandle); } catch { /* Still deny, never release buffered bytes. */ } }
    if (command) { try { return await safeError(request, body, errorCode(e)); } catch { /* Sanitized HTTP failure if encoding is unavailable. */ } }
    return reply(errorCode(e), 503);
  }
}
