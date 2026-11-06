import { DurableObject } from 'cloudflare:workers';
import { z } from 'zod';
import { localVerifier } from './profile';
import { VerifiedIdentityHandles } from './identity-core';
import { reject, type IntegrationEnv, type Principal } from './contracts';
export { localVerifier as verifier } from './profile';

// Local DO wrapper only. The shared handle core has no fixture or clock-control API.
export class IntegrationIdentity extends DurableObject<IntegrationEnv> {
  private offset = 0;
  private core = this.createCore();
  private createCore() {
    return new VerifiedIdentityHandles(token => this.verify(token), () => Date.now() + this.offset);
  }
  private async verify(token: string): Promise<Principal> {
    try { return await localVerifier(this.env, () => Date.now() + this.offset).authenticate(new Request('http://127.0.0.1/', { headers: { 'Cf-Access-Jwt-Assertion': token } })); }
    catch { return reject('INTEGRATION_IDENTITY_DENIED'); }
  }
  issue(input: unknown) { return this.core.issue(input); }
  lookup(input: unknown, consume = false) { return this.core.lookup(input, consume); }
  cancel(handle: string) { return this.core.cancel(handle); }
  // Privileged test-only seam: no HTTP route or MCP dispatch reaches it.
  async fixture(input: { offset?: number; clear?: boolean }) {
    if (input.offset !== undefined) this.offset = z.number().int().min(0).max(86400000).parse(input.offset);
    if (input.clear) this.core = this.createCore();
    return { handles: this.core.pendingHandles, offset: this.offset };
  }
}
