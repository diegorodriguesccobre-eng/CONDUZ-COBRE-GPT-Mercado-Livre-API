import { AccountAccess, type AccountPolicy, type Permission } from '../../../src/b4/local';
import { AppError } from '../../../src/errors';
import type { AccessIdentityVerifier } from '../../../src/preparation/access-identity';
import type { GrantAuthority } from './persistent-storage';

export interface PersistentEnv {
  SYNTHETIC_POLICY?: string;
  GRANT_AUTHORITY?: DurableObjectNamespace<GrantAuthority>;
}
// No allow cache and no fallback to the in-memory fixture. AccountAccess maps every failure to denial.
export class DurableAccountPolicy implements AccountPolicy {
  constructor(private readonly env: PersistentEnv) {}
  async permissions(account: string, subject: string, required?: Permission): Promise<readonly Permission[]> {
    if (this.env.SYNTHETIC_POLICY !== 'persistent' || !this.env.GRANT_AUTHORITY) throw new Error('POLICY_UNAVAILABLE');
    const namespace = this.env.GRANT_AUTHORITY;
    return namespace.get(namespace.idFromName('synthetic-security-authority')).permissions({ account, subject }, required);
  }
}
// Keep the inherited JWT validation/expiry checks, while recording the exact permission decision.
export class DurableAccountAccess extends AccountAccess {
  private readonly persistentPolicy: DurableAccountPolicy;
  constructor(verifier: AccessIdentityVerifier, env: PersistentEnv) {
    const policy = new DurableAccountPolicy(env); super(verifier, policy); this.persistentPolicy = policy;
  }
  override async authorize(account: string, subject: string, permission: Permission): Promise<void> {
    try {
      if (!(await this.persistentPolicy.permissions(account, subject, permission)).includes(permission)) throw new Error();
    } catch { throw new AppError('ACCESS_DENIED', 403, 'Acesso negado.'); }
  }
}
