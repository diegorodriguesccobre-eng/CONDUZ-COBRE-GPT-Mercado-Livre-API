import { mkdirSync, writeFileSync } from 'node:fs';
const root = 'contracts/v1';
mkdirSync(root, { recursive: true });
const schema = 'https://json-schema.org/draft/2020-12/schema';
const base = 'https://schemas.conduz-cobre.invalid/v1/';
const string = { type: 'string' };
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', additionalProperties: false, properties, required });
const common = {
  $schema: schema, $id: `${base}common.schema.json`,
  $defs: {
    listing: object({ item_id: { type: 'string', pattern: '^MLB_SYNTH_00[123]$' }, title: { type: 'string', maxLength: 200 },
      status: { enum: ['active', 'paused'] }, price: object({ amount: { type: 'string', pattern: '^\\d{1,12}\\.\\d{2}$' }, currency: { const: 'BRL' } }),
      available_quantity: { type: 'integer', minimum: 0 } }),
    account: object({ account_ref: { const: 'conduz-cobre-b0' }, seller_id: { const: 'SELLER_CONDUZ_SYNTHETIC' }, nickname: string })
  }
};
const defs = {
  health: object({ status: { const: 'ok' }, transport: { const: 'synthetic' } }),
  'oauth-start': object({ authorization_url: { type: 'string', format: 'uri', pattern: '^https://oauth\\.synthetic\\.invalid/authorize\\?' },
    synthetic_callback_path: { type: 'string', pattern: '^/internal/oauth/callback\\?' }, expires_in: { const: 300 }, pkce_method: { const: 'S256' } }),
  'oauth-callback': object({ connected: { const: true }, account_ref: { const: 'conduz-cobre-b0' }, seller_id: { const: 'SELLER_CONDUZ_SYNTHETIC' } }),
  account: { $ref: `${base}common.schema.json#/$defs/account` },
  listing: { $ref: `${base}common.schema.json#/$defs/listing` },
  listings: object({ items: { type: 'array', maxItems: 20, items: { $ref: `${base}common.schema.json#/$defs/listing` } },
    next_cursor: { type: ['string', 'null'], maxLength: 2048 }, completeness: { const: 'complete' } })
};
function save(name, value) { writeFileSync(`${root}/${name}`, JSON.stringify(value, null, 2) + '\n'); }
save('common.schema.json', common);
for (const [name, data] of Object.entries(defs)) {
  save(`${name}.schema.json`, { $schema: schema, $id: `${base}${name}.schema.json`,
    ...object({ schema_version: { const: '1.0.0' }, source: { const: 'synthetic' }, operation: { const: 'conduz_cobre' },
      account_ref: { const: 'conduz-cobre-b0' }, fetched_at: { type: 'string', format: 'date-time' },
      request_id: { type: 'string', format: 'uuid' }, data }) });
}
save('error.schema.json', { $schema: schema, $id: `${base}error.schema.json`,
  ...object({ schema_version: { const: '1.0.0' }, source: { const: 'synthetic' }, request_id: { type: 'string', format: 'uuid' },
    error: object({ code: { type: 'string', pattern: '^[A-Z_]+$' }, message: string, retryable: { type: 'boolean' } }) }) });
const query = (name, value) => ({ in: 'query', name, required: false, schema: value });
const paths = [
  ['/internal/health', 'get', 'health', 'getSyntheticHealth', []],
  ['/internal/oauth/start', 'post', 'oauth-start', 'startSyntheticOAuth', []],
  ['/internal/oauth/callback', 'get', 'oauth-callback', 'completeSyntheticOAuth', [
    { ...query('state', { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$' }), required: true },
    { ...query('code', { type: 'string', minLength: 20, maxLength: 4096 }), required: true }]],
  ['/internal/account', 'get', 'account', 'getAccountSummary', []],
  ['/internal/listings', 'get', 'listings', 'listOwnListings', [query('limit', { type: 'integer', minimum: 1, maximum: 20, default: 20 }), query('cursor', { type: 'string', minLength: 1, maxLength: 2048 })]],
  ['/internal/listings/{item_id}', 'get', 'listing', 'getOwnListing', [{ in: 'path', name: 'item_id', required: true, schema: { type: 'string', pattern: '^MLB_SYNTH_00[123]$' } }]]
];
const content = name => ({ 'application/json': { schema: { $ref: `./${name}.schema.json` } } });
save('openapi.json', {
  openapi: '3.1.0', info: { title: 'CONDUZ COBRE B0 — exclusivamente sintético', version: '1.0.0',
    description: 'Contrato interno proposto. Fixtures não representam respostas oficiais. Sem integração externa ou implantação.' },
  servers: [{ url: 'http://localhost:8787', description: 'Apenas desenvolvimento local' }],
  security: [{ internalBearer: [] }],
  components: { securitySchemes: { internalBearer: { type: 'http', scheme: 'bearer', description: 'Chave interna B0; nunca um token Mercado Livre.' } } },
  paths: Object.fromEntries(paths.map(([path, method, name, operationId, parameters]) => [path, { [method]: {
    operationId, parameters,
    responses: { '200': { description: 'Resposta exclusivamente sintética', content: content(name) },
      ...Object.fromEntries(['400', '401', '403', '404', '405', '409', '429', '500', '502', '503', '504'].map(code => [code, { description: 'Erro saneado', content: content('error') }])) }
  } }]))
});
console.log('Contratos v1 gerados; nenhum serviço externo acessado.');
