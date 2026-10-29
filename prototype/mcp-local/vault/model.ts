import { z } from 'zod';

// Trusted, local-only registry. No client field, JWT claim or upstream response mutates it.
export const VAULTS = Object.freeze({
  'account-a': Object.freeze({ account: 'account-a', seller: '10001', vault: 'synthetic-vault-a', keyId: 'synthetic-a', numeric: ['MLB11001', 'MLB11002'] as const, legacy: ['MLB_SYNTH_A_001', 'MLB_SYNTH_A_002'] as const }),
  'account-b': Object.freeze({ account: 'account-b', seller: '20002', vault: 'synthetic-vault-b', keyId: 'synthetic-b', numeric: ['MLB22001', 'MLB22002'] as const, legacy: ['MLB_SYNTH_B_001', 'MLB_SYNTH_B_002'] as const })
});
export type Account = keyof typeof VAULTS;
export const accountSchema = z.enum(['account-a', 'account-b']);
export const requestSchema = z.strictObject({ account: accountSchema, subject: z.string().regex(/^[\w-]{43}$/),
  identityExpiresAt: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), nonce: z.string().uuid(),
  operation: z.enum(['account', 'listings', 'listing']),
  limit: z.number().int().min(1).max(20).optional(), offset: z.number().int().min(0).max(1).optional(),
  itemId: z.string().regex(/^MLB_SYNTH_[AB]_00[12]$/).optional()
}).superRefine((r, c) => {
  if (r.operation === 'listing' ? !r.itemId || r.limit !== undefined || r.offset !== undefined
    : r.operation === 'account' ? r.itemId !== undefined || r.limit !== undefined || r.offset !== undefined
    : r.itemId !== undefined || r.limit === undefined || r.offset === undefined) c.addIssue({ code: 'custom', message: 'CLOSED_OPERATION' });
});
const material = z.strictObject({ key: z.string().regex(/^[\w-]{43}$/),
  access: z.string().regex(/^SYNTHETIC_ACCESS_[AB]_[a-f0-9-]{36}$/),
  refresh: z.string().regex(/^SYNTHETIC_REFRESH_[AB]_[a-f0-9-]{36}$/) });
export const materialSchema = z.strictObject({ 'account-a': material, 'account-b': material }).superRefine((m, c) => {
  if (m['account-a'].key === m['account-b'].key || !m['account-a'].access.startsWith('SYNTHETIC_ACCESS_A_') ||
      !m['account-b'].access.startsWith('SYNTHETIC_ACCESS_B_') || !m['account-a'].refresh.startsWith('SYNTHETIC_REFRESH_A_') ||
      !m['account-b'].refresh.startsWith('SYNTHETIC_REFRESH_B_')) c.addIssue({ code: 'custom', message: 'SYNTHETIC_MATERIAL_REQUIRED' });
});
export type Materials = z.infer<typeof materialSchema>;
export const context = (account: Account) => {
  const v = VAULTS[account]; return `conduz_cobre:synthetic-vault-isolation:v1:${v.account}:${v.seller}:${v.vault}`;
};
