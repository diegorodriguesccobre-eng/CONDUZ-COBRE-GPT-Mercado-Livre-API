import { describe, expect, it, vi } from 'vitest';
import { digest, pkceChallenge, randomId } from '../../src/crypto';
import { finishBrowserCallback } from '../../src/preparation/browser-oauth';
import { PRODUCTION_ORIGIN, PRODUCTION_REDIRECT_URI } from '../../src/preparation/config';
import { browserHarness } from './helpers';

describe('B1 callback público, sessão de administrador e PKCE', () => {
  it('preserva URL exata cadastrada e cifra sessão/state com PKCE S256', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    expect(flow.cookie).toContain('__Host-conduz_oauth=');
    for (const option of ['HttpOnly', 'Secure', 'SameSite=Lax', 'Path=/']) expect(flow.cookie).toContain(option);
    expect(flow.cookie).not.toContain('Domain=');
    const row = h.store.states.get(await digest(flow.state))!;
    expect(row.ciphertext).not.toContain(h.identity.subject);
    const grant = await h.service.consume(h.callback(flow.state, flow.cookie));
    expect(grant.redirectUri).toBe(PRODUCTION_REDIRECT_URI);
    expect(grant.operatorSubject).toBe(h.identity.subject);
    expect(await pkceChallenge(grant.verifier)).toBe(flow.challenge);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('callback público não depende de Bearer nem JWT, mas exige prova da sessão criada após login', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const exchangeAndValidate = vi.fn(async () => undefined);
    const response = await finishBrowserCallback(h.service, h.callback(flow.state, flow.cookie), { exchangeAndValidate });
    expect(response.status).toBe(303);
    expect(response.headers.get('Location')).toBe(PRODUCTION_ORIGIN + '/oauth/result');
    expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(response.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(response.headers.get('Location')).not.toContain('code=');
    expect(exchangeAndValidate).toHaveBeenCalledOnce();
    expect(await response.text()).toBe('');
  });
  it('consumo atômico permite um único callback concorrente', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const results = await Promise.allSettled([h.service.consume(h.callback(flow.state, flow.cookie)), h.service.consume(h.callback(flow.state, flow.cookie))]);
    expect(results.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(results.filter(r => r.status === 'rejected')).toHaveLength(1);
  });
  it('rejeita state expirado', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity); h.clock.now += 300000;
    await expect(h.service.consume(h.callback(flow.state, flow.cookie))).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('limita o fluxo à duração da autenticação individual', async () => {
    const h = browserHarness(); h.identity.expiresAt = h.clock.now + 2000;
    const flow = await h.service.begin(h.startRequest(), h.identity);
    expect(flow.expiresAt).toBe(h.identity.expiresAt); expect(flow.cookie).toContain('Max-Age=2');
    h.clock.now += 2001;
    await expect(h.service.consume(h.callback(flow.state, flow.cookie))).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('nega início sem administrador, com sessão expirada ou origem externa', async () => {
    const h = browserHarness();
    await expect(h.service.begin(h.startRequest(), { ...h.identity, role: 'viewer' })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    await expect(h.service.begin(h.startRequest(), { ...h.identity, expiresAt: 0 })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    const attack = new Request(PRODUCTION_ORIGIN + '/oauth/start', { method: 'POST', headers: { Origin: 'https://attacker.invalid' } });
    await expect(h.service.begin(attack, h.identity)).rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
  });
  it.each(['GET', 'PUT', 'DELETE'])('nega início pelo método %s', async method => {
    const h = browserHarness();
    await expect(h.service.begin(new Request(PRODUCTION_ORIGIN + '/oauth/start', { method, headers: { Origin: PRODUCTION_ORIGIN } }), h.identity))
      .rejects.toMatchObject({ code: 'ORIGIN_DENIED' });
  });
  it('não aceita cookie ausente, duplicado ou de outro navegador', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const url = h.callback(flow.state, flow.cookie).url;
    await expect(h.service.consume(new Request(url))).rejects.toMatchObject({ code: 'STATE_INVALID' });
    const cookie = flow.cookie.split(';')[0]!;
    await expect(h.service.consume(new Request(url, { headers: { Cookie: cookie + '; ' + cookie } }))).rejects.toMatchObject({ code: 'STATE_INVALID' });
    await expect(h.service.consume(h.callback(flow.state, '__Host-conduz_oauth=' + randomId()))).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('recusa troca de operador quando identidade adicional é fornecida', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    await expect(h.service.consume(h.callback(flow.state, flow.cookie), { ...h.identity, subject: 'different' }))
      .rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('recusa queries duplicadas e callback em outra URL', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const request = h.callback(flow.state, flow.cookie);
    for (const url of [request.url + '&state=' + flow.state, request.url.replace('/oauth/mercadolivre/callback', '/oauth/callback'),
      request.url + '&redirect_uri=https://attacker.invalid']) {
      await expect(h.service.consume(new Request(url, { headers: request.headers }))).rejects.toMatchObject({ code: 'STATE_INVALID' });
    }
  });
  it('cancelamento consome state, elimina cookie e nunca troca código', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const request = new Request(PRODUCTION_REDIRECT_URI + '?' + new URLSearchParams({ state: flow.state, error: 'access_denied' }),
      { headers: { Cookie: flow.cookie.split(';')[0]! } });
    const exchangeAndValidate = vi.fn(async () => undefined);
    const response = await finishBrowserCallback(h.service, request, { exchangeAndValidate });
    expect(response.status).toBe(400); expect(response.headers.get('Set-Cookie')).toContain('Max-Age=0');
    expect(exchangeAndValidate).not.toHaveBeenCalled(); expect(h.store.states.size).toBe(0);
  });
  it('falha de troca é saneada e não restaura state consumido', async () => {
    const h = browserHarness(); const flow = await h.service.begin(h.startRequest(), h.identity);
    const response = await finishBrowserCallback(h.service, h.callback(flow.state, flow.cookie), {
      exchangeAndValidate: async () => { throw new Error('SYNTHETIC_SECRET_MARKER'); }
    });
    expect(response.status).toBe(400); expect(await response.text()).not.toContain('SYNTHETIC_SECRET_MARKER');
    await expect(h.service.consume(h.callback(flow.state, flow.cookie))).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
});
