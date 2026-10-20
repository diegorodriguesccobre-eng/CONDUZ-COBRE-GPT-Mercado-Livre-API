import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const values = Object.fromEntries(readFileSync('.dev.vars', 'utf8').split('\n')
  .filter(line => /^[A-Z_]+=/.test(line)).map(line => { const pos = line.indexOf('='); return [line.slice(0, pos), line.slice(pos + 1)]; }));
const headers = { Authorization: `Bearer ${values.INTERNAL_AUTH_KEY}` };
const origin = 'http://127.0.0.1:8787';
async function get(path, init = {}) {
  const response = await fetch(origin + path, { headers, ...init });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.source, 'synthetic');
  return body.data;
}
const unauthenticated = await fetch(origin + '/internal/health');
assert.equal(unauthenticated.status, 401);
await get('/internal/health');
const flow = await get('/internal/oauth/start', { method: 'POST' });
await get(flow.synthetic_callback_path);
const replay = await fetch(origin + flow.synthetic_callback_path, { headers });
assert.equal(replay.status, 400);
const account = await get('/internal/account');
assert.equal(account.seller_id, 'SELLER_CONDUZ_SYNTHETIC');
const page = await get('/internal/listings?limit=1');
assert.equal(page.items.length, 1);
const item = await get('/internal/listings/' + page.items[0].item_id);
assert.equal(item.price.amount, '129.90');
const second = await get('/internal/listings?limit=1&cursor=' + encodeURIComponent(page.next_cursor));
assert.equal(second.items[0].item_id, 'MLB_SYNTH_002');
assert.equal(second.next_cursor, null);
console.log('Smoke HTTP local: 9 requisições verificadas; OAuth, state único, identidade, paginação e detalhe sintéticos. Nenhum segredo exibido.');
