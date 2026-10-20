import { AppError } from './errors';
import { digest } from './crypto';

export async function authenticate(request: Request, expected: string): Promise<string> {
  const match = /^Bearer ([A-Za-z0-9_-]{32,128})$/.exec(request.headers.get('Authorization') ?? '');
  if (!match?.[1]) throw new AppError('UNAUTHORIZED', 401, 'Autenticação interna obrigatória.');
  // Native HMAC verification avoids comparing a secret using ordinary string equality.
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', encoder.encode(expected),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
  const candidate = await crypto.subtle.importKey('raw', encoder.encode(match[1]),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const message = encoder.encode('conduz-cobre:b0:internal-auth');
  const signature = await crypto.subtle.sign('HMAC', candidate, message);
  if (!await crypto.subtle.verify('HMAC', key, signature, message)) {
    throw new AppError('UNAUTHORIZED', 401, 'Autenticação interna obrigatória.');
  }
  return `operator:${await digest(expected)}`;
}
