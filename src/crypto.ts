import { AppError } from './errors';

export function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function unbase64url(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
}

export function randomId(): string { return base64url(crypto.getRandomValues(new Uint8Array(32))); }
export async function digest(value: string): Promise<string> {
  return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))));
}
export async function pkceChallenge(verifier: string): Promise<string> { return digest(verifier); }

export class CryptoBox {
  private readonly key: Promise<CryptoKey>;
  constructor(encodedKey: string, private readonly context: string) {
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = unbase64url(encodedKey); } catch { throw new AppError('CONFIG_INVALID', 503, 'Configuração B0 inválida.'); }
    if (bytes.length !== 32) throw new AppError('CONFIG_INVALID', 503, 'Configuração B0 inválida.');
    this.key = crypto.subtle.importKey('raw', bytes, 'AES-GCM', false, ['encrypt', 'decrypt']);
  }

  async seal(value: unknown, purpose: string): Promise<string> {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv,
      additionalData: new TextEncoder().encode(`${this.context}:${purpose}:v1`) },
    await this.key, new TextEncoder().encode(JSON.stringify(value)));
    return JSON.stringify({ v: 1, iv: base64url(iv), data: base64url(new Uint8Array(ciphertext)) });
  }

  async open<T>(encoded: string, purpose: string): Promise<T> {
    try {
      const box: unknown = JSON.parse(encoded);
      if (!box || typeof box !== 'object' || !('v' in box) || box.v !== 1 || !('iv' in box)
        || typeof box.iv !== 'string' || !('data' in box) || typeof box.data !== 'string') throw new Error();
      const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unbase64url(box.iv),
        additionalData: new TextEncoder().encode(`${this.context}:${purpose}:v1`) },
      await this.key, unbase64url(box.data));
      return JSON.parse(new TextDecoder().decode(plaintext)) as T;
    } catch { throw new AppError('CIPHERTEXT_INVALID', 409, 'Registro criptografado inválido.'); }
  }
}
