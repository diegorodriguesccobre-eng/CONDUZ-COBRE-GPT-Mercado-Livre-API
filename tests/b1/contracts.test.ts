import { describe, expect, it } from 'vitest';
import * as validate from '../../.wrangler/contracts/validators.mjs';
import openapi from '../../contracts/preparation/openapi.json';
import entrypoint from '../../src/preparation/entrypoint';
import { PRODUCTION_ORIGIN, CALLBACK_PATH, PRODUCTION_REDIRECT_URI } from '../../src/preparation/config';
import { RealRequestFactory } from '../../src/preparation/real-http-transport';

describe('B1 contratos do callback registrado e isolamento', () => {
  it('OpenAPI aponta exatamente ao origin e callback confirmados', () => {
    expect(openapi.servers[0]!.url).toBe(PRODUCTION_ORIGIN);
    expect(openapi.paths[CALLBACK_PATH]).toBeDefined();
    expect(openapi['x-production-oauth-enabled']).toBe(false); expect(openapi['x-real-transport-enabled']).toBe(false);
    expect(openapi.security).toEqual([{ accessIdentity: [] }]);
    expect(openapi.paths[CALLBACK_PATH].get.security).toEqual([{ browserSession: [] }]);
  });
  it.each(['/oauth/start', CALLBACK_PATH, '/internal/account'])('resposta fechada em %s segue JSON Schema', async path => {
    const response = await entrypoint.fetch(new Request(PRODUCTION_ORIGIN + path));
    expect(response.status).toBe(503); expect(validate.preparationDisabled(await response.json())).toBe(true);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
  it('redirect do consentimento e da troca de código é byte a byte idêntico', async () => {
    const factory = new RealRequestFactory();
    const url = new URL(factory.authorizationUrl({ state: 'a'.repeat(43), challenge: 'b'.repeat(43) }, 'synthetic'));
    const req = factory.authorizationCode({ code: 'synthetic', verifier: 'a'.repeat(43), redirectUri: PRODUCTION_REDIRECT_URI }, 'synthetic', 'synthetic');
    const body = new URLSearchParams(new TextDecoder().decode(await req.arrayBuffer()));
    expect(url.searchParams.get('redirect_uri')).toBe(PRODUCTION_REDIRECT_URI);
    expect(body.get('redirect_uri')).toBe(PRODUCTION_REDIRECT_URI);
  });
});
