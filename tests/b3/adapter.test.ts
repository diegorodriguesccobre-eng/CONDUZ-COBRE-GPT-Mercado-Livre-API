import { describe, expect, it, vi } from 'vitest';
import { CandidateAdapter } from '../../src/b3/adapter';
import { RealRequestFactory, assertClosedRequest } from '../../src/preparation/real-http-transport';
import { PRODUCTION_REDIRECT_URI } from '../../src/preparation/config';

const grant = { code: 'SYNTHETIC', verifier: 'x'.repeat(43), redirectUri: PRODUCTION_REDIRECT_URI };
describe('B3 transporte candidato restrito', () => {
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('nega %s comercial antes da rede', method => {
    expect(() => assertClosedRequest(new Request('https://api.mercadolibre.com/items/MLB1234', { method }))).toThrow();
  });
  it.each(['https://api.mercadolibre.com/orders/search', 'http://api.mercadolibre.com/users/me',
    'https://evil.invalid/users/me', 'https://api.mercadolibre.com/users/me?token=secret',
    'https://api.mercadolibre.com/oauth/token?x=1'])('nega destino ou query %s', url => {
    expect(() => assertClosedRequest(new Request(url))).toThrow();
  });
  it('POST OAuth usa só form com grant explícito e callback fixo', async () => {
    const request = new RealRequestFactory().authorizationCode(grant, 'SYNTHETIC_CLIENT', 'SYNTHETIC_SECRET');
    expect(() => assertClosedRequest(request)).not.toThrow(); expect(request.method).toBe('POST');
    const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
    expect(form.get('grant_type')).toBe('authorization_code'); expect(form.get('redirect_uri')).toBe(PRODUCTION_REDIRECT_URI);
    expect(form.get('code_verifier')).toBe(grant.verifier);
    expect(() => new RealRequestFactory().authorizationCode({ ...grant, redirectUri: 'https://evil.invalid/callback' }, 'SYNTHETIC', 'SYNTHETIC')).toThrow();
  });
  it.each([301, 302, 307, 400, 429, 500])('recusa HTTP %s sem seguir redirect, repetir ou expor corpo', async status => {
    const send = vi.fn(async () => new Response('SYNTHETIC_PRIVATE_TOKEN', { status, headers: { Location: 'https://evil.invalid' } }));
    const adapter = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send });
    await expect(adapter.exchange(grant)).rejects.toThrow('Resposta candidata indisponível.');
    expect(send).toHaveBeenCalledTimes(1); expect(send.mock.calls[0]).toBeDefined();
  });
  it('limita corpo sem depender de Content-Length', async () => {
    const adapter = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', {
      send: async () => new Response('x'.repeat(131073))
    });
    await expect(adapter.exchange(grant)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
  });
  it('contrato de identidade recusa vendedor divergente e não devolve PII', async () => {
    let id = 99;
    const adapter = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', {
      send: async () => Response.json({ id, nickname: 'SYNTHETIC', site_id: 'MLB', email: 'PRIVATE' })
    });
    await expect(adapter.identity('SYNTHETIC_TOKEN')).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
    id = 42; expect(await adapter.identity('SYNTHETIC_TOKEN')).toEqual({ sellerId: '42', nickname: 'SYNTHETIC', siteId: 'MLB' });
  });
  it('detalhe de produto de outro vendedor é recusado', async () => {
    const adapter = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => Response.json({ seller_id: 99 }) });
    await expect(adapter.reads.item('SYNTHETIC', 'MLB1234')).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
  });
});
