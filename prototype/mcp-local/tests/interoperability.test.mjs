import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { writeFile } from 'node:fs/promises';
import { startLocal, dataOf } from '../scripts/local-harness.mjs';
import { createSyntheticAccess, INJECTION_TEXT } from '../work/unit/synthetic.mjs';
import { result } from '../work/unit/server.mjs';

let local;
before(async () => { local = await startLocal(); });
after(async () => {
  if (local) {
    assert.equal(local.outboundAttempts(), 0);
    await writeFile('work/test-wire.json', JSON.stringify({ outbound_attempts: local.outboundAttempts(), exchanges: local.wire }, null, 2) + '\n');
    await local.close();
  }
});
async function rejectedTool(client, name, args) {
  try { const response = await client.callTool({ name, arguments: args }); assert.equal(response.isError, true); return response; }
  catch (error) { if (error.code === 'ERR_ASSERTION') throw error; return { protocol_rejection: true }; }
}

for (const [profile, mode] of [['2026-07-28', { pin: '2026-07-28' }], ['2025 compatibility', 'legacy']]) {
  describe(profile, () => {
    it('discovers exactly three read tools with closed input/output schemas', async () => {
      const client = await local.connect('synthetic-operator-a', mode);
      try {
        assert.equal(client.getNegotiatedProtocolVersion(), profile === '2026-07-28' ? '2026-07-28' : '2025-11-25');
        const discovery = await client.listTools();
        assert.deepEqual(discovery.tools.map(t => t.name).sort(), ['account', 'listing', 'listings']);
        for (const tool of discovery.tools) {
          assert.equal(tool.inputSchema.additionalProperties, false);
          assert.equal(tool.outputSchema.additionalProperties, false);
          assert.equal(tool.annotations.readOnlyHint, true);
          assert.equal(tool.annotations.destructiveHint, false);
        }
      } finally { await client.close(); }
    });
    for (const suffix of ['a', 'b']) {
      it(`operator ${suffix} reads its account, pages and item over HTTP`, async () => {
        const client = await local.connect('synthetic-operator-' + suffix, mode);
        try {
          const account = dataOf(await client.callTool({ name: 'account', arguments: { account_ref: 'account-' + suffix } }));
          assert.equal(account.data.account_ref, 'account-' + suffix);
          const first = dataOf(await client.callTool({ name: 'listings', arguments: { account_ref: 'account-' + suffix, limit: 1 } }));
          assert.equal(first.data.ids.length, 1); assert.equal(first.data.next_offset, 1);
          const second = dataOf(await client.callTool({ name: 'listings', arguments: { account_ref: 'account-' + suffix, limit: 1, offset: 1 } }));
          assert.equal(second.data.ids.length, 1); assert.notEqual(first.data.ids[0], second.data.ids[0]); assert.equal(second.data.next_offset, null);
          const item = dataOf(await client.callTool({ name: 'listing', arguments: { account_ref: 'account-' + suffix, item_id: first.data.ids[0] } }));
          assert.equal(item.data.item_id, first.data.ids[0]); assert.equal(item.source, 'synthetic'); assert.equal(item.untrusted_data, true);
        } finally { await client.close(); }
      });
      it(`operator ${suffix} cannot read the other account or select its item through its own account`, async () => {
        const other = suffix === 'a' ? 'b' : 'a';
        const client = await local.connect('synthetic-operator-' + suffix, mode);
        try {
          for (const tool of ['account', 'listings', 'listing']) {
            const denied = await rejectedTool(client, tool, { account_ref: 'account-' + other,
              ...(tool === 'listing' ? { item_id: `MLB_SYNTH_${other.toUpperCase()}_001` } : {}) });
            assert.equal(denied.isError, true);
            assert.ok(!JSON.stringify(denied).includes('PRIVATE-TO-B'));
          }
          assert.equal((await rejectedTool(client, 'listing', { account_ref: 'account-' + suffix,
            item_id: `MLB_SYNTH_${other.toUpperCase()}_001` })).isError, true);
        } finally { await client.close(); }
      });
    }
    it('preserves adversarial listing text as data and does not change account authorization', async () => {
      const client = await local.connect('synthetic-operator-a', mode);
      try {
        const item = dataOf(await client.callTool({ name: 'listing', arguments: { account_ref: 'account-a', item_id: 'MLB_SYNTH_A_001' } }));
        assert.equal(item.data.title, INJECTION_TEXT); assert.equal(item.untrusted_data, true);
        assert.equal((await rejectedTool(client, 'account', { account_ref: 'account-b' })).isError, true);
      } finally { await client.close(); }
    });
    it('concurrent calls do not mix identities or account data', async () => {
      const clients = await Promise.all(['a', 'b'].map(s => local.connect('synthetic-operator-' + s, mode)));
      try {
        await Promise.all(Array.from({ length: 12 }, async (_, i) => {
          const suffix = i % 2 === 0 ? 'a' : 'b';
          const value = dataOf(await clients[i % 2].callTool({ name: 'account', arguments: { account_ref: 'account-' + suffix } }));
          assert.equal(value.data.account_ref, 'account-' + suffix);
        }));
      } finally { await Promise.all(clients.map(c => c.close())); }
    });
    it('denies unknown/commercial write tools and unknown account', async () => {
      const client = await local.connect('synthetic-operator-a', mode);
      try {
        for (const name of ['delete', 'update', 'connect', 'proxy', '__proto__']) await rejectedTool(client, name, {});
        await rejectedTool(client, 'account', { account_ref: 'account-z' });
      } finally { await client.close(); }
    });
    it('rejects missing, extra, mistyped, overlong and out-of-range arguments', async () => {
      const client = await local.connect('synthetic-operator-a', mode);
      try {
        for (const [name, args] of [
          ['account', {}], ['account', { account_ref: 'account-a', seller_id: 'OTHER' }],
          ['account', { account_ref: 'a'.repeat(1000) }],
          ['listings', { account_ref: 'account-a', limit: 0 }], ['listings', { account_ref: 'account-a', limit: 21 }],
          ['listings', { account_ref: 'account-a', limit: '1' }], ['listings', { account_ref: 'account-a', offset: -1 }],
          ['listing', { account_ref: 'account-a', item_id: 'https://evil.invalid/' }],
          ['listing', { account_ref: 'account-a', item_id: 'MLB_SYNTH_A_001', url: 'https://evil.invalid/' }]
        ]) await rejectedTool(client, name, args);
      } finally { await client.close(); }
    });
  });
}

describe('HTTP authentication and bounds', () => {
  it('rejects missing assertions, fake JWT and forged email/Bearer', async () => {
    for (const token of ['', 'invalid.jwt.signature']) {
      const response = await local.raw({ token, headers: { 'Cf-Access-Authenticated-User-Email': 'admin@example.invalid', Authorization: 'Bearer synthetic' }, body: {} });
      assert.equal(response.status, 401);
    }
  });
  for (const [name, claims] of Object.entries({ issuer: { iss: 'https://other.cloudflareaccess.com' }, audience: { aud: 'other' },
    expired: { exp: 1 }, future: { iat: Math.floor(Date.now() / 1000) + 1000 }, machine: { type: 'service' }, subject: { sub: 'unknown' } })) {
    it(`rejects signed but invalid ${name}`, async () => {
      const response = await local.raw({ token: await local.assertion('synthetic-operator-a', claims), body: {} });
      assert.equal(response.status, 401);
    });
  }
  it('rejects a tampered RS256 signature', async () => {
    const parts = (await local.assertion()).split('.');
    parts[2] = (parts[2][0] === 'A' ? 'B' : 'A') + parts[2].slice(1);
    assert.equal((await local.raw({ token: parts.join('.'), body: {} })).status, 401);
  });
  it('rejects external Origin and Host', async () => {
    assert.equal((await local.raw({ headers: { Origin: 'https://evil.invalid' }, body: {} })).status, 403);
    const token = await local.assertion();
    const hostStatus = await new Promise((resolve, reject) => {
      const request = httpRequest(local.url, { method: 'POST', headers: { Host: 'evil.invalid',
        'Content-Type': 'application/json', 'Content-Length': '2', 'Cf-Access-Jwt-Assertion': token } }, response => {
        response.resume(); response.on('end', () => resolve(response.statusCode));
      });
      request.on('error', reject); request.end('{}');
    });
    assert.equal(hostStatus, 403);
  });
  it('does not expose OAuth, proxy, alternative routes or account selectors in query', async () => {
    for (const path of ['/oauth/start', '/oauth/mercadolivre/callback', '/internal/proxy', '/mcp?account_ref=account-b']) {
      assert.equal((await local.raw({ path, body: {} })).status, 404);
    }
  });
  it('rejects wrong HTTP methods and media type', async () => {
    assert.equal((await local.raw({ method: 'PUT', body: {} })).status, 405);
    assert.equal((await local.raw({ headers: { 'Content-Type': 'text/plain' }, body: '{}' })).status, 415);
    assert.equal((await local.raw({ method: 'GET' })).status, 405);
  });
  it('malformed JSON and unknown JSON-RPC methods produce protocol errors', async () => {
    const badJson = await local.raw({ body: '{' });
    assert.ok(badJson.status >= 400);
    const unknown = await local.raw({ body: { jsonrpc: '2.0', id: 9, method: 'commercial/write' } });
    const text = await unknown.text(); assert.ok(text.includes('error')); assert.ok(!text.includes('PRIVATE-TO-B'));
  });
  it('caps uploaded bytes and applies no-store headers', async () => {
    const response = await local.raw({ body: JSON.stringify({ padding: 'x'.repeat(17000) }) });
    assert.equal(response.status, 413); assert.equal(response.headers.get('Cache-Control'), 'no-store');
  });
  it('terminates an incomplete HTTP upload within the body deadline', async () => {
    const token = await local.assertion();
    const status = await new Promise((resolve, reject) => {
      const request = httpRequest(local.url, { method: 'POST', headers: {
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream',
        'Transfer-Encoding': 'chunked', 'Cf-Access-Jwt-Assertion': token
      } }, response => {
        response.resume(); response.on('end', () => { resolve(response.statusCode); request.destroy(); });
      });
      request.on('error', reject); request.setTimeout(5000, () => { request.destroy(); reject(new Error('TEST_UPLOAD_NOT_BOUNDED')); });
      request.write('{'); // Deliberately no end(): the worker must terminate its own read.
    });
    assert.equal(status, 408);
  });
  it('requires the local synthetic switch', async () => {
    const disabled = await startLocal({ enabled: false });
    try { assert.equal((await disabled.raw({ body: {} })).status, 503); } finally { await disabled.close(); }
  });
});

describe('in-memory policy and result safety', () => {
  it('read does not grant connect; revocation denies the next operation while JWT stays valid', async () => {
    const h = await createSyntheticAccess(local.jwks);
    const request = new Request(local.url, { headers: { 'Cf-Access-Jwt-Assertion': await local.assertion() } });
    const identity = await h.access.authenticate(request, 'account-a', 'read');
    await assert.rejects(h.access.authenticate(request, 'account-a', 'connect'));
    h.policy.revoke('account-a', identity.subject);
    await h.verifier.authenticate(request);
    await assert.rejects(h.access.authenticate(request, 'account-a', 'read'));
    assert.equal((await h.policy.permissions('account-a', identity.subject)).length, 0);
  });
  it('policy storage failure closes access without exposing exception text', async () => {
    const h = await createSyntheticAccess(local.jwks);
    h.policy.permissions = async () => { throw new Error('SYNTHETIC_PRIVATE_MARKER'); };
    const request = new Request(local.url, { headers: { 'Cf-Access-Jwt-Assertion': await local.assertion() } });
    await assert.rejects(h.access.authenticate(request, 'account-a', 'read'), error => error.code === 'ACCESS_DENIED' && !error.message.includes('PRIVATE_MARKER'));
  });
  it('limits serialized UTF-8 response bytes, not only character count', () => {
    assert.throws(() => result({ title: 'é'.repeat(4096) }), /RESPONSE_LIMIT/);
    assert.equal(result({ title: INJECTION_TEXT }).structuredContent.untrusted_data, true);
  });
});
