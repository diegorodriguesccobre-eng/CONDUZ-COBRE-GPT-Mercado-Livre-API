import { describe, expect, it } from 'vitest';
import { CryptoBox, pkceChallenge, randomId } from '../src/crypto';
import { CONTEXT, TEST_KEY } from './helpers';

describe('AES-GCM e PKCE', () => {
  it('deriva o desafio S256 do vetor RFC 7636', async () => {
    expect(await pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM');
  });
  it('gera state/verifier com 256 bits e formato base64url', () => {
    expect(randomId()).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomId()).not.toBe(randomId());
  });
  it('cifra com IVs distintos e recupera o conteúdo', async () => {
    const box = new CryptoBox(TEST_KEY, CONTEXT);
    const first = await box.seal({ secret: 'SYNTHETIC_SECRET_MARKER' }, 'tokens');
    const second = await box.seal({ secret: 'SYNTHETIC_SECRET_MARKER' }, 'tokens');
    expect(first).not.toContain('SYNTHETIC_SECRET_MARKER');
    expect(first).not.toEqual(second);
    expect(await box.open(first, 'tokens')).toEqual({ secret: 'SYNTHETIC_SECRET_MARKER' });
  });
  it('rejeita alteração no ciphertext', async () => {
    const box = new CryptoBox(TEST_KEY, CONTEXT);
    const encrypted = JSON.parse(await box.seal('synthetic', 'tokens'));
    encrypted.data = (encrypted.data[0] === 'A' ? 'B' : 'A') + encrypted.data.slice(1);
    await expect(box.open(JSON.stringify(encrypted), 'tokens')).rejects.toMatchObject({ code: 'CIPHERTEXT_INVALID' });
  });
  it.each(['outra-conta', 'outro-ambiente'])('rejeita contexto %s', async context => {
    const ciphertext = await new CryptoBox(TEST_KEY, CONTEXT).seal('synthetic', 'tokens');
    await expect(new CryptoBox(TEST_KEY, context).open(ciphertext, 'tokens')).rejects.toMatchObject({ code: 'CIPHERTEXT_INVALID' });
  });
  it('rejeita mudança de finalidade e versão', async () => {
    const box = new CryptoBox(TEST_KEY, CONTEXT);
    const ciphertext = await box.seal('synthetic', 'tokens');
    await expect(box.open(ciphertext, 'oauth-state')).rejects.toMatchObject({ code: 'CIPHERTEXT_INVALID' });
    await expect(box.open(ciphertext.replace('"v":1', '"v":2'), 'tokens')).rejects.toMatchObject({ code: 'CIPHERTEXT_INVALID' });
  });
  it('rejeita chave de tamanho incorreto', () => {
    expect(() => new CryptoBox('YQ', CONTEXT)).toThrow();
  });
});
