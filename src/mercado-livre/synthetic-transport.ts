import { CryptoBox, base64url, unbase64url, pkceChallenge, randomId } from '../crypto';
import { AppError } from '../errors';
import { SELLER_ID } from '../types';
import { identity, items } from './fixtures';

export interface HttpTransport { send(request: Request): Promise<Response> }
type Claims = { seller: string; expires: number };
type Code = { challenge: string; redirect: string; expires: number };

export class SyntheticTransport implements HttpTransport {
  readonly calls: string[] = []; // Methods and paths only; never headers or queries.
  private readonly spent = new Set<string>();
  constructor(private readonly box: CryptoBox, private readonly now = Date.now) {}

  async authorizationCode(challenge: string, redirect: string): Promise<string> {
    return this.encode(await this.box.seal({ challenge, redirect, expires: this.now() + 300_000 }, 'synthetic-code'));
  }
  private encode(value: string): string { return base64url(new TextEncoder().encode(value)); }
  private decode(value: string): string { return new TextDecoder().decode(unbase64url(value)); }

  async send(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (url.origin !== 'https://api.mercadolibre.com' || url.username || url.password || url.hash) {
      throw new AppError('DESTINATION_DENIED', 403, 'Destino não permitido.');
    }
    this.calls.push(`${request.method} ${url.pathname}`);
    if (request.method === 'POST' && url.pathname === '/oauth/token' && !url.search) return this.exchange(request);
    if (request.method !== 'GET') throw new AppError('METHOD_DENIED', 405, 'Operação não permitida.');
    const routeAllowed = url.pathname === '/users/me'
      || url.pathname === `/users/${SELLER_ID}/items/search`
      || /^\/items\/MLB_SYNTH_00[123]$/.test(url.pathname);
    if ((url.pathname.endsWith('/items/search') && [...url.searchParams.keys()].some(key => !['status', 'limit', 'offset'].includes(key) || url.searchParams.getAll(key).length !== 1))
      || (!url.pathname.endsWith('/items/search') && url.search)) {
      throw new AppError('DESTINATION_DENIED', 403, 'Parâmetro não permitido.');
    }
    if (!routeAllowed) throw new AppError('DESTINATION_DENIED', 403, 'Recurso não permitido.');
    const bearer = request.headers.get('Authorization')?.replace(/^Bearer /, '') ?? '';
    if (!bearer.startsWith('SYNTHETIC_ACCESS.')) return Response.json({ error: 'invalid_token' }, { status: 401 });
    let claims: Claims;
    try { claims = await this.box.open<Claims>(this.decode(bearer.slice('SYNTHETIC_ACCESS.'.length)), 'synthetic-access'); }
    catch { return Response.json({ error: 'invalid_token' }, { status: 401 }); }
    if (claims.expires <= this.now() || claims.seller !== SELLER_ID) return Response.json({ error: 'invalid_token' }, { status: 401 });
    if (url.pathname === '/users/me') return Response.json(identity);
    if (url.pathname.endsWith('/items/search')) {
      const active = items.filter(item => item.status === 'active');
      const limit = Number(url.searchParams.get('limit'));
      const offset = Number(url.searchParams.get('offset'));
      if (!Number.isInteger(limit) || limit < 1 || limit > 20 || !Number.isInteger(offset) || offset < 0
        || url.searchParams.get('status') !== 'active') return Response.json({ error: 'bad_request' }, { status: 400 });
      return Response.json({ results: active.slice(offset, offset + limit).map(item => item.id),
        paging: { total: active.length, offset, limit } });
    }
    const item = items.find(item => `/items/${item.id}` === url.pathname);
    return item ? Response.json(item) : Response.json({ error: 'not_found' }, { status: 404 });
  }

  private async exchange(request: Request): Promise<Response> {
    const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
    let seller = SELLER_ID;
    try {
      if (form.get('client_id') !== 'SYNTHETIC_CLIENT_B0') throw new Error();
      if (form.get('grant_type') === 'authorization_code') {
        const code = form.get('code') ?? '';
        const claim = await this.box.open<Code>(this.decode(code), 'synthetic-code');
        if (claim.expires <= this.now() || claim.redirect !== form.get('redirect_uri')
          || claim.challenge !== await pkceChallenge(form.get('code_verifier') ?? '') || this.spent.has(code)) throw new Error();
        this.spent.add(code);
      } else if (form.get('grant_type') === 'refresh_token') {
        const refresh = form.get('refresh_token') ?? '';
        if (!refresh.startsWith('SYNTHETIC_REFRESH.') || this.spent.has(refresh)) throw new Error();
        const claim = await this.box.open<{ seller: string }>(this.decode(refresh.slice('SYNTHETIC_REFRESH.'.length)), 'synthetic-refresh');
        if (claim.seller !== SELLER_ID) throw new Error();
        seller = claim.seller;
        this.spent.add(refresh);
      } else throw new Error();
    } catch { return Response.json({ error: 'invalid_grant' }, { status: 400 }); }
    const access = this.encode(await this.box.seal({ seller, expires: this.now() + 120_000 }, 'synthetic-access'));
    const refresh = this.encode(await this.box.seal({ seller, nonce: randomId() }, 'synthetic-refresh'));
    return Response.json({ access_token: `SYNTHETIC_ACCESS.${access}`, refresh_token: `SYNTHETIC_REFRESH.${refresh}`,
      token_type: 'Bearer', expires_in: 120, user_id: seller });
  }
}
