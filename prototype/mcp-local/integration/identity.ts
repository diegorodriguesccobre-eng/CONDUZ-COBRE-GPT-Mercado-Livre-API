import { DurableObject } from 'cloudflare:workers';
import { createLocalJWKSet } from 'jose';
import { z } from 'zod';
import { AccessIdentityVerifier } from '../../../src/preparation/access-identity';
import { PRODUCTION_ORIGIN, PRODUCTION_REDIRECT_URI } from '../../../src/preparation/config';
import { ISSUER, AUDIENCE } from '../src/synthetic';
import { uuid, hash, reject, errorCode, type IntegrationEnv, type Principal } from './contracts';
const issueSchema = z.strictObject({ assertion: z.string().min(1).max(16384), commandDigest: hash });
const lookupSchema = z.strictObject({ handle: uuid, commandDigest: hash, subject: hash, expiresAt: z.number().int().positive() });
export function verifier(env: IntegrationEnv, now = Date.now) {
  return new AccessIdentityVerifier({ stage: 'production-preparation', transport: 'disabled', tenant: 'conduz_cobre',
    publicOrigin: PRODUCTION_ORIGIN, redirectUri: PRODUCTION_REDIRECT_URI, accessIssuer: ISSUER, accessAudience: AUDIENCE,
    operatorRoles: { 'synthetic-operator-a': 'viewer', 'synthetic-operator-b': 'viewer' }, accountRef: 'synthetic-local-only', expectedSellerId: '42'
  }, createLocalJWKSet(env.SYNTHETIC_JWKS), now);
}
// Ephemeral verified handles, separate from restorable grants. No identity bootstrap or keys are generated here.
export class IntegrationIdentity extends DurableObject<IntegrationEnv> {
  private readonly handles = new Map<string, { token: string; commandDigest: string; principal: Principal }>();
  private offset = 0;
  async issue(input: unknown) {
    try { return { ok: true as const, ...await this.issueInternal(input) }; }
    catch (e) { return { ok: false as const, code: errorCode(e, 'INTEGRATION_IDENTITY_DENIED') }; }
  }
  private async issueInternal(input: unknown) {
    const v = issueSchema.parse(input); const p = await this.verify(v.assertion);
    for (const [id, value] of this.handles) if (value.principal.expiresAt <= Date.now() + this.offset) this.handles.delete(id);
    if (this.handles.size >= 64) return reject('INTEGRATION_BUSY');
    const handle = crypto.randomUUID(); this.handles.set(handle, { token: v.assertion, commandDigest: v.commandDigest, principal: p });
    return { handle, principal: p };
  }
  private async verify(token: string): Promise<Principal> {
    try { return await verifier(this.env, () => Date.now() + this.offset).authenticate(new Request('http://127.0.0.1/', { headers: { 'Cf-Access-Jwt-Assertion': token } })); }
    catch { return reject('INTEGRATION_IDENTITY_DENIED'); }
  }
  async lookup(input: unknown, consume = false) {
    try { return { ok: true as const, principal: await this.lookupInternal(input, consume) }; }
    catch (e) { return { ok: false as const, code: errorCode(e, 'INTEGRATION_IDENTITY_DENIED') }; }
  }
  private async lookupInternal(input: unknown, consume: boolean): Promise<Principal> {
    const v = lookupSchema.parse(input), record = this.handles.get(v.handle);
    if (!record || record.commandDigest !== v.commandDigest || record.principal.subject !== v.subject || record.principal.expiresAt !== v.expiresAt) return reject('INTEGRATION_IDENTITY_DENIED');
    const p = await this.verify(record.token);
    if (p.subject !== v.subject || p.expiresAt !== v.expiresAt) return reject('INTEGRATION_IDENTITY_DENIED');
    if (consume) this.handles.delete(v.handle); return p;
  }
  async cancel(handle: string) { this.handles.delete(uuid.parse(handle)); }
  // Privileged test-only seam: no HTTP route or MCP dispatch reaches it.
  async fixture(input: { offset?: number; clear?: boolean }) {
    if (input.offset !== undefined) this.offset = z.number().int().min(0).max(86400000).parse(input.offset);
    if (input.clear) this.handles.clear();
    return { handles: this.handles.size, offset: this.offset };
  }
}
