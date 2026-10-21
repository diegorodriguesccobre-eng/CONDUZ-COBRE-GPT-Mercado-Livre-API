import { AppError } from '../errors';
import type { AccessIdentityVerifier, OperatorIdentity } from '../preparation/access-identity';
import { BrowserOAuthService, finishBrowserCallback } from '../preparation/browser-oauth';
import { RealRequestFactory } from '../preparation/real-http-transport';
import { CALLBACK_PATH, type PreparationConfig } from '../preparation/config';
import type { PreparedReadClient } from '../preparation/prepared-read-client';
import type { TokenCoordinator } from './token-service';

const HEADERS = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' };
export interface LocalAccount {
  browser: BrowserOAuthService;
  tokens: TokenCoordinator;
  reads: PreparedReadClient;
  quota(subject: string): void;
}
// Only local composition. Production entrypoints unconditionally return 503.
export function localB3Router(config: PreparationConfig, access: AccessIdentityVerifier, account: LocalAccount, clientId: string) {
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.origin !== config.publicOrigin || url.hash) throw new AppError('BAD_REQUEST', 400, 'Origem inválida.');
      if (url.pathname === CALLBACK_PATH) {
        // Callback is public; cookie + encrypted single-use state bind it to the authenticated initiator.
        if (request.method !== 'GET') return Response.json({ error: { code: 'METHOD_DENIED' } }, { status: 405, headers: HEADERS });
        account.quota('b3-public-callback');
        const response = await finishBrowserCallback(account.browser, request, {
          exchangeAndValidate: grant => account.tokens.connect(grant)
        });
        const headers = new Headers(response.headers);
        for (const [name, value] of Object.entries(HEADERS)) headers.set(name, value);
        return new Response(response.body, { status: response.status, headers });
      }
      // All other routes require an individual Access JWT, even result and health.
      const identity: OperatorIdentity = await access.authenticate(request);
      account.quota(identity.subject);
      if (url.pathname === '/oauth/start') {
        const flow = await account.browser.begin(request, identity);
        return Response.json({ authorizationUrl: new RealRequestFactory().authorizationUrl(flow, clientId), expiresAt: flow.expiresAt },
          { headers: { ...HEADERS, 'Set-Cookie': flow.cookie } });
      }
      if (request.method !== 'GET') throw new AppError('METHOD_DENIED', 405, 'Método não permitido.');
      const allowedQuery = url.pathname === '/internal/listings' ? ['limit', 'offset'] : [];
      if ([...url.searchParams.keys()].some(key => !allowedQuery.includes(key) || url.searchParams.getAll(key).length !== 1)) {
        throw new AppError('BAD_REQUEST', 400, 'Parâmetros inválidos.');
      }
      let data: unknown;
      if (url.pathname === '/internal/health') data = { phase: 'b3-local', realConnectionEnabled: false };
      else if (url.pathname === '/oauth/result') data = { message: 'Fluxo concluído. Consulte o estado interno.' };
      else if (url.pathname === '/internal/account') data = await account.tokens.withAccess(token => account.reads.identity(token));
      else if (url.pathname === '/internal/listings') {
        const limit = url.searchParams.get('limit') ?? '20'; const offset = url.searchParams.get('offset') ?? '0';
        if (!/^(?:[1-9]|1\d|20)$/.test(limit) || !/^\d{1,5}$/.test(offset)) throw new AppError('BAD_REQUEST', 400, 'Paginação inválida.');
        data = await account.tokens.withAccess(token => account.reads.listings(token, Number(limit), Number(offset)));
      } else if (/^\/internal\/listings\/MLB\d{4,20}$/.test(url.pathname)) {
        data = await account.tokens.withAccess(token => account.reads.item(token, url.pathname.split('/').at(-1)!));
      } else throw new AppError('NOT_FOUND', 404, 'Rota não disponível.');
      return Response.json({ data }, { headers: HEADERS });
    } catch (error) {
      // Never forward arbitrary provider/storage messages, even AppError messages from an injected port.
      const known = error instanceof AppError && ['ACCESS_DENIED', 'ORIGIN_DENIED', 'BAD_REQUEST', 'METHOD_DENIED',
        'NOT_FOUND', 'RATE_LIMITED', 'REAUTH_REQUIRED', 'SELLER_MISMATCH'].includes(error.code);
      return Response.json({ error: { code: known ? error.code : 'B3_UNAVAILABLE', message: 'Operação local não concluída.' } },
        { status: known ? error.status : 503, headers: HEADERS });
    }
  };
}
