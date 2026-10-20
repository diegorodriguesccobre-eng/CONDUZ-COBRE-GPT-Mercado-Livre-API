import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const local = JSON.parse(readFileSync('wrangler.jsonc', 'utf8'));
const production = JSON.parse(readFileSync('wrangler.production.jsonc', 'utf8'));
const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
test('B0 mantém Worker, entrypoint, callback e transporte locais', () => {
  assert.equal(local.name, 'conduz-cobre-b0-synthetic'); assert.equal(local.main, 'src/index.ts');
  assert.equal(local.vars.TRANSPORT, 'synthetic');
  assert.equal(local.vars.OAUTH_REDIRECT_URI, 'http://localhost:8787/internal/oauth/callback');
});
test('produção usa exatamente Worker e callback confirmados, com namespace SQLite próprio', () => {
  assert.equal(production.name, 'conduz-cobre-ml-api'); assert.equal(production.main, 'src/preparation/entrypoint.ts');
  assert.equal(production.vars.PREPARATION_CONFIG.redirectUri, 'https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback');
  assert.equal(production.vars.PREPARATION_CONFIG.transport, 'disabled');
  assert.notEqual(production.durable_objects.bindings[0].name, local.durable_objects.bindings[0].name);
  assert.deepEqual(production.migrations[0].new_sqlite_classes, ['BrowserOAuthVault']);
  assert.equal(production.preview_urls, false);
  assert.equal(production.observability.enabled, false);
});
test('CI fixa Actions oficiais em SHA, usa Node24, remove credenciais persistidas e não implanta', () => {
  assert.match(workflow, /actions\/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1/);
  assert.match(workflow, /actions\/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1/);
  assert.match(workflow, /persist-credentials: false/); assert.match(workflow, /node-version: '24'/);
  assert.doesNotMatch(workflow, /pull_request_target|secrets\.|id-token:\s*write|contents:\s*write|wrangler deploy|CLOUDFLARE_API_TOKEN/);
  assert.match(workflow, /npm run build:production/);
});
