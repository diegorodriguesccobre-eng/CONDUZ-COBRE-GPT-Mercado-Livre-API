import { CryptoBox, digest, pkceChallenge, randomId } from '../crypto';
import { AppError } from '../errors';
import type { VaultStore } from '../types';
import type { OperatorIdentity } from './access-identity';
import { validatePreparationConfig, type PreparationConfig } from './config';
import type { AuthorizationGrant } from './real-http-transport';

const COOKIE = '__Host-conduz_oauth';
const COOKIE_OPTIONS = 'Path=/; HttpOnly; Secure; SameSite=Lax';
interface BrowserState { role: 'administrator'; accountRef: string; subject: string; sessionHash: string; verifier: string; expiresAt: number; redirectUri: string }
export interface PreparedFlow { state: string; challenge: string; expiresAt: number; cookie: string }

export class BrowserOAuthService {
  constructor(private readonly store: VaultStore, private readonly box: CryptoBox,
    private readonly config: PreparationConfig, private readonly now = Date.now) { validatePreparationConfig(config); }
  private administrator(identity: OperatorIdentity): void {
    if (identity.role !== 'administrator' || !identity.subject || identity.expiresAt <= this.now()) {
      throw new AppError('ACCESS_DENIED', 403, 'Operador administrador obrigatório.');
    }
  }
  async begin(request: Request, identity: OperatorIdentity): Promise<PreparedFlow> {
    this.administrator(identity);
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.href !== `${this.config.publicOrigin}/oauth/start`
      || request.headers.get('Origin') !== this.config.publicOrigin
      || (request.headers.has('Sec-Fetch-Site') && request.headers.get('Sec-Fetch-Site') !== 'same-origin')) {
      throw new AppError('ORIGIN_DENIED', 403, 'Origem não autorizada.');
    }
    const state = randomId(); const session = randomId(); const verifier = randomId();
    const expiresAt = Math.min(this.now() + 300000, identity.expiresAt);
    const flow: BrowserState = { role: 'administrator', accountRef: this.config.accountRef, subject: identity.subject, sessionHash: await digest(session), verifier,
      expiresAt, redirectUri: this.config.redirectUri };
    this.store.putState(await digest(state), { ciphertext: await this.box.seal(flow, 'browser-oauth-v1'), expiresAt });
    return { state, challenge: await pkceChallenge(verifier), expiresAt,
      cookie: `${COOKIE}=${session}; ${COOKIE_OPTIONS}; Max-Age=${Math.max(1, Math.floor((expiresAt - this.now()) / 1000))}` };
  }
  async consume(request: Request, identity?: OperatorIdentity): Promise<AuthorizationGrant & { operatorSubject: string }> {
    if (identity) this.administrator(identity);
    const url = new URL(request.url);
    if (request.method !== 'GET' || `${url.origin}${url.pathname}` !== this.config.redirectUri) throw this.invalid();
    if (url.href.length > 8192 || [...url.searchParams.keys()].some(key => !['state', 'code', 'error'].includes(key)
      || url.searchParams.getAll(key).length !== 1)) throw this.invalid();
    const state = url.searchParams.get('state') ?? ''; const code = url.searchParams.get('code') ?? '';
    const providerError = url.searchParams.get('error');
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || (providerError !== null
      ? (!/^[a-z_]{1,128}$/.test(providerError) || url.searchParams.has('code'))
      : (!code || code.length > 4096 || /[\r\n]/.test(code)))) throw this.invalid();
    const cookies = (request.headers.get('Cookie') ?? '').split(';').map(v => v.trim()).filter(v => v.startsWith(`${COOKIE}=`));
    if (cookies.length !== 1) throw this.invalid();
    const session = cookies[0]!.slice(COOKIE.length + 1);
    if (!/^[A-Za-z0-9_-]{43}$/.test(session)) throw this.invalid();
    // Atomic take through VaultStore. A consumed flow is never put back, even on exchange failure.
    const row = this.store.takeState(await digest(state));
    if (!row || row.expiresAt <= this.now()) throw this.invalid();
    const flow = await this.box.open<BrowserState>(row.ciphertext, 'browser-oauth-v1');
    if (!flow.subject || flow.role !== 'administrator' || flow.accountRef !== this.config.accountRef
      || (identity && flow.subject !== identity.subject) || flow.sessionHash !== await digest(session)
      || flow.expiresAt <= this.now() || flow.redirectUri !== this.config.redirectUri) throw this.invalid();
    if (providerError !== null) throw new AppError('OAUTH_DENIED', 400, 'Autorização não concedida.');
    return { code, verifier: flow.verifier, redirectUri: flow.redirectUri, operatorSubject: flow.subject };
  }
  successUrl(): string { return `${this.config.publicOrigin}/oauth/result`; }
  clearCookie(): string { return `${COOKIE}=; ${COOKIE_OPTIONS}; Max-Age=0`; }
  private invalid() { return new AppError('STATE_INVALID', 400, 'Fluxo OAuth inválido, expirado ou utilizado.'); }
}

export interface BrowserOAuthPort {
  // The implementation must validate seller and persist tokens atomically before resolving.
  exchangeAndValidate(grant: AuthorizationGrant): Promise<void>;
}
export async function finishBrowserCallback(service: BrowserOAuthService, request: Request,
  port: BrowserOAuthPort, identity?: OperatorIdentity): Promise<Response> {
  let status = 303; let connected = true;
  try { await port.exchangeAndValidate(await service.consume(request, identity)); }
  catch { connected = false; status = 400; }
  const headers = { 'Set-Cookie': service.clearCookie(), 'Cache-Control': 'no-store',
    'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" };
  if (!connected) return new Response('Não foi possível concluir o fluxo de preparação.', { status, headers });
  return new Response(null, { status, headers: { ...headers, Location: service.successUrl() } });
}
