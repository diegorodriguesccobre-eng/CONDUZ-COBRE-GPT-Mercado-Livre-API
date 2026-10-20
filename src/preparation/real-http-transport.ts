import { AppError } from '../errors';
import type { HttpTransport } from '../mercado-livre/synthetic-transport';
import { LIVE_TRANSPORT_ENABLED, PRODUCTION_REDIRECT_URI } from './config';

export function assertClosedRequest(request: Request): void {
  const url = new URL(request.url);
  const denied = () => new AppError('DESTINATION_DENIED', 403, 'Recurso não permitido.');
  if (url.origin !== 'https://api.mercadolibre.com' || url.username || url.password || url.hash) throw denied();
  if (request.method === 'POST' && url.pathname === '/oauth/token' && !url.search) {
    if (!request.headers.get('Content-Type')?.startsWith('application/x-www-form-urlencoded')) throw denied();
    return;
  }
  if (request.method !== 'GET') throw denied();
  const search = /^\/users\/[1-9]\d{0,14}\/items\/search$/.test(url.pathname);
  if (!(url.pathname === '/users/me' || /^\/items\/MLB\d{4,20}$/.test(url.pathname) || search)) throw denied();
  for (const key of url.searchParams.keys()) {
    if (!search || !['limit', 'offset', 'status'].includes(key) || url.searchParams.getAll(key).length !== 1) throw denied();
  }
  if (search && (url.searchParams.get('status') !== 'active'
    || !/^([1-9]|1\d|20)$/.test(url.searchParams.get('limit') ?? '')
    || !/^\d{1,5}$/.test(url.searchParams.get('offset') ?? ''))) throw denied();
}

export class RealHttpTransport implements HttpTransport {
  constructor(private readonly network: typeof fetch = globalThis.fetch) {}
  async send(request: Request): Promise<Response> {
    if (!LIVE_TRANSPORT_ENABLED) throw new AppError('REAL_TRANSPORT_DISABLED', 503, 'Transporte real bloqueado nesta fase.');
    assertClosedRequest(request);
    // Future implementation is closed to redirects and bounded by a deadline. No B1 path reaches it.
    try {
      const response = await this.network(new Request(request, { redirect: 'manual', signal: AbortSignal.timeout(10000) }));
      if (response.status >= 300 && response.status < 400) {
        await response.body?.cancel();
        throw new AppError('DESTINATION_DENIED', 502, 'Redirecionamento não permitido.');
      }
      return response;
    } catch { throw new AppError('UPSTREAM_ERROR', 502, 'Falha no transporte oficial.', true); }
  }
}

export interface AuthorizationGrant { code: string; verifier: string; redirectUri: string }
export class RealRequestFactory {
  identity(access: string): Request { return this.get('/users/me', access); }
  listings(sellerId: string, access: string, limit: number, offset: number): Request {
    if (!/^[1-9]\d{0,14}$/.test(sellerId) || !Number.isSafeInteger(limit) || limit < 1 || limit > 20
      || !Number.isSafeInteger(offset) || offset < 0 || offset > 99999) throw this.invalid();
    return this.get(`/users/${sellerId}/items/search?${new URLSearchParams({ status: 'active', limit: String(limit), offset: String(offset) })}`, access);
  }
  item(itemId: string, access: string): Request {
    if (!/^MLB\d{4,20}$/.test(itemId)) throw this.invalid();
    return this.get(`/items/${itemId}`, access);
  }
  authorizationCode(grant: AuthorizationGrant, clientId: string, clientSecret: string): Request {
    const uri = new URL(grant.redirectUri);
    if (uri.href !== PRODUCTION_REDIRECT_URI || grant.redirectUri !== PRODUCTION_REDIRECT_URI || uri.protocol !== 'https:' || uri.username || uri.password || uri.search || uri.hash
      || !/^[A-Za-z0-9._~-]{43,128}$/.test(grant.verifier) || !grant.code || grant.code.length > 4096
      || !clientId || !clientSecret || /[\r\n]/.test(clientId + clientSecret + grant.code)) throw this.invalid();
    return new Request('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', redirect: 'manual', body: new URLSearchParams({ grant_type: 'authorization_code',
        code: grant.code, code_verifier: grant.verifier, redirect_uri: uri.href, client_id: clientId, client_secret: clientSecret })
    });
  }
  authorizationUrl(flow: { state: string; challenge: string }, clientId: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(flow.state) || !/^[A-Za-z0-9_-]{43}$/.test(flow.challenge)
      || !clientId || /[\r\n]/.test(clientId)) throw this.invalid();
    return 'https://auth.mercadolivre.com.br/authorization?' + new URLSearchParams({
      response_type: 'code', client_id: clientId, redirect_uri: PRODUCTION_REDIRECT_URI,
      state: flow.state, code_challenge: flow.challenge, code_challenge_method: 'S256'
    });
  }
  refresh(refreshToken: string, clientId: string, clientSecret: string): Request {
    if (!refreshToken || refreshToken.length > 8192 || !clientId || !clientSecret
      || /[\r\n]/.test(refreshToken + clientId + clientSecret)) throw this.invalid();
    return new Request('https://api.mercadolibre.com/oauth/token', {
      method: 'POST', redirect: 'manual', body: new URLSearchParams({ grant_type: 'refresh_token',
        refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret })
    });
  }
  private get(path: string, access: string): Request {
    if (!access || access.length > 8192 || /[\r\n]/.test(access)) throw this.invalid();
    const request = new Request(`https://api.mercadolibre.com${path}`, {
      method: 'GET', redirect: 'manual', headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' }
    });
    assertClosedRequest(request); return request;
  }
  private invalid() { return new AppError('BAD_REQUEST', 400, 'Parâmetros do adaptador inválidos.'); }
}
