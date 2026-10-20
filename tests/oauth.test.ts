import { describe, expect, it } from 'vitest';
import { digest, pkceChallenge, randomId } from '../src/crypto';
import { AppError } from '../src/errors';
import { OAuthService } from '../src/oauth/service';
import { SELLER_ID, type TokenRecord } from '../src/types';
import { harness, REDIRECT } from './helpers';

function callback(start: { synthetic_callback_path: string }) {
  const url = new URL(start.synthetic_callback_path, REDIRECT);
  return [url.searchParams.get('state')!, url.searchParams.get('code')!] as const;
}

describe('OAuth sintético', () => {
  it('completa Authorization Code e confirma vendedor antes de persistir', async () => {
    const h = harness();
    expect(await h.connect()).toMatchObject({ connected: true, seller_id: SELLER_ID });
    expect(h.store.tokens?.status).toBe('ready');
    expect(h.store.tokens?.ciphertext).not.toContain('SYNTHETIC_ACCESS.');
    expect(h.provider.calls).toEqual(['POST /oauth/token', 'GET /users/me']);
  });
  it('armazena somente hash do state e cifra verifier e identidade', async () => {
    const h = harness(); const start = await h.service.start('test-operator');
    const [state] = callback(start);
    expect(h.store.states.has(state)).toBe(false);
    const row = h.store.states.get(await digest(state))!;
    expect(row.ciphertext).not.toContain('test-operator');
    const flow = await h.box.open<{ verifier: string }>(row.ciphertext, 'oauth-state');
    expect(new URL(start.authorization_url).searchParams.get('code_challenge')).toBe(await pkceChallenge(flow.verifier));
  });
  it('state só pode ser consumido uma vez, inclusive com callbacks concorrentes', async () => {
    const h = harness(); const [state, code] = callback(await h.service.start('test-operator'));
    const settled = await Promise.allSettled([
      h.service.complete('test-operator', state, code), h.service.complete('test-operator', state, code)
    ]);
    expect(settled.filter(r => r.status === 'fulfilled')).toHaveLength(1);
    expect(settled.filter(r => r.status === 'rejected')).toHaveLength(1);
    expect(h.provider.calls.filter(c => c === 'POST /oauth/token')).toHaveLength(1);
  });
  it('rejeita state expirado antes da troca de código', async () => {
    const h = harness(); const [state, code] = callback(await h.service.start('test-operator'));
    h.clock.now += 300_000;
    await expect(h.service.complete('test-operator', state, code)).rejects.toMatchObject({ code: 'STATE_INVALID' });
    expect(h.provider.calls).toHaveLength(0);
  });
  it('rejeita state inventado', async () => {
    const h = harness();
    await expect(h.service.complete('test-operator', randomId(), 'synthetic-code')).rejects.toMatchObject({ code: 'STATE_INVALID' });
  });
  it('vincula state ao operador que iniciou o fluxo', async () => {
    const h = harness(); const [state, code] = callback(await h.service.start('original'));
    await expect(h.service.complete('different', state, code)).rejects.toMatchObject({ code: 'STATE_INVALID' });
    expect(h.provider.calls).toHaveLength(0);
  });
  it('rejeita código sem o verifier correto (PKCE)', async () => {
    const h = harness(); const verifier = randomId();
    const code = await h.provider.authorizationCode(await pkceChallenge(verifier), REDIRECT);
    await expect(h.client.exchange(new URLSearchParams({ grant_type: 'authorization_code', code,
      redirect_uri: REDIRECT, code_verifier: randomId() }))).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
  it('rejeita redirect_uri divergente', async () => {
    const h = harness(); const verifier = randomId();
    const code = await h.provider.authorizationCode(await pkceChallenge(verifier), REDIRECT);
    await expect(h.client.exchange(new URLSearchParams({ grant_type: 'authorization_code', code,
      redirect_uri: 'http://localhost:8787/other', code_verifier: verifier }))).rejects.toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
  it('não ativa tokens se /users/me indicar outro vendedor', async () => {
    const h = harness(provider => ({ send: req => new URL(req.url).pathname === '/users/me'
      ? Promise.resolve(Response.json({ id: 'SELLER_NOT_AUTHORIZED' })) : provider.send(req) }));
    await expect(h.connect()).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
    expect(h.store.tokens).toBeUndefined();
  });
  it('não ativa tokens se emissão indicar outro vendedor', async () => {
    const h = harness(provider => ({ send: async req => {
      const response = await provider.send(req);
      if (new URL(req.url).pathname !== '/oauth/token') return response;
      const token = await response.json() as Record<string, unknown>;
      return Response.json({ ...token, user_id: 'SELLER_NOT_AUTHORIZED' });
    } }));
    await expect(h.connect()).rejects.toMatchObject({ code: 'SELLER_MISMATCH' });
    expect(h.store.tokens).toBeUndefined();
  });
});

describe('renovação coordenada', () => {
  it('exige conexão antes de consultar dados', async () => {
    await expect(harness().service.account()).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  });
  it('renova uma única vez para vinte leituras concorrentes', async () => {
    const h = harness(); await h.connect(); h.clock.now += 100_000;
    const accounts = await Promise.all(Array.from({ length: 20 }, () => h.service.account()));
    expect(accounts.every(a => a.seller_id === SELLER_ID)).toBe(true);
    expect(h.provider.calls.filter(c => c === 'POST /oauth/token')).toHaveLength(2);
    const record = await h.box.open<TokenRecord>(h.store.tokens!.ciphertext, 'tokens');
    expect(record.generation).toBe(2);
  });
  it('mantém tokens cifrados e preserva conexão após reconstruir serviço', async () => {
    const h = harness(); await h.connect();
    const restarted = new OAuthService(h.store, h.box, h.client, h.provider, REDIRECT, h.now);
    expect(await restarted.account()).toMatchObject({ seller_id: SELLER_ID });
  });
  it('renova em 401 e repete a leitura no máximo uma vez', async () => {
    let unauthorized = false;
    const h = harness(provider => ({ send: req => unauthorized && new URL(req.url).pathname === '/users/me'
      ? Promise.resolve(Response.json({ error: 'expired' }, { status: 401 })) : provider.send(req) }));
    await h.connect(); unauthorized = true;
    await expect(h.service.account()).rejects.toMatchObject({ code: 'UPSTREAM_UNAUTHORIZED' });
    expect(h.provider.calls.filter(c => c === 'POST /oauth/token')).toHaveLength(2);
  });
  it('bloqueia renovação incerta e não repete refresh após reiniciar', async () => {
    let failRefresh = false; let refreshCalls = 0;
    const h = harness(provider => ({ send: async req => {
      if (failRefresh && new URL(req.url).pathname === '/oauth/token') {
        refreshCalls++; throw new Error('SYNTHETIC_SECRET_MUST_NOT_ESCAPE');
      }
      return provider.send(req);
    } }));
    await h.connect(); failRefresh = true; h.clock.now += 100_000;
    await expect(h.service.account()).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    expect(h.store.tokens?.status).toBe('refreshing');
    const restarted = new OAuthService(h.store, h.box, h.client, h.provider, REDIRECT, h.now);
    await expect(restarted.account()).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    expect(refreshCalls).toBe(1);
  });
  it('falha de persistência após emissão conserva marcador de reconexão', async () => {
    const h = harness(); await h.connect(); h.clock.now += 100_000;
    const original = h.store.putTokens.bind(h.store);
    h.store.putTokens = row => {
      if (row.status === 'ready') throw new AppError('STORAGE_FAILURE', 500, 'synthetic');
      original(row);
    };
    await expect(h.service.account()).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
    expect(h.store.tokens?.status).toBe('refreshing');
  });
  it('usa expires_in sem duração fixa e conserva refresh token rotacionado', async () => {
    const h = harness(); await h.connect();
    const before = await h.box.open<TokenRecord>(h.store.tokens!.ciphertext, 'tokens');
    expect(before.expiresAt).toBe(h.clock.now + 120000);
    h.clock.now += 100_000; await h.service.account();
    const after = await h.box.open<TokenRecord>(h.store.tokens!.ciphertext, 'tokens');
    expect(after.refreshToken).not.toBe(before.refreshToken);
  });
});
