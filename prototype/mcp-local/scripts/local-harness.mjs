import { Miniflare, convertV4MiniflareOptions, Log, LogLevel } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';

const ISSUER = 'https://synthetic-mcp-team.cloudflareaccess.com';
const AUDIENCE = 'synthetic-mcp-local';
export async function startLocal({ enabled = true } = {}) {
  const pair = await generateKeyPair('RS256');
  const jwks = { keys: [{ ...await exportJWK(pair.publicKey), alg: 'RS256', use: 'sig', kid: 'synthetic-ephemeral' }] };
  let outboundAttempts = 0;
  const wire = [];
  const options = convertV4MiniflareOptions({
    modules: true, scriptPath: 'work/worker.mjs', host: '127.0.0.1', port: 0,
    inspectorHost: '127.0.0.1', inspectorPort: 0, compatibilityDate: '2026-10-01', cf: false,
    bindings: { SYNTHETIC_ONLY: enabled ? 'B4_MCP_LOCAL_ONLY' : 'DISABLED', SYNTHETIC_JWKS: jwks },
    outboundService: () => { outboundAttempts++; return new Response('SYNTHETIC_EGRESS_DENIED', { status: 503 }); }
  });
  const mf = new Miniflare({ ...options, telemetry: { enabled: false }, log: new Log(LogLevel.NONE) });
  const base = await mf.ready;
  if (base.hostname !== '127.0.0.1') { await mf.dispose(); throw new Error('LOCAL_BIND_REQUIRED'); }
  const url = new URL('/mcp', base);
  async function assertion(subject = 'synthetic-operator-a', claims = {}) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({ iss: ISSUER, aud: AUDIENCE, sub: subject, iat: now - 1, exp: now + 300, type: 'app', ...claims })
      .setProtectedHeader({ alg: 'RS256', kid: 'synthetic-ephemeral' }).sign(pair.privateKey);
  }
  async function connect(subject = 'synthetic-operator-a', mode = { pin: '2026-07-28' }) {
    const token = await assertion(subject);
    const client = new Client({ name: 'independent-conduz-cobre-client', version: '0.0.1' }, { versionNegotiation: { mode } });
    const transport = new StreamableHTTPClientTransport(url, {
      requestInit: { headers: { 'Cf-Access-Jwt-Assertion': token } },
      fetch: async (input, init) => {
        const target = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
        if (target.origin !== url.origin || target.pathname !== '/mcp') throw new Error('CLIENT_EGRESS_DENIED');
        let rpcMethod = null; let protocol = new Headers(init?.headers).get('mcp-protocol-version');
        if (typeof init?.body === 'string') {
          try { const body = JSON.parse(init.body); rpcMethod = body.method; protocol = body.params?._meta?.['io.modelcontextprotocol/protocolVersion'] ?? body.params?.protocolVersion ?? protocol; } catch {}
        }
        const response = await fetch(input, { ...init, redirect: 'error' });
        // No request headers, JWT, private key, tool arguments or returned data are retained here.
        wire.push({ method: init?.method ?? 'GET', rpc_method: rpcMethod, protocol, status: response.status,
          content_type: response.headers.get('content-type'), account_operator: subject });
        return response;
      }
    });
    try { await client.connect(transport); } catch (error) { await client.close(); throw error; }
    return client;
  }
  async function raw({ subject = 'synthetic-operator-a', token, headers = {}, method = 'POST', body, path = '/mcp' } = {}) {
    return fetch(new URL(path, base), { method, redirect: 'error', headers: {
      'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
      'Cf-Access-Jwt-Assertion': token ?? await assertion(subject), ...headers
    }, ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }) });
  }
  return { url, jwks, assertion, connect, raw, wire, outboundAttempts: () => outboundAttempts, close: () => mf.dispose() };
}

export function dataOf(result) {
  if (result.structuredContent) return result.structuredContent;
  const block = result.content?.find(value => value.type === 'text');
  return block ? JSON.parse(block.text) : undefined;
}
