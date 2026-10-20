import { authenticate } from './auth';
import { validateConfig } from './config';
import { AppError, failure } from './errors';
import { ACCOUNT_REF, SCHEMA_VERSION, type Action, type Env, type Failure } from './types';
export { AccountVault } from './vault/account-vault';

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'"
  } });
}
function reject(error: Failure, requestId: string): Response {
  return json({ schema_version: SCHEMA_VERSION, source: 'synthetic', request_id: requestId,
    error: { code: error.code, message: error.message, retryable: error.retryable } }, error.status);
}
function parameters(url: URL, names: string[]): void {
  for (const key of url.searchParams.keys()) {
    if (!names.includes(key) || url.searchParams.getAll(key).length !== 1) throw new AppError('BAD_REQUEST', 400, 'Parâmetros inválidos.');
  }
}
async function route(request: Request, subject: string): Promise<Action | 'health'> {
  const url = new URL(request.url);
  if (url.href.length > 8192) throw new AppError('BAD_REQUEST', 400, 'Requisição muito longa.');
  if (request.headers.has('Origin')) throw new AppError('ORIGIN_DENIED', 403, 'Acesso de navegador não habilitado em B0.');
  if (url.pathname === '/internal/oauth/start') {
    parameters(url, []);
    if (request.method !== 'POST') throw new AppError('METHOD_DENIED', 405, 'Método não permitido.');
    if (request.body !== null) {
      const reader = request.body.getReader();
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        const empty = (async () => {
          while (true) {
            const chunk = await reader.read();
            if (chunk.done) break;
            if (chunk.value.byteLength > 0) throw new AppError('BAD_REQUEST', 400, 'Corpo não permitido.');
          }
        })();
        await Promise.race([empty, new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new AppError('BAD_REQUEST', 400, 'Corpo não permitido.')), 1000);
        })]);
      } finally { if (timer !== undefined) clearTimeout(timer); await reader.cancel(); }
    }
    return { operation: 'oauth.start', subject };
  }
  if (request.method !== 'GET') throw new AppError('METHOD_DENIED', 405, 'Método não permitido.');
  switch (url.pathname) {
    case '/internal/health': parameters(url, []); return 'health';
    case '/internal/oauth/callback': {
      parameters(url, ['state', 'code']);
      const state = url.searchParams.get('state') ?? '';
      const code = url.searchParams.get('code') ?? '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !/^[A-Za-z0-9_-]{20,4096}$/.test(code)) {
        throw new AppError('BAD_REQUEST', 400, 'Callback sintético inválido.');
      }
      return { operation: 'oauth.callback', subject, state, code };
    }
    case '/internal/account': parameters(url, []); return { operation: 'account', subject };
    case '/internal/listings': {
      parameters(url, ['limit', 'cursor']);
      const rawLimit = url.searchParams.get('limit') ?? '20';
      const cursor = url.searchParams.get('cursor');
      if (!/^([1-9]|1[0-9]|20)$/.test(rawLimit) || (cursor !== null && (cursor.length === 0 || cursor.length > 2048))) {
        throw new AppError('BAD_REQUEST', 400, 'Paginação inválida.');
      }
      return { operation: 'listings', subject, limit: Number(rawLimit), cursor };
    }
    default:
      parameters(url, []);
      if (/^\/internal\/listings\/MLB_SYNTH_00[123]$/.test(url.pathname)) {
        return { operation: 'listing', subject, itemId: url.pathname.split('/').at(-1)! };
      }
      throw new AppError('NOT_FOUND', 404, 'Rota não encontrada.');
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const requestId = crypto.randomUUID();
    const started = Date.now();
    let operation = 'rejected';
    let response: Response;
    try {
      validateConfig(env);
      const subject = await authenticate(request, env.INTERNAL_AUTH_KEY);
      const action = await route(request, subject);
      operation = action === 'health' ? 'health' : action.operation;
      let data: unknown;
      if (action === 'health') data = { status: 'ok', transport: 'synthetic' };
      else {
        const id = env.ACCOUNT_VAULT.idFromName(`conduz_cobre:${env.APP_ENV}:${ACCOUNT_REF}`);
        const result = await env.ACCOUNT_VAULT.get(id).dispatch(action);
        if (!result.ok) {
          response = reject(result.error, requestId);
          log();
          return response;
        }
        data = JSON.parse(result.data) as unknown;
      }
      response = json({ schema_version: SCHEMA_VERSION, source: 'synthetic', operation: 'conduz_cobre',
        account_ref: ACCOUNT_REF, fetched_at: new Date().toISOString(), request_id: requestId, data });
    } catch (error) { response = reject(failure(error), requestId); }
    log();
    return response;
    function log(): void {
      console.log(JSON.stringify({ event: 'internal_request', request_id: requestId, operation,
        status: response.status, duration_ms: Date.now() - started, source: 'synthetic' }));
    }
  }
} satisfies ExportedHandler<Env>;
