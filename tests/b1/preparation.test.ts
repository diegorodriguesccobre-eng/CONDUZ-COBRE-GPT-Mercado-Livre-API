import { describe, expect, it, vi } from 'vitest';
import { env, exports } from 'cloudflare:workers';
import { reset, runInDurableObject } from 'cloudflare:test';
import { CryptoBox, pkceChallenge } from '../../src/crypto';
import { SqliteStore } from '../../src/vault/sqlite-store';
import { BrowserOAuthService } from '../../src/preparation/browser-oauth';
import { validatePreparationConfig, LIVE_TRANSPORT_ENABLED, PRODUCTION_OAUTH_ENABLED,
  PRODUCTION_REDIRECT_URI, CALLBACK_PATH } from '../../src/preparation/config';
import entrypoint from '../../src/preparation/entrypoint';
import { RealHttpTransport, RealRequestFactory, assertClosedRequest } from '../../src/preparation/real-http-transport';
import { parseDraftIdentity, parseDraftItem, parseDraftSearch } from '../../src/preparation/draft-contracts';
import draft from './fixtures/draft-meli.json';
import productionTemplate from '../../config/production-preparation.template.json';
import devcenter from '../../config/devcenter-status.json';
import { TEST_KEY, TEST_AUTH } from '../helpers';
import { preparationConfig } from './helpers';

describe('B1 bloqueios, contratos candidatos e segregação', () => {
  it('transporte real é bloqueado antes de qualquer acesso à rede', async () => {
    const network = vi.fn<typeof fetch>(); const transport = new RealHttpTransport(network);
    await expect(transport.send(new RealRequestFactory().identity('synthetic'))).rejects.toMatchObject({ code: 'REAL_TRANSPORT_DISABLED' });
    expect(network).not.toHaveBeenCalled(); expect(LIVE_TRANSPORT_ENABLED).toBe(false); expect(PRODUCTION_OAUTH_ENABLED).toBe(false);
  });
  it.each(['/oauth/mercadolivre/callback?state=synthetic&code=synthetic', '/internal/health', '/internal/listings', '/oauth/start'])
  ('entrypoint de produção responde fechado para %s', async path => {
    const result = await entrypoint.fetch(new Request(preparationConfig.publicOrigin + path));
    expect(result.status).toBe(503); expect(await result.json()).toMatchObject({ error: { code: 'PRODUCTION_DISABLED' } });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('configuração de produção não é herdada da B0 e não contém permissões presumidas', () => {
    expect(() => validatePreparationConfig(preparationConfig)).not.toThrow();
    expect(() => validatePreparationConfig({ ...preparationConfig, publicOrigin: 'http://localhost:8787' })).toThrow();
    expect(() => validatePreparationConfig({ ...preparationConfig, redirectUri: preparationConfig.publicOrigin + '/oauth/callback' })).toThrow();
    expect(() => validatePreparationConfig({ ...preparationConfig, operatorRoles: {} })).toThrow();
    expect(() => validatePreparationConfig(productionTemplate as typeof preparationConfig)).toThrow();
    expect(productionTemplate.redirectUri).toBe(PRODUCTION_REDIRECT_URI); expect(CALLBACK_PATH).toBe('/oauth/mercadolivre/callback');
    expect(devcenter.validated).toBe(false); expect(devcenter.productionOAuthReady).toBe(false);
  });
  it('B0 mantém seu health e callback local, independentemente do novo entrypoint', async () => {
    const response = await exports.default.fetch('http://localhost/internal/health', { headers: { Authorization: `Bearer ${TEST_AUTH}` } });
    expect(response.status).toBe(200); expect(env.OAUTH_REDIRECT_URI).toBe('http://localhost:8787/internal/oauth/callback');
  });
  it('RequestFactory prepara apenas leituras fechadas e não coloca Bearer em query', () => {
    const factory = new RealRequestFactory();
    const identity = factory.identity('synthetic'); expect(identity.headers.get('Authorization')).toBe('Bearer synthetic');
    expect(identity.url).toBe('https://api.mercadolibre.com/users/me'); expect(identity.redirect).toBe('manual');
    const page = factory.listings('42', 'synthetic', 1, 0); expect(new URL(page.url).searchParams.has('access_token')).toBe(false);
    expect(factory.item('MLB0000000000', 'synthetic').method).toBe('GET');
  });
  it('troca de código é preparada com verifier, sem executar a requisição', async () => {
    const request = new RealRequestFactory().authorizationCode({ code: 'SYNTHETIC_CODE', verifier: 'a'.repeat(43), redirectUri: PRODUCTION_REDIRECT_URI }, 'synthetic', 'synthetic');
    const form = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
    expect(form.get('code_verifier')).toBe('a'.repeat(43)); expect(form.get('redirect_uri')).toBe(PRODUCTION_REDIRECT_URI);
    expect(request.method).toBe('POST'); expect(request.redirect).toBe('manual'); expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it.each(['https://attacker.invalid/users/me', 'https://api.mercadolibre.com/users/me?access_token=synthetic',
    'https://api.mercadolibre.com/orders/search', 'https://api.mercadolibre.com/users/42/items/search?limit=1&offset=0&status=active&limit=2'])
  ('nega destino ou parâmetros arbitrários %s', url => {
    expect(() => assertClosedRequest(new Request(url))).toThrow();
  });
  it.each(['POST', 'PUT', 'PATCH', 'DELETE'])('nega escrita comercial %s', method => {
    expect(() => assertClosedRequest(new Request('https://api.mercadolibre.com/items/MLB0000000000', { method }))).toThrow();
  });
  it('fixtures são explicitamente candidatas e não respostas oficiais atuais', () => {
    expect(draft.evidence).toBe('SYNTHETIC_DRAFT_NOT_CURRENT_OFFICIAL_CONTRACT');
    expect(parseDraftIdentity(draft.identity, '42')).toEqual({ sellerId: '42', nickname: 'SYNTHETIC_B1', siteId: 'MLB' });
    expect(parseDraftIdentity(draft.identity, '42')).not.toHaveProperty('email');
    expect(parseDraftItem(draft.item, '42', draft.item.id).price.amount).toBe('129.90');
    expect(parseDraftItem({ ...draft.item, available_quantity: undefined }, '42', draft.item.id).availableQuantity).toBeNull();
    expect(parseDraftSearch(draft.search, 1, 0).ids).toEqual([draft.item.id]);
  });
  it('rejeita outro seller, decimais ambíguos, preço string e paginação incorreta', () => {
    expect(() => parseDraftIdentity(draft.identity, '99')).toThrow();
    for (const price of [1.005, NaN, Infinity, -1, '129.90']) expect(() => parseDraftItem({ ...draft.item, price }, '42', draft.item.id)).toThrow();
    expect(() => parseDraftSearch(draft.search, 2, 0)).toThrow();
  });
  it('state de navegador fica cifrado em SQLite e conserva uso único ao reconstruir serviço', async () => {
    await reset(); const vault = env.ACCOUNT_VAULT.get(env.ACCOUNT_VAULT.idFromName('b1-synthetic-browser-storage-test'));
    await runInDurableObject(vault, async (_instance, state) => {
      const store = new SqliteStore(state.storage); const box = new CryptoBox(TEST_KEY, 'b1-sqlite-synthetic');
      const service = new BrowserOAuthService(store, box, preparationConfig);
      const identity = { subject: 'synthetic-operator', role: 'administrator' as const, expiresAt: Date.now() + 300000 };
      const flow = await service.begin(new Request(preparationConfig.publicOrigin + '/oauth/start', { method: 'POST', headers: { Origin: preparationConfig.publicOrigin } }), identity);
      const row = state.storage.sql.exec<{ ciphertext: string }>('SELECT ciphertext FROM oauth_states').one();
      expect(row.ciphertext).not.toContain(identity.subject);
      const restarted = new BrowserOAuthService(new SqliteStore(state.storage), box, preparationConfig);
      const callback = () => new Request(PRODUCTION_REDIRECT_URI + '?' + new URLSearchParams({ state: flow.state, code: 'SYNTHETIC_CODE' }), { headers: { Cookie: flow.cookie.split(';')[0]! } });
      const grant = await restarted.consume(callback()); expect(await pkceChallenge(grant.verifier)).toBe(flow.challenge);
      await expect(restarted.consume(callback())).rejects.toMatchObject({ code: 'STATE_INVALID' });
    });
  });
});

describe('B1 parâmetros OAuth preparados, sem tráfego', () => {
  it('URL de autorização usa callback idêntico, state e S256, sem inventar scopes', () => {
    const url = new URL(new RealRequestFactory().authorizationUrl({ state: 'a'.repeat(43), challenge: 'b'.repeat(43) }, 'synthetic'));
    expect(url.origin).toBe('https://auth.mercadolivre.com.br');
    expect(url.searchParams.get('redirect_uri')).toBe(PRODUCTION_REDIRECT_URI);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256'); expect(url.searchParams.has('scope')).toBe(false);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('não aceita callback diferente no corpo da troca', () => {
    expect(() => new RealRequestFactory().authorizationCode({ code: 'synthetic', verifier: 'a'.repeat(43),
      redirectUri: preparationConfig.publicOrigin + '/oauth/callback' }, 'synthetic', 'synthetic')).toThrow();
  });
  it('prepara refresh sem expor o valor em URL ou executar a rede', async () => {
    const request = new RealRequestFactory().refresh('SYNTHETIC_REFRESH', 'synthetic', 'synthetic');
    const body = new URLSearchParams(new TextDecoder().decode(await request.arrayBuffer()));
    expect(body.get('grant_type')).toBe('refresh_token'); expect(request.url).not.toContain('SYNTHETIC_REFRESH');
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});

describe('B1 adaptador com transporte sintético injetado', () => {
  it('consulta identidade, busca e detalhe usando somente fixtures candidatas', async () => {
    const { PreparedReadClient } = await import('../../src/preparation/prepared-read-client');
    const paths: string[] = [];
    const client = new PreparedReadClient('42', { send: async request => {
      const path = new URL(request.url).pathname; paths.push(path);
      return Response.json(path === '/users/me' ? draft.identity : path.startsWith('/items/') ? draft.item : draft.search);
    } });
    expect((await client.identity('synthetic')).sellerId).toBe('42');
    expect((await client.listings('synthetic', 1, 0)).ids).toEqual([draft.item.id]);
    expect((await client.item('synthetic', draft.item.id)).price.amount).toBe('129.90');
    expect(paths).toEqual(['/users/me', '/users/42/items/search', '/items/MLB0000000000']);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('cliente padrão não pode habilitar acesso real e recusa outro seller', async () => {
    const { PreparedReadClient } = await import('../../src/preparation/prepared-read-client');
    await expect(new PreparedReadClient('42').identity('synthetic')).rejects.toMatchObject({ code: 'REAL_TRANSPORT_DISABLED' });
    const client = new PreparedReadClient('99', { send: async () => Response.json(draft.item) });
    await expect(client.item('synthetic', draft.item.id)).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
