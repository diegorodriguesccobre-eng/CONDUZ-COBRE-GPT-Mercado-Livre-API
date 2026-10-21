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


describe('B3.1 token_type estrito e insensível a caixa', () => {
  function adapter(value: unknown) {
    return new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => Response.json({
      access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_REFRESH', expires_in: 3600, user_id: 42, token_type: value
    }) });
  }
  it.each(['bearer', 'Bearer', 'BEARER', 'bEaReR'])('aceita %s em code e refresh', async tokenType => {
    const a = adapter(tokenType);
    expect(await a.exchange(grant)).toMatchObject({ sellerId: '42', accessToken: 'SYNTHETIC_ACCESS' });
    expect(await a.refresh('SYNTHETIC_REFRESH')).toMatchObject({ sellerId: '42' });
  });
  it.each(['', 'Basic', 'MAC', 'DPoP', 'bearer token', ' bearer', 'bearer ', 'bearer\n', 'bearer\r\n', undefined, null, 1, true, {}, ['bearer']])(
    'recusa tipo inválido %j em code e refresh', async tokenType => {
      const a = adapter(tokenType);
      await expect(a.exchange(grant)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: false });
      await expect(a.refresh('SYNTHETIC_REFRESH')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: false });
    });
  it.each([{ refresh_token: null }, { access_token: null }, { expires_in: '3600' }, { user_id: 99 }])(
    'bearer minúsculo não enfraquece as demais validações %j', async overrides => {
      const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => Response.json({
        access_token: 'SYNTHETIC_ACCESS', refresh_token: 'SYNTHETIC_REFRESH', expires_in: 3600, user_id: 42, token_type: 'bearer', ...overrides
      }) });
      await expect(a.exchange(grant)).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE' });
    });
});

describe('B3.1 prazo total de resposta e cancelamento', () => {
  it('limita espera por headers mesmo se transporte ignora AbortSignal', async () => {
    let signal: AbortSignal | undefined;
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: request => {
      signal = request.signal; return new Promise<Response>(() => undefined);
    } }, 25);
    await expect(a.identity('SYNTHETIC')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', status: 504, retryable: true });
    expect(signal!.aborted).toBe(true);
  });
  it('limita corpo parado e não aguarda cancelamento que nunca termina', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode('{')); }, cancel });
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => new Response(body) }, 25);
    await expect(a.identity('SYNTHETIC')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', retryable: true });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('chunks lentos não reiniciam o prazo e resposta tardia é descartada', async () => {
    let controller: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => new Response(new ReadableStream<Uint8Array>({
      start(value) { controller = value; }, cancel
    })) }, 35);
    const result = a.identity('SYNTHETIC');
    const chunks = setInterval(() => controller.enqueue(new TextEncoder().encode(' ')), 5);
    try { await expect(result).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' }); }
    finally { clearInterval(chunks); }
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('o tempo gasto nos headers reduz o orçamento disponível ao body', async () => {
    vi.useFakeTimers();
    try {
      const cancel = vi.fn();
      const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', {
        send: async () => {
          await new Promise(resolve => setTimeout(resolve, 30));
          return new Response(new ReadableStream<Uint8Array>({ cancel }));
        }
      }, 50);
      const result = expect(a.identity('SYNTHETIC')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
      await vi.advanceTimersByTimeAsync(49); expect(cancel).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1); await result; expect(cancel).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
  it('fecha body se headers chegam depois do prazo', async () => {
    let resolve!: (response: Response) => void; const cancel = vi.fn();
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: () => new Promise<Response>(r => { resolve = r; }) }, 25);
    await expect(a.identity('SYNTHETIC')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT' });
    resolve(new Response(new ReadableStream<Uint8Array>({ cancel })));
    await Promise.resolve(); await Promise.resolve();
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('rejeita tamanho excessivo sem aguardar cancelamento travado', async () => {
    const cancel = vi.fn(() => new Promise<void>(() => undefined));
    const body = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(new Uint8Array(131073)); }, cancel });
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => new Response(body) }, 25);
    await expect(a.identity('SYNTHETIC')).rejects.toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', retryable: false });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it('resposta normal conclui e não cancela corpo já consumido', async () => {
    const cancel = vi.fn(); const data = new TextEncoder().encode(JSON.stringify({ id: 42, nickname: 'SYNTHETIC', site_id: 'MLB' }));
    const a = new CandidateAdapter('42', 'SYNTHETIC', 'SYNTHETIC', { send: async () => new Response(new ReadableStream<Uint8Array>({
      start(c) { c.enqueue(data); c.close(); }, cancel
    })) }, 25);
    expect(await a.identity('SYNTHETIC')).toMatchObject({ sellerId: '42' }); expect(cancel).not.toHaveBeenCalled();
  });
});
