import { describe, expect, it, vi } from 'vitest';
import { CryptoBox, base64url } from '../../src/crypto';
import { TokenKeyring } from '../../src/b3/keyring';
import { TokenCoordinator, type CandidateTokens, type TokenProvider } from '../../src/b3/token-service';
import { MemoryStore, TEST_KEY } from '../helpers';
import { PRODUCTION_REDIRECT_URI } from '../../src/preparation/config';

const grant = { code: 'SYNTHETIC_CODE', verifier: 'x'.repeat(43), redirectUri: PRODUCTION_REDIRECT_URI };
const candidate = (version = 1): CandidateTokens => ({ accessToken: `SYNTHETIC_ACCESS_${version}`, refreshToken: `SYNTHETIC_REFRESH_${version}`, expiresIn: 60, sellerId: '42' });
function harness() {
  const clock = { now: 1800000000000 }; const store = new MemoryStore();
  const keys = new TokenKeyring('v1', { v1: TEST_KEY }, 'test-account');
  const provider = { exchange: vi.fn(async () => candidate()), refresh: vi.fn(async () => candidate(2)), identity: vi.fn(async () => ({ sellerId: '42' })) };
  const service = new TokenCoordinator(store, keys, provider, '42', () => clock.now);
  return { clock, store, keys, provider, service };
}
describe('B3 cofre e refresh coordenado', () => {
  it('valida identidade antes de persistir e mantém tokens cifrados', async () => {
    const h = harness(); await h.service.connect(grant);
    expect(h.provider.identity).toHaveBeenCalledWith('SYNTHETIC_ACCESS_1');
    expect(h.store.tokens?.ciphertext).not.toContain('SYNTHETIC_');
    expect(await h.keys.open(h.store.tokens!.ciphertext)).toMatchObject({ sellerId: '42', generation: 1 });
    expect(await h.service.withAccess(token => Promise.resolve(token))).toBe('SYNTHETIC_ACCESS_1');
    expect(h.provider.refresh).not.toHaveBeenCalled();
  });
  it.each(['token', 'identity'])('recusa vendedor divergente em %s sem persistir', async location => {
    const h = harness();
    if (location === 'token') h.provider.exchange.mockResolvedValue({ ...candidate(), sellerId: '99' });
    else h.provider.identity.mockResolvedValue({ sellerId: '99' });
    await expect(h.service.connect(grant)).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
    expect(h.store.tokens).toBeUndefined();
  });
  it.each([0, 59, 86401, NaN, 60.5])('recusa validade candidata %s', async expiresIn => {
    const h = harness(); h.provider.exchange.mockResolvedValue({ ...candidate(), expiresIn });
    await expect(h.service.connect(grant)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.store.tokens).toBeUndefined();
  });
  it.each(['', 'x\r\nsecret', 'x'.repeat(8193)])('recusa token candidato inválido', async accessToken => {
    const h = harness(); h.provider.exchange.mockResolvedValue({ ...candidate(), accessToken });
    await expect(h.service.connect(grant)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });
  it('20 consultas concorrentes usam uma renovação e geração nova', async () => {
    const h = harness(); await h.service.connect(grant); h.clock.now += 31000;
    h.provider.refresh.mockImplementation(async () => {
      expect(h.store.tokens!.status).toBe('refreshing');
      await Promise.resolve(); return candidate(2);
    });
    const values = await Promise.all(Array.from({ length: 20 }, () => h.service.withAccess(async t => t)));
    expect(new Set(values)).toEqual(new Set(['SYNTHETIC_ACCESS_2']));
    expect(h.provider.refresh).toHaveBeenCalledTimes(1);
    expect(await h.keys.open(h.store.tokens!.ciphertext)).toMatchObject({ generation: 2 });
  });
  it('refresh ambíguo bloqueia instância e recriação sem repetir refresh', async () => {
    const h = harness(); await h.service.connect(grant); h.clock.now += 31000;
    h.provider.refresh.mockRejectedValue(new Error('SYNTHETIC_PRIVATE_TOKEN'));
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    const fresh = new TokenCoordinator(h.store, h.keys, h.provider, '42', () => h.clock.now);
    await expect(fresh.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.provider.refresh).toHaveBeenCalledTimes(1);
    expect(h.store.tokens?.status).toBe('refreshing');
  });
  it('falha ao gravar marcador não chama provedor', async () => {
    const h = harness(); await h.service.connect(grant); h.clock.now += 31000;
    vi.spyOn(h.store, 'putTokens').mockImplementation(() => { throw new Error('SQL_PRIVATE'); });
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.provider.refresh).not.toHaveBeenCalled();
  });
  it('falha na gravação após refresh conserva marcador e não reusa token antigo', async () => {
    const h = harness(); await h.service.connect(grant); h.clock.now += 31000;
    const put = h.store.putTokens.bind(h.store);
    vi.spyOn(h.store, 'putTokens').mockImplementation(row => { if (row.status === 'ready') throw new Error('SQL_PRIVATE'); put(row); });
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.store.tokens?.status).toBe('refreshing');
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.provider.refresh).toHaveBeenCalledTimes(1);
  });
  it('vendedor divergente no refresh deixa cofre bloqueado', async () => {
    const h = harness(); await h.service.connect(grant); h.clock.now += 31000;
    h.provider.refresh.mockResolvedValue({ ...candidate(2), sellerId: '99' });
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.store.tokens?.status).toBe('refreshing');
  });
  it('falhas de leitura, cifragem adulterada e mensagens privadas não vazam', async () => {
    const h = harness(); await h.service.connect(grant);
    h.store.tokens!.ciphertext = 'SYNTHETIC_PRIVATE';
    await expect(h.service.withAccess(async t => t)).rejects.toThrow('Conexão indisponível; revisão necessária.');
    vi.spyOn(h.store, 'getTokens').mockImplementation(() => { throw new Error('PRIVATE_SQL_PATH'); });
    await expect(h.service.withAccess(async t => t)).rejects.toThrow('Conexão indisponível; revisão necessária.');
  });
  it('revogação local persiste bloqueio e impede uso após recriação', async () => {
    const h = harness(); await h.service.connect(grant); await h.service.revokeLocally();
    expect(h.store.tokens?.status).toBe('refreshing');
    const fresh = new TokenCoordinator(h.store, h.keys, h.provider, '42', () => h.clock.now);
    await expect(fresh.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.provider.refresh).not.toHaveBeenCalled();
  });
  it('não substitui conexão existente silenciosamente', async () => {
    const h = harness(); await h.service.connect(grant);
    await expect(h.service.connect(grant)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
    expect(h.provider.exchange).toHaveBeenCalledTimes(1);
  });
  it('rota de erro não devolve token capturado em exceção da consulta', async () => {
    const h = harness(); await h.service.connect(grant);
    await expect(h.service.withAccess(async t => { throw new Error(t); })).rejects.toThrow('Conexão indisponível; revisão necessária.');
  });
  it('rejeita registro cifrado com vendedor ou geração inválida', async () => {
    const h = harness();
    h.store.putTokens({ status: 'ready', ciphertext: await h.keys.seal({ ...candidate(), expiresAt: h.clock.now + 60000, generation: 0 }) });
    await expect(h.service.withAccess(async t => t)).rejects.toMatchObject({ code: 'REAUTH_REQUIRED' });
  });
});
describe('B3 rotação e isolamento de chaves', () => {
  const nextKey = base64url(new Uint8Array(32).fill(9));
  it('lê chave anterior e recifra com ativa sem expor dados', async () => {
    const h = harness(); await h.service.connect(grant);
    const keys = new TokenKeyring('v2', { v1: TEST_KEY, v2: nextKey }, 'test-account');
    const service = new TokenCoordinator(h.store, keys, h.provider, '42', () => h.clock.now);
    await service.rotate();
    expect(JSON.parse(h.store.tokens!.ciphertext).keyId).toBe('v2');
    expect(await new TokenKeyring('v2', { v2: nextKey }, 'test-account').open(h.store.tokens!.ciphertext)).toMatchObject({ generation: 1 });
    await expect(h.keys.open(h.store.tokens!.ciphertext)).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' });
  });
  it('AAD bloqueia troca de conta e adulteração do keyId', async () => {
    const keys = new TokenKeyring('v1', { v1: TEST_KEY, v2: TEST_KEY }, 'a');
    const ciphertext = await keys.seal({ private: 'SYNTHETIC' });
    await expect(new TokenKeyring('v1', { v1: TEST_KEY }, 'b').open(ciphertext)).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' });
    await expect(keys.open(ciphertext.replace('v1', 'v2'))).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' });
  });
  it('state e tokens não compartilham propósito criptográfico', async () => {
    const h = harness(); const encrypted = await new CryptoBox(TEST_KEY, 'test-account:b3:v1').seal({ secret: 'SYNTHETIC' }, 'state');
    await expect(h.keys.open(JSON.stringify({ keyId: 'v1', ciphertext: encrypted }))).rejects.toMatchObject({ code: 'VAULT_UNAVAILABLE' });
  });
  it('rejeita chave ativa ausente', () => {
    expect(() => new TokenKeyring('v2', { v1: TEST_KEY }, 'a')).toThrow();
  });
});
// Compile-time contract: provider carries no generic proxy operation.
const _provider: keyof TokenProvider = 'exchange'; void _provider;
