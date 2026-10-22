import { AppError } from '../errors';
import { AccessIdentityVerifier, type OperatorIdentity } from '../preparation/access-identity';
import { CALLBACK_PATH, type PreparationConfig } from '../preparation/config';
import { type LocalAccount, localB3Router } from '../b3/router';

export type Permission = 'read' | 'connect';
export interface AccountPolicy {
  // Read on EVERY operation. Missing, revoked or unavailable policy denies access.
  permissions(accountRef: string, subject: string): Promise<readonly Permission[]>;
}
export class AccountAccess {
  constructor(private readonly verifier: AccessIdentityVerifier, private readonly policy: AccountPolicy,
    private readonly now = Date.now) {}
  async authenticate(request: Request, accountRef: string, permission: Permission): Promise<OperatorIdentity> {
    const identity = await this.verifier.authenticate(request);
    await this.authorize(accountRef, identity.subject, permission);
    if (identity.expiresAt <= this.now()) throw new AppError('ACCESS_DENIED', 403, 'Acesso negado.');
    return identity;
  }
  async authorize(accountRef: string, subject: string, permission: Permission): Promise<void> {
    try {
      if (!(await this.policy.permissions(accountRef, subject)).includes(permission)) throw new Error();
    } catch { throw new AppError('ACCESS_DENIED', 403, 'Acesso negado.'); }
  }
}
const headers = { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' };
const deny = () => Response.json({ error: { code: 'ACCESS_DENIED' } }, { status: 403, headers });

// Local composition only: account selection is fixed by the caller, NEVER by query/header/JWT.
// No Worker entrypoint, fetch transport, remote JWKS or production binding is supplied here.
export function localB4Router(config: PreparationConfig, verifier: AccessIdentityVerifier,
  access: AccountAccess, account: LocalAccount, syntheticClientId: string) {
  const b3 = localB3Router(config, verifier, account, syntheticClientId);
  return async (request: Request): Promise<Response> => {
    try {
      const url = new URL(request.url);
      if (url.origin !== config.publicOrigin) return deny();
      if (url.pathname === CALLBACK_PATH) {
        if (request.method !== 'GET') return new Response(null, { status: 405, headers });
        account.quota('b4-public-callback');
        try {
          // Preserve B3.1 atomic state consumption, cookie, PKCE and seller verification.
          const grant = await account.browser.consume(request);
          // Recheck current policy even for a flow initiated before local revocation.
          await access.authorize(config.accountRef, grant.operatorSubject, 'connect');
          await account.tokens.connect(grant);
          return new Response(null, { status: 303, headers: { ...headers,
            'Set-Cookie': account.browser.clearCookie(), Location: account.browser.successUrl() } });
        } catch {
          return new Response('Fluxo local recusado.', { status: 400, headers: {
            ...headers, 'Set-Cookie': account.browser.clearCookie() } });
        }
      }
      await access.authenticate(request, config.accountRef, url.pathname === '/oauth/start' ? 'connect' : 'read');
      return await b3(request);
    } catch { return deny(); }
  };
}

export const READ_TOOLS = ['account', 'listings', 'listing'] as const;
// MCP application boundary only; no claim of Managed OAuth/MCP wire protocol homologation.
export function syntheticReadMcp(access: AccountAccess,
  accounts: ReadonlyMap<string, (tool: typeof READ_TOOLS[number]) => Promise<unknown>>) {
  return async (request: Request, accountRef: string, tool: string): Promise<unknown> => {
    await access.authenticate(request, accountRef, 'read');
    if (!READ_TOOLS.includes(tool as typeof READ_TOOLS[number]) || !accounts.has(accountRef)) {
      throw new AppError('ACCESS_DENIED', 403, 'Ferramenta não autorizada.');
    }
    return accounts.get(accountRef)!(tool as typeof READ_TOOLS[number]);
  };
}
