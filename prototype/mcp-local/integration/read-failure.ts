import { AppError } from '../../../src/errors';
import { ReadDependencyFailure, ReadTokenFailure } from '../vault/read-core';
import { IntegrationFailure, type Code } from './contracts';
export interface ClassifiedReadFailure { code: Code; cause?: 'transport' | 'timeout' | 'upstream' }
const internal = new Set<string>(['INTEGRATION_READ_DENIED','INTEGRATION_IDENTITY_DENIED','INTEGRATION_DEPENDENCY_UNAVAILABLE',
  'INTEGRATION_RECOVERY_REQUIRED','INTEGRATION_REVISION_CHANGED','INTEGRATION_BINDING_DENIED',
  'INTEGRATION_TOKEN_UNAVAILABLE','INTEGRATION_REPLAY','INTEGRATION_BUSY']);
// Only local typed causes carry meaning. Never classify by message, stack, or a plain object's code.
export function classifyReadFailure(error: unknown): ClassifiedReadFailure {
  if (error instanceof ReadDependencyFailure) return { code: 'INTEGRATION_DEPENDENCY_UNAVAILABLE', cause: error.kind };
  if (error instanceof ReadTokenFailure) return { code: 'INTEGRATION_TOKEN_UNAVAILABLE' };
  if (error instanceof IntegrationFailure) return { code: internal.has(error.code) ? error.code : 'INTEGRATION_DEPENDENCY_UNAVAILABLE' };
  if (error instanceof AppError) {
    if (['UPSTREAM_TIMEOUT','QUERY_TIMEOUT'].includes(error.code)) return { code: 'INTEGRATION_DEPENDENCY_UNAVAILABLE', cause: 'timeout' };
    if (['UPSTREAM_UNAVAILABLE','QUERY_UNAVAILABLE'].includes(error.code)) return { code: 'INTEGRATION_DEPENDENCY_UNAVAILABLE', cause: 'upstream' };
    if (['VAULT_UNAVAILABLE','CONFIG_INVALID','CIPHERTEXT_INVALID','QUERY_AUTH_REQUIRED','REAUTH_REQUIRED','QUERY_DENIED','SELLER_MISMATCH','QUERY_CONTRACT','UPSTREAM_CONTRACT'].includes(error.code)) {
      return { code: 'INTEGRATION_TOKEN_UNAVAILABLE' };
    }
    return { code: 'INTEGRATION_DEPENDENCY_UNAVAILABLE', cause: 'upstream' };
  }
  // Untyped local token/storage/validation failures still close access; they never prove READ_DENIED.
  return { code: 'INTEGRATION_TOKEN_UNAVAILABLE' };
}
