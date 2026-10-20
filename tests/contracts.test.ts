import { exports } from 'cloudflare:workers';
import { reset } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import * as validate from '../.wrangler/contracts/validators.mjs';
import openapi from '../contracts/v1/openapi.json';
import { TEST_AUTH } from './helpers';
const headers = { Authorization: `Bearer ${TEST_AUTH}` };
const request = (path: string, init: RequestInit = {}) => exports.default.fetch(`http://localhost${path}`, { headers, ...init });
beforeEach(async () => { await reset(); });

describe('contratos v1: respostas executadas do Worker', () => {
  it('health segue JSON Schema versionado', async () => {
    const response = await request('/internal/health');
    expect(response.status).toBe(200);
    expect(validate.health(await response.json())).toBe(true);
  });
  it('OAuth start e callback seguem seus contratos, sem campos extras', async () => {
    const response = await request('/internal/oauth/start', { method: 'POST' });
    const body = await response.json() as { data: { synthetic_callback_path: string } };
    expect(validate.oauthStart(body)).toBe(true);
    const callback = await request(body.data.synthetic_callback_path);
    expect(callback.status).toBe(200);
    expect(validate.oauthCallback(await callback.json())).toBe(true);
  });
  it('identidade, anúncios e detalhe seguem os schemas correspondentes', async () => {
    const response = await request('/internal/oauth/start', { method: 'POST' });
    const body = await response.json() as { data: { synthetic_callback_path: string } };
    expect((await request(body.data.synthetic_callback_path)).status).toBe(200);
    const account = await request('/internal/account');
    const listings = await request('/internal/listings');
    const listing = await request('/internal/listings/MLB_SYNTH_001');
    expect(validate.account(await account.json())).toBe(true);
    expect(validate.listings(await listings.json())).toBe(true);
    expect(validate.listing(await listing.json())).toBe(true);
  });
  it.each([['/internal/account', 409], ['/missing', 404], ['/internal/listings?limit=0', 400]])
  ('erros de %s seguem schema de erro', async (path, status) => {
    const response = await request(String(path));
    expect(response.status).toBe(status);
    expect(validate.error(await response.json())).toBe(true);
  });
  it('schema rejeita tokens e versão incompatível', async () => {
    const body = await (await request('/internal/health')).json() as Record<string, unknown>;
    expect(validate.health({ ...body, access_token: 'SYNTHETIC_MUST_BE_REJECTED' })).toBe(false);
    expect(validate.health({ ...body, schema_version: '2.0.0' })).toBe(false);
    expect(validate.health({ ...body, fetched_at: 'invalid' })).toBe(false);
    expect(validate.health({ ...body, request_id: 'not-a-uuid' })).toBe(false);
  });
  it('OpenAPI expõe apenas rotas fechadas e exige autenticação em todas', () => {
    expect(openapi.openapi).toBe('3.1.0');
    expect(openapi.security).toEqual([{ internalBearer: [] }]);
    const ids: string[] = [];
    for (const [path, operations] of Object.entries(openapi.paths)) {
      expect(path.startsWith('/internal/')).toBe(true);
      for (const [method, value] of Object.entries(operations)) {
        const operation = value as { operationId: string; security?: unknown[]; responses: Record<string, unknown> };
        expect(method === 'get' || (method === 'post' && path === '/internal/oauth/start')).toBe(true);
        expect(operation.security).not.toEqual([]);
        expect(operation.responses['200']).toBeDefined();
        expect(operation.responses['401']).toBeDefined();
        ids.push(operation.operationId);
      }
    }
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
