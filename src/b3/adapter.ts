import { AppError } from '../errors';
import { RealRequestFactory, assertClosedRequest, type AuthorizationGrant } from '../preparation/real-http-transport';
import { PreparedReadClient } from '../preparation/prepared-read-client';
import type { HttpTransport } from '../mercado-livre/synthetic-transport';
import type { CandidateTokens, TokenProvider } from './token-service';

// No fetch implementation and no real credentials are supplied in B3. Dependency injection
// is for local fixtures. Deployed entrypoint below never constructs this adapter.
export class CandidateAdapter implements TokenProvider {
  private readonly factory = new RealRequestFactory();
  readonly reads: PreparedReadClient;
  constructor(private readonly seller: string, private readonly clientId: string, private readonly clientSecret: string,
    private readonly transport: HttpTransport, private readonly deadlineMs = 10000) {
    if (!Number.isSafeInteger(deadlineMs) || deadlineMs < 1 || deadlineMs > 10000) throw this.invalid();
    this.reads = new PreparedReadClient(seller, { send: request => this.send(request) });
  }
  private async send(request: Request): Promise<Response> {
    assertClosedRequest(request);
    // Account-scoped defense before transport, including user-id in listing path.
    const url = new URL(request.url);
    if (url.pathname.startsWith('/users/') && url.pathname !== '/users/me'
      && url.pathname !== `/users/${this.seller}/items/search`) throw this.invalid();
    // One deadline for headers AND the entire decompressed body. A transport or
    // stream that ignores AbortSignal must not hold the account's queue forever.
    const controller = new AbortController();
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let response: Response | undefined;
    let expired = false; let completed = false;
    const cancel = () => {
      // Cancellation itself may hang or throw. Never await untrusted cleanup.
      try { void (reader ? reader.cancel() : response?.body?.cancel())?.catch(() => undefined); }
      catch { /* Cleanup cannot replace the safe response error. */ }
    };
    let timer: ReturnType<typeof setTimeout>;
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        expired = true; controller.abort(); cancel(); reject(this.timeout());
      }, this.deadlineMs);
    });
    const work = async () => {
      try {
        response = await this.transport.send(new Request(request, { redirect: 'manual', signal: controller.signal }));
      } catch { throw this.unavailable(); }
      // Dispose late responses even if the transport ignored the abort.
      if (expired) { cancel(); throw this.timeout(); }
      if (response.status === 401) throw new AppError('QUERY_AUTH_REQUIRED', 401, 'Autorização da consulta inválida.');
      if (response.status === 403) throw new AppError('QUERY_DENIED', 403, 'Consulta não autorizada.');
      if (response.status === 429 || response.status >= 500) throw this.unavailable();
      if (!response.ok || response.status >= 300 || (response.headers.get('Content-Length') !== null
        && Number(response.headers.get('Content-Length')) > 131072)) throw this.invalid();
      // Bound decompressed bytes, even without Content-Length; chunks never reset the deadline.
      reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
      if (!reader) throw this.invalid();
      for (;;) {
        let result: ReadableStreamReadResult<Uint8Array>;
        try { result = await reader.read(); } catch { throw expired ? this.timeout() : this.unavailable(); }
        if (expired) throw this.timeout();
        if (result.done) break;
        length += result.value.byteLength;
        if (length > 131072) throw this.invalid();
        chunks.push(result.value);
      }
      const bytes = new Uint8Array(length); let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
      completed = true;
      return new Response(bytes, { headers: { 'Content-Type': 'application/json' } });
    };
    try { return await Promise.race([work(), deadline]); }
    finally {
      clearTimeout(timer!);
      if (!completed) { controller.abort(); cancel(); }
    }
  }

  private async tokens(request: Request): Promise<CandidateTokens> {
    try {
      const value = await (await this.send(request)).json() as Record<string, unknown>;
      if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string'
        || typeof value.token_type !== 'string' || value.token_type.toLowerCase() !== 'bearer' || !Number.isSafeInteger(value.expires_in)
        || !Number.isSafeInteger(value.user_id) || String(value.user_id) !== this.seller) throw this.invalid();
      return { accessToken: value.access_token, refreshToken: value.refresh_token,
        expiresIn: Number(value.expires_in), sellerId: String(value.user_id) };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw this.invalid();
    }
  }
  exchange(grant: AuthorizationGrant) { return this.tokens(this.factory.authorizationCode(grant, this.clientId, this.clientSecret)); }
  refresh(token: string) { return this.tokens(this.factory.refresh(token, this.clientId, this.clientSecret)); }
  identity(access: string) { return this.reads.identity(access); }
  private timeout() { return new AppError('UPSTREAM_TIMEOUT', 504, 'Prazo da resposta excedido.', true); }
  private unavailable() { return new AppError('UPSTREAM_UNAVAILABLE', 503, 'Resposta candidata indisponível.', true); }
  private invalid() { return new AppError('UPSTREAM_UNAVAILABLE', 502, 'Resposta candidata indisponível.'); }
}
