import { CryptoBox } from '../crypto';
import { AppError } from '../errors';

// Versioned envelope. AES-GCM AAD binds tenant, stage, account and key identifier.
export class TokenKeyring {
  private readonly boxes = new Map<string, CryptoBox>();
  constructor(private readonly active: string, keys: Readonly<Record<string, string>>, context: string) {
    if (!/^[a-z0-9-]{1,32}$/.test(active) || !Object.hasOwn(keys, active) || Object.keys(keys).length > 3) throw this.invalid();
    for (const [id, key] of Object.entries(keys)) {
      if (!/^[a-z0-9-]{1,32}$/.test(id)) throw this.invalid();
      this.boxes.set(id, new CryptoBox(key, `${context}:b3:${id}`));
    }
  }
  async seal(value: unknown): Promise<string> {
    return JSON.stringify({ keyId: this.active, ciphertext: await this.boxes.get(this.active)!.seal(value, 'tokens') });
  }
  async open<T>(encoded: string): Promise<T> {
    try {
      const value = JSON.parse(encoded);
      if (!value || typeof value.keyId !== 'string' || typeof value.ciphertext !== 'string') throw this.invalid();
      const box = this.boxes.get(value.keyId);
      if (!box) throw this.invalid();
      return await box.open<T>(value.ciphertext, 'tokens');
    } catch { throw this.invalid(); }
  }
  private invalid() { return new AppError('VAULT_UNAVAILABLE', 503, 'Cofre indisponível.'); }
}
