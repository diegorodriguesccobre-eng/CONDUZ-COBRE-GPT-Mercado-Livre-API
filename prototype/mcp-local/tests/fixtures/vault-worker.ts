// Separate, undeployed test entrypoint; inherited transport copied without relaxing its checks.
import type { JSONWebKeySet } from 'jose';
import { createSyntheticAccess } from '../../src/synthetic';
import { createVaultMcp } from '../../vault/server';
import type { VaultEnv } from '../../vault/storage';
import { DurableAccountAccess, type PersistentEnv } from '../../src/persistent-policy';

const MAX_HTTP_BYTES = 16384;
const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
const denied = (status: number) => Response.json({ error: 'SYNTHETIC_REQUEST_DENIED' }, { status, headers: HEADERS });
interface SyntheticEnv extends PersistentEnv, VaultEnv { SYNTHETIC_ONLY?: string; SYNTHETIC_JWKS?: JSONWebKeySet }

async function boundedBody(body: ReadableStream<Uint8Array> | null): Promise<Uint8Array<ArrayBuffer>> {
  if (!body) return new Uint8Array();
  const reader = body.getReader(); const chunks: Uint8Array[] = []; let bytes = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      (async () => {
        while (true) {
          const chunk = await reader.read(); if (chunk.done) break;
          bytes += chunk.value.byteLength; if (bytes > MAX_HTTP_BYTES) throw new Error('BODY_LIMIT');
          chunks.push(chunk.value);
        }
        const result = new Uint8Array(bytes); let position = 0;
        for (const chunk of chunks) { result.set(chunk, position); position += chunk.length; }
        return result;
      })(),
      new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('BODY_TIMEOUT')), 2000); })
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    void reader.cancel().catch(() => undefined);
  }
}

// This is a NEW, unconnected local test entrypoint. No Wrangler/deployment config is provided.
export default {
  async fetch(request: Request, env: SyntheticEnv): Promise<Response> {
    const url = new URL(request.url);
    if (env.SYNTHETIC_ONLY !== 'B4_MCP_LOCAL_ONLY' || !env.SYNTHETIC_JWKS) return denied(503);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.hash) return denied(403);
    if (request.headers.get('Host') !== url.host) return denied(403);
    if (request.headers.has('Origin') && request.headers.get('Origin') !== url.origin) return denied(403);
    if (url.pathname !== '/mcp' || url.search) return denied(404);
    if (!['POST', 'GET', 'DELETE'].includes(request.method)) return denied(405);
    try {
      const synthetic = await createSyntheticAccess(env.SYNTHETIC_JWKS);
      const { verifier } = synthetic;
      // Persistent mode never falls back if its namespace is missing or unavailable.
      if (env.SYNTHETIC_POLICY !== undefined && env.SYNTHETIC_POLICY !== 'persistent') return denied(503);
      const access = env.SYNTHETIC_POLICY === 'persistent'
        ? new DurableAccountAccess(verifier, env) : synthetic.access;
      try { await verifier.authenticate(request); } catch { return denied(401); }
      let incoming = request;
      if (request.method === 'POST') {
        if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return denied(415);
        const bytes = await boundedBody(request.body);
        incoming = new Request(request, { body: bytes });
      }
      const handler = createVaultMcp(access, incoming, env);
      try {
        const response = await handler.fetch(incoming);
        const bytes = await boundedBody(response.body);
        return new Response(bytes, { status: response.status, headers: { ...Object.fromEntries(response.headers), ...HEADERS } });
      } finally { await handler.close(); }
    } catch (error) {
      return denied(error instanceof Error && error.message === 'BODY_LIMIT' ? 413
        : error instanceof Error && error.message === 'BODY_TIMEOUT' ? 408 : 503);
    }
  }
};

export { SyntheticAccountVault } from '../../vault/storage';
export { RecoveryGuardian, RecoveryReference, RecoveryData, RecoveryPartition } from '../../recovery/storage';
