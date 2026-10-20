import type { Failure } from './types';

export class AppError extends Error {
  constructor(public readonly code: string, public readonly status: number,
    message: string, public readonly retryable = false) { super(message); }
}

export function failure(error: unknown): Failure {
  if (error instanceof AppError) {
    return { code: error.code, status: error.status, message: error.message, retryable: error.retryable };
  }
  // Never forward upstream errors, URLs, headers or exception messages.
  return { code: 'INTERNAL_ERROR', status: 500, message: 'Falha interna.', retryable: false };
}

export function requireValue(condition: unknown, code = 'UPSTREAM_CONTRACT', status = 502,
  message = 'Resposta sintética incompatível com o contrato.'): asserts condition {
  if (!condition) throw new AppError(code, status, message);
}
