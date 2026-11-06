import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { AppError } from '../../../src/errors';
import { VerifiedIdentityHandles } from '../integration/identity-core';
import { bounded, reject } from '../integration/contracts';
import { IDENTITY_NAME, identityVerifier } from './identity-config';

interface IdentityEnv {
  I2_MODE: string;
  I2_JWKS: unknown;
  I2_IDENTITIES: DurableObjectNamespace<I2Identity>;
}
// Private DO only: no fixture, seed, clock control, grants or persisted JWTs.
export class I2Identity extends DurableObject<IdentityEnv> {
  private readonly handles: VerifiedIdentityHandles;
  constructor(ctx: DurableObjectState, env: IdentityEnv) {
    super(ctx, env);
    const verifier = identityVerifier(env);
    this.handles = new VerifiedIdentityHandles(async assertion => {
      try { return await verifier.authenticate(new Request('http://127.0.0.1/', {
        headers: { 'Cf-Access-Jwt-Assertion': assertion }
      })); }
      catch (error) {
        if (error instanceof AppError && error.code === 'ACCESS_DENIED') return reject('INTEGRATION_IDENTITY_DENIED');
        return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
      }
    });
  }
  issue(input: unknown) { return this.handles.issue(input); }
  lookup(input: unknown, consume = false) { return this.handles.lookup(input, consume); }
  cancel(handle: string) { return this.handles.cancel(handle); }
}
const envelope = z.strictObject({ args: z.unknown() });
const lookup = z.strictObject({ input: z.unknown(), consume: z.boolean() });
const unavailable = () => Response.json({ ok: false }, { status: 503, headers: { 'Cache-Control': 'no-store' } });
export default {
  async fetch(request: Request, env: IdentityEnv): Promise<Response> {
    try {
      identityVerifier(env);
      const url = new URL(request.url);
      if (url.origin !== 'https://m1-ports.invalid' || url.search || url.hash || request.method !== 'POST'
        || !['/identity/issue','/identity/lookup','/identity/cancel'].includes(url.pathname)
        || !/^application\/json(?:\s*;|$)/i.test(request.headers.get('Content-Type') ?? '')) return unavailable();
      const bytes = await bounded(request.body, 1000, request.signal);
      const body = envelope.parse(JSON.parse(new TextDecoder().decode(bytes)));
      if (!Object.hasOwn(body, 'args')) return unavailable();
      const stub = env.I2_IDENTITIES.get(env.I2_IDENTITIES.idFromName(IDENTITY_NAME));
      let value: unknown;
      if (url.pathname === '/identity/issue') value = await stub.issue(body.args);
      else if (url.pathname === '/identity/lookup') {
        const args = lookup.parse(body.args); value = await stub.lookup(args.input, args.consume);
      } else { await stub.cancel(z.string().uuid().parse(body.args)); value = null; }
      return Response.json({ ok: true, value }, { headers: { 'Cache-Control': 'no-store' } });
    } catch { return unavailable(); }
  }
};
