import { DurableObject } from 'cloudflare:workers';
import { McpServer, createMcpHandler } from '@modelcontextprotocol/server';
import { z } from 'zod';
export class ProbeGate extends DurableObject {
  private allowed = true; private revision = 1; private resume: (() => void) | undefined;
  private phase = 'initial'; private bytes = 0; private contained = false;
  async current() { return { allowed: this.allowed, revision: this.revision }; }
  async buffered(input: { bytes: number; contained: boolean }) {
    this.bytes = input.bytes; this.contained = input.contained; this.phase = 'buffered';
    await new Promise<void>(resolve => { this.resume = resolve; });
  }
  async status() { return { phase: this.phase, bytes: this.bytes, contained: this.contained }; }
  async change(kind: string) { if (kind === 'revoke') this.allowed = false; if (['revoke', 'revision'].includes(kind)) this.revision++; }
  async release() { this.resume?.(); this.resume = undefined; this.phase = 'released'; }
}
interface Env { GATE: DurableObjectNamespace<ProbeGate>; MODE: 'json' | 'sse'; STREAM_FAULT?: string }
const marker = 'SYNTHETIC_COMMERCIAL_CANARY';
export default {
  async fetch(request: Request, env: Env) {
    const gate = env.GATE.get(env.GATE.idFromName('probe'));
    const before = await gate.current();
    const parsed = request.method === 'POST' ? await request.clone().json() as { method?: string } : {};
    const handler = createMcpHandler(() => {
      const server = new McpServer({ name: 'buffering-probe', version: '0.0.1' });
      server.registerTool('account', { inputSchema: z.strictObject({ fail: z.boolean().optional() }) }, async ({ fail }) =>
        fail ? { isError: true, content: [{ type: 'text' as const, text: 'SYNTHETIC_TOOL_ERROR' }] }
          : { content: [{ type: 'text' as const, text: marker }] });
      return server;
    }, { legacy: 'stateless', responseMode: env.MODE, keepAliveMs: 0, maxRequestBodySize: 16384 });
    let closed = false; let reader: ReadableStreamDefaultReader<Uint8Array> | undefined; let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const response = await handler.fetch(request);
      let body = response.body;
      if (parsed.method === 'tools/call' && env.STREAM_FAULT === 'infinite') body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(`data: ${marker}\n\n`)); } });
      if (parsed.method === 'tools/call' && env.STREAM_FAULT === 'broken') body = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(marker)); c.error(new Error('INJECTED_STREAM_FAILURE')); } });
      reader = body?.getReader(); const chunks: Uint8Array[] = []; let total = 0;
      const bytes = await Promise.race([
        (async () => {
          if (reader) for (;;) { const r = await reader.read(); if (r.done) break; total += r.value.byteLength;
            if (total > 16384) throw new Error('BODY_LIMIT'); chunks.push(r.value); }
          const b = new Uint8Array(total); let n = 0; for (const c of chunks) { b.set(c, n); n += c.byteLength; } return b;
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('BUFFER_TIMEOUT')), 250); })
      ]);
      if (timer !== undefined) clearTimeout(timer); timer = undefined;
      await handler.close(); closed = true;
      if (parsed.method !== 'tools/call') return new Response(bytes, { status: response.status, headers: response.headers });
      await gate.buffered({ bytes: bytes.byteLength, contained: new TextDecoder().decode(bytes).includes(marker) });
      const after = await gate.current();
      if (request.signal.aborted || !after.allowed || after.revision !== before.revision) return new Response('BUFFER_FINAL_DENIED', { status: 403 });
      return new Response(bytes, { status: response.status, headers: response.headers });
    } catch { return new Response('BUFFER_UNAVAILABLE', { status: 503 }); }
    finally { if (timer) clearTimeout(timer); if (reader) void reader.cancel().catch(() => {}); if (!closed) await handler.close(); }
  }
};
