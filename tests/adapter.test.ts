import { describe, expect, it } from 'vitest';
import { MercadoLivreClient } from '../src/mercado-livre/client';
import { harness } from './helpers';

describe('adaptador HTTP fechado', () => {
  it.each(['https://example.com/users/me', 'http://api.mercadolibre.com/users/me',
    'https://api.mercadolibre.com.attacker.invalid/users/me'])('nega destino %s', async url => {
    await expect(harness().provider.send(new Request(url))).rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('nega escrita comercial %s', async method => {
    await expect(harness().provider.send(new Request('https://api.mercadolibre.com/items/MLB_SYNTH_001', { method })))
      .rejects.toMatchObject({ code: 'METHOD_DENIED' });
  });
  it('nega consulta de outra conta e endpoint arbitrário', async () => {
    const h = harness();
    await expect(h.provider.send(new Request('https://api.mercadolibre.com/users/OTHER/items/search')))
      .rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
    await expect(h.provider.send(new Request('https://api.mercadolibre.com/orders/search')))
      .rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
  });
  it('consulta somente anúncios ativos com paginação e detalhe', async () => {
    const h = harness(); await h.connect();
    const first = await h.service.listings(1, null);
    expect(first.items.map(i => i.item_id)).toEqual(['MLB_SYNTH_001']);
    expect(first.next_cursor).toBeTypeOf('string');
    const second = await h.service.listings(1, first.next_cursor);
    expect(second.items.map(i => i.item_id)).toEqual(['MLB_SYNTH_002']);
    expect(second.items[0]?.available_quantity).toBe(0);
    expect(second.next_cursor).toBeNull();
    expect((await h.service.listing('MLB_SYNTH_001')).price).toEqual({ amount: '129.90', currency: 'BRL' });
  });
  it('rejeita cursor adulterado, expirado ou usado com outro filtro', async () => {
    const h = harness(); await h.connect(); const page = await h.service.listings(1, null);
    await expect(h.service.listings(1, 'tampered')).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    await expect(h.service.listings(2, page.next_cursor)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
    h.clock.now += 300000;
    await expect(h.service.listings(1, page.next_cursor)).rejects.toMatchObject({ code: 'CURSOR_INVALID' });
  });
  it('rejeita detalhe pertencente a outro vendedor', async () => {
    const h = harness(provider => ({ send: async req => {
      if (new URL(req.url).pathname.startsWith('/items/')) return Response.json({ seller_id: 'OTHER' });
      return provider.send(req);
    } }));
    await h.connect();
    await expect(h.service.listing('MLB_SYNTH_001')).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
  });
  it.each([403, 429, 500])('trata HTTP %s sem repetições automáticas', async status => {
    let calls = 0;
    const client = new MercadoLivreClient({ send: async () => { calls++; return Response.json({ raw: 'SYNTHETIC_PRIVATE_MARKER' }, { status }); } });
    await expect(client.me('SYNTHETIC_ACCESS.test')).rejects.toMatchObject({ code: status === 429 ? 'RATE_LIMITED' : 'UPSTREAM_ERROR' });
    expect(calls).toBe(1);
  });
  it('rejeita JSON malformado e campos monetários inválidos', async () => {
    const invalid = new MercadoLivreClient({ send: async () => new Response('invalid json') });
    await expect(invalid.me('SYNTHETIC_ACCESS.test')).rejects.toMatchObject({ code: 'UPSTREAM_CONTRACT' });
    const h = harness(provider => ({ send: async req => {
      const response = await provider.send(req);
      if (!new URL(req.url).pathname.startsWith('/items/')) return response;
      const item = await response.json() as object;
      return Response.json({ ...item, price: 129.9 });
    } }));
    await h.connect();
    await expect(h.service.listing('MLB_SYNTH_001')).rejects.toMatchObject({ code: 'UPSTREAM_CONTRACT' });
  });
});

describe('limites de transporte e erros', () => {
  it('interrompe transporte que excede prazo sem nova tentativa', async () => {
    let calls = 0;
    const client = new MercadoLivreClient({ send: () => { calls++; return new Promise(() => undefined); } }, 10);
    await expect(client.me('SYNTHETIC_ACCESS.test')).rejects.toMatchObject({ code: 'UPSTREAM_TIMEOUT', status: 504 });
    expect(calls).toBe(1);
  });
  it('não divulga mensagem de exceção do transporte', async () => {
    const client = new MercadoLivreClient({ send: async () => { throw new Error('SYNTHETIC_PRIVATE_MARKER'); } });
    await expect(client.me('SYNTHETIC_ACCESS.test')).rejects.toMatchObject({ code: 'UPSTREAM_ERROR', message: 'Falha no transporte sintético.' });
  });
  it('nega tokens em query e parâmetros arbitrários', async () => {
    const h = harness();
    await expect(h.provider.send(new Request('https://api.mercadolibre.com/users/me?access_token=SYNTHETIC')))
      .rejects.toMatchObject({ code: 'DESTINATION_DENIED' });
  });
});
