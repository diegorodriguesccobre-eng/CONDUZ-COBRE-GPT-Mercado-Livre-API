import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { request as httpRequest } from 'node:http';

const ISSUER = 'https://synthetic-mcp-team.cloudflareaccess.com';
const AUDIENCE = 'synthetic-mcp-local';
const IO_TIMEOUT = 5000;
async function deadline(operation, milliseconds, label, abort = () => {}) {
  let timer;
  try {
    return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => { abort(); reject(new Error(label)); }, milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
function once(operation) {
  let promise;
  return () => promise ??= Promise.resolve().then(operation);
}
async function settleCleanups(operations) {
  const settled = await Promise.allSettled(operations.map(operation =>
    deadline(Promise.resolve().then(operation), IO_TIMEOUT, 'LOCAL_CLEANUP_TIMEOUT')));
  throwCleanupErrors(settled);
}
function throwCleanupErrors(settled) {
  const errors = settled.filter(result => result.status === 'rejected').map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, 'LOCAL_CLEANUP_FAILED');
}
export async function usingLocal(local, operation) {
  let failed = false; let failure;
  try { return await operation(local); }
  catch (error) { failed = true; failure = error; throw error; }
  finally {
    try { await local.close(); }
    catch (error) {
      if (failed) throw new AggregateError([failure, error], 'LOCAL_OPERATION_AND_CLEANUP_FAILED');
      throw error;
    }
  }
}

// Factories/hooks are local test seams, never Worker bindings, flags or routes.
export async function startLocal({ enabled = true } = {}, {
  createRuntime = options => new Miniflare(options),
  createClient = (info, options) => new Client(info, options),
  fetch: fetchImpl = globalThis.fetch,
  afterReady = async () => {},
  createKeyPair = () => generateKeyPair('RS256'),
  configureRuntime = options => options
} = {}) {
  const pair = await createKeyPair();
  const jwks = { keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral' }] };
  let outboundAttempts = 0; let closed = false;
  const wire = []; const clients = new Set(); const requests = new Set();
  const fetches = new Set(); const responses = new Set(); const shutdown = new AbortController();
  const options = convertV4MiniflareOptions(configureRuntime({
    modules: true, scriptPath: 'work/worker.mjs', host: '127.0.0.1', port: 0,
    inspectorHost: '127.0.0.1', inspectorPort: 0, compatibilityDate: '2026-10-01', cf: false,
    bindings: { SYNTHETIC_ONLY: enabled ? 'B4_MCP_LOCAL_ONLY' : 'DISABLED', SYNTHETIC_JWKS: jwks },
    outboundService: () => { outboundAttempts++; return new Response('SYNTHETIC_EGRESS_DENIED', { status: 503 }); }
  }));
  const mf = createRuntime({ ...options, telemetry: { enabled: false }, log: new Log(LogLevel.NONE) });
  const dispose = once(() => mf.dispose());
  const ensureOpen = () => { if (closed) throw new Error('LOCAL_HARNESS_CLOSED'); };
  const closeOnce = once(async () => {
    for (const request of requests) request.destroy(new Error('LOCAL_HARNESS_CLOSED'));
    // Disposal starts even if closing a client fails or stalls.
    try {
      const operations = [dispose,
        ...[...fetches].map(promise => async () => { await promise.catch(() => {}); }),
        ...[...responses].filter(response => response.body && !response.body.locked)
          .map(response => async () => { try { await response.body.cancel(); } catch { /* Shutdown already aborts bodies. */ } })
      ];
      // Client records already have a bounded cleanup and must finish their own finally.
      // A second, equal outer deadline could race their deregistration.
      throwCleanupErrors(await Promise.allSettled([
        ...[...clients].map(record => record.close()),
        ...operations.map(operation => deadline(Promise.resolve().then(operation), IO_TIMEOUT, 'LOCAL_CLEANUP_TIMEOUT'))
      ]));
    } finally { responses.clear(); }
  });
  function close() { closed = true; shutdown.abort(); return closeOnce(); }
  let base;
  try {
    base = await deadline(Promise.resolve(mf.ready), 10000, 'LOCAL_START_TIMEOUT');
    if (base.hostname !== '127.0.0.1') throw new Error('LOCAL_BIND_REQUIRED');
    await deadline(Promise.resolve().then(() => afterReady(base)), IO_TIMEOUT, 'LOCAL_READY_HOOK_TIMEOUT');
  } catch (failure) {
    try { await close(); }
    catch (cleanup) { throw new AggregateError([failure, cleanup], 'LOCAL_START_AND_CLEANUP_FAILED'); }
    throw failure;
  }
  const url = new URL('/mcp', base);
  function targetFor(input, onlyMcp = false) {
    const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, base);
    if (target.origin !== url.origin || target.username || target.password || (onlyMcp && target.pathname !== '/mcp')) {
      throw new Error('CLIENT_EGRESS_DENIED');
    }
    return target;
  }
  async function assertion(subject = 'synthetic-operator-a', claims = {}) {
    ensureOpen();
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: subject, iat: now - 1, exp: now + 300, type: 'app', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-ephemeral' }).sign(pair.privateKey);
  }
  async function trackedFetch(input, init = {}, connectionSignal) {
    ensureOpen(); targetFor(input);
    const controller = new AbortController();
    const signals = [shutdown.signal, controller.signal, connectionSignal, init.signal,
      input instanceof Request ? input.signal : undefined].filter(Boolean);
    const headers = new Headers(init.headers);
    headers.set('Connection', 'close');
    const operation = Promise.resolve().then(() => { ensureOpen(); return fetchImpl(input, {
      ...init, headers, redirect: 'error', signal: AbortSignal.any(signals)
    }); });
    fetches.add(operation);
    try {
      const response = await deadline(operation, IO_TIMEOUT, 'LOCAL_FETCH_TIMEOUT', () => controller.abort());
      responses.add(response);
      return response;
    } finally { fetches.delete(operation); }
  }
  async function connect(subject = 'synthetic-operator-a', mode = { pin: '2026-07-28' }) {
    ensureOpen();
    const token = await assertion(subject);
    ensureOpen();
    const client = createClient({ name: 'independent-conduz-cobre-client', version: '0.0.1' }, { versionNegotiation: { mode } });
    const controller = new AbortController();
    let transport;
    const originalClose = client.close.bind(client);
    const record = {};
    record.close = once(async () => {
      controller.abort();
      try { await settleCleanups([originalClose, async () => { await transport?.close(); }]); }
      finally { clients.delete(record); }
    });
    clients.add(record);
    client.close = record.close;
    try {
      transport = new StreamableHTTPClientTransport(url, {
        requestInit: { headers: { 'Cf-Access-Jwt-Assertion': token } },
        fetch: async (input, init) => {
          targetFor(input, true);
          let rpcMethod = null; let protocol = new Headers(init?.headers).get('mcp-protocol-version');
          if (typeof init?.body === 'string') {
            try { const body = JSON.parse(init.body); rpcMethod = body.method; protocol = body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? body.params?.protocolVersion ?? protocol; } catch {}
          }
          const response = await trackedFetch(input, init, controller.signal);
          wire.push({ method: init?.method ?? 'GET', rpc_method: rpcMethod, protocol, status: response.status,
            content_type: response.headers.get('content-type'), account_operator: subject });
          return response;
        }
      });
      transport.close = once(transport.close.bind(transport));
      await deadline(client.connect(transport, { signal: controller.signal, timeout: IO_TIMEOUT }), IO_TIMEOUT,
        'LOCAL_CONNECT_TIMEOUT', () => controller.abort());
      ensureOpen();
      return client;
    } catch (failure) {
      try { await record.close(); }
      catch (cleanup) { throw new AggregateError([failure, cleanup], 'LOCAL_CONNECT_AND_CLEANUP_FAILED'); }
      throw failure;
    }
  }
  async function raw({ subject = 'synthetic-operator-a', token, headers = {}, method = 'POST', body, path = '/mcp' } = {}) {
    const target = targetFor(path);
    return trackedFetch(target, { method, headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Cf-Access-Jwt-Assertion': token ?? await assertion(subject), ...headers
    }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  }
  async function rawHttp({ headers = {}, incomplete = false } = {}) {
    ensureOpen(); const token = await assertion(); ensureOpen();
    let request;
    try {
      return await new Promise((resolve, reject) => {
        request = httpRequest(url, { method: 'POST', agent: false, headers: {
          'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
          'Cf-Access-Jwt-Assertion': token, ...headers,
          ...(incomplete ? { 'Transfer-Encoding': 'chunked' } : { 'Content-Length': '2' })
        } }, response => {
          response.resume(); response.once('error', reject);
          response.once('end', () => resolve(response.statusCode));
        });
        requests.add(request);
        request.once('error', reject);
        request.setTimeout(IO_TIMEOUT, () => request.destroy(new Error('LOCAL_HTTP_TIMEOUT')));
        if (incomplete) request.write('{'); else request.end('{}');
      });
    } finally {
      if (request) { request.setTimeout(0); request.destroy(); requests.delete(request); }
    }
  }
  return { url, jwks, assertion, connect, raw, rawHttp, wire, outboundAttempts: () => outboundAttempts, close,
    resources: () => ({ closed, clients: clients.size, requests: requests.size, fetches: fetches.size }) };
}

export function dataOf(result) {
  if (result.structuredContent) return result.structuredContent;
  const block = result.content?.find(value => value.type === 'text');
  return block ? JSON.parse(block.text) : undefined;
}
