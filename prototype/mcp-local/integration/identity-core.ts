import { z } from 'zod';
import { uuid, hash, reject, errorCode, IntegrationFailure, type Principal } from './contracts';

const issueSchema = z.strictObject({ assertion: z.string().min(1).max(16384), commandDigest: hash });
const lookupSchema = z.strictObject({ handle: uuid, commandDigest: hash, subject: hash, expiresAt: z.number().int().positive() });
const principalSchema = z.strictObject({ subject: hash, expiresAt: z.number().int().positive(), role: z.enum(['administrator', 'viewer']) });
export type AuthenticateAssertion = (assertion: string) => Promise<Principal>;

// Ephemeral, operation-bound identity handles. No grants, seeds, fixture controls or persistence.
export class VerifiedIdentityHandles {
  private readonly handles = new Map<string, { token: string; commandDigest: string; principal: Principal }>();
  constructor(private readonly authenticate: AuthenticateAssertion, private readonly now = Date.now) {}
  get pendingHandles(): number { return this.handles.size; }
  private async verify(assertion: string): Promise<Principal> {
    let principal: Principal;
    try { principal = await this.authenticate(assertion); }
    catch (error) {
      // A trusted verifier must explicitly classify identity refusal. Generic IO is not that proof.
      if (error instanceof IntegrationFailure) throw error;
      return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
    }
    const value = Object.freeze(principalSchema.parse(principal));
    if (value.expiresAt <= this.now()) return reject('INTEGRATION_IDENTITY_DENIED');
    return value;
  }
  async issue(input: unknown) {
    try {
      const v = issueSchema.parse(input), principal = await this.verify(v.assertion);
      for (const [id, value] of this.handles) if (value.principal.expiresAt <= this.now()) this.handles.delete(id);
      if (this.handles.size >= 64) return reject('INTEGRATION_BUSY');
      const handle = crypto.randomUUID(); this.handles.set(handle, { token: v.assertion, commandDigest: v.commandDigest, principal });
      return { ok: true as const, handle, principal };
    } catch (error) { return { ok: false as const, code: errorCode(error, 'INTEGRATION_IDENTITY_DENIED') }; }
  }
  async lookup(input: unknown, consume = false) {
    try {
      const v = lookupSchema.parse(input), record = this.handles.get(v.handle);
      if (!record || record.commandDigest !== v.commandDigest || record.principal.subject !== v.subject || record.principal.expiresAt !== v.expiresAt)
        return reject('INTEGRATION_IDENTITY_DENIED');
      const principal = await this.verify(record.token);
      if (principal.subject !== v.subject || principal.expiresAt !== v.expiresAt) return reject('INTEGRATION_IDENTITY_DENIED');
      if (consume) this.handles.delete(v.handle);
      return { ok: true as const, principal };
    } catch (error) { return { ok: false as const, code: errorCode(error, 'INTEGRATION_IDENTITY_DENIED') }; }
  }
  async cancel(handle: string): Promise<void> { this.handles.delete(uuid.parse(handle)); }
}
