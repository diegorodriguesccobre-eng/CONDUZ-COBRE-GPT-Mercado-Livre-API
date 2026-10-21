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
    private readonly transport: HttpTransport) {
    this.reads = new PreparedReadClient(seller, { send: request => this.send(request) });
  }
  private async send(request: Request): Promise<Response> {
    assertClosedRequest(request);
    // Account-scoped defense before transport, including user-id in listing path.
    const url = new URL(request.url);
    if (url.pathname.startsWith('/users/') && url.pathname !== '/users/me'
      && url.pathname !== `/users/${this.seller}/items/search`) throw this.invalid();
    const response = await this.transport.send(new Request(request, { redirect: 'manual', signal: AbortSignal.timeout(10000) }));
    if (!response.ok || response.status >= 300 || (response.headers.get('Content-Length') !== null
      && Number(response.headers.get('Content-Length')) > 131072)) {
      await response.body?.cancel(); throw this.invalid();
    }
    // Bound decompressed bytes, even when Content-Length is absent or false.
    const reader = response.body?.getReader(); const chunks: Uint8Array[] = []; let length = 0;
    if (!reader) throw this.invalid();
    try {
      for (;;) {
        const result = await reader.read(); if (result.done) break;
        length += result.value.byteLength;
        if (length > 131072) throw this.invalid();
        chunks.push(result.value);
      }
    } catch { await reader.cancel(); throw this.invalid(); }
    const bytes = new Uint8Array(length); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    return new Response(bytes, { headers: { 'Content-Type': 'application/json' } });
  }
  private async tokens(request: Request): Promise<CandidateTokens> {
    try {
      const value = await (await this.send(request)).json() as Record<string, unknown>;
      if (typeof value.access_token !== 'string' || typeof value.refresh_token !== 'string'
        || value.token_type !== 'Bearer' || !Number.isSafeInteger(value.expires_in)
        || !Number.isSafeInteger(value.user_id) || String(value.user_id) !== this.seller) throw this.invalid();
      return { accessToken: value.access_token, refreshToken: value.refresh_token,
        expiresIn: Number(value.expires_in), sellerId: String(value.user_id) };
    } catch { throw this.invalid(); }
  }
  exchange(grant: AuthorizationGrant) { return this.tokens(this.factory.authorizationCode(grant, this.clientId, this.clientSecret)); }
  refresh(token: string) { return this.tokens(this.factory.refresh(token, this.clientId, this.clientSecret)); }
  identity(access: string) { return this.reads.identity(access); }
  private invalid() { return new AppError('UPSTREAM_UNAVAILABLE', 502, 'Resposta candidata indisponível.'); }
}
