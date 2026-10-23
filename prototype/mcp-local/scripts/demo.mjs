import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { startLocal, dataOf, usingLocal } from './local-harness.mjs';
import { expectReadDenied, expectUnknownTool } from './rejections.mjs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export async function runDemo({ start = startLocal,
  save = report => writeFile('work/interoperability.json', JSON.stringify(report, null, 2) + '\n') } = {}) {
  const local = await start();
  const report = { transport: 'Streamable HTTP over loopback TCP', runtime: 'workerd', oauth: 'not configured', profiles: [] };
  return usingLocal(local, async () => {
    for (const [profile, mode] of [['2026-07-28', { pin: '2026-07-28' }], ['2025 compatibility', 'legacy']]) {
      const client = await local.connect('synthetic-operator-a', mode);
      try {
        const discovery = await client.listTools();
        assert.deepEqual(discovery.tools.map(tool => tool.name).sort(), ['account', 'listing', 'listings']);
        const account = dataOf(await client.callTool({ name: 'account', arguments: { account_ref: 'account-a' } }));
        assert.equal(account.data.account_ref, 'account-a');
        const listings = dataOf(await client.callTool({ name: 'listings', arguments: { account_ref: 'account-a', limit: 1 } }));
        const listing = dataOf(await client.callTool({ name: 'listing', arguments: { account_ref: 'account-a', item_id: listings.data.ids[0] } }));
        const denied = await expectReadDenied(client, 'account', { account_ref: 'account-b' });
        await expectUnknownTool(client, 'delete');
        report.profiles.push({ profile, negotiated_protocol: client.getNegotiatedProtocolVersion(), era: client.getProtocolEra(),
          server: client.getServerVersion(), discovered_tools: discovery.tools.map(tool => tool.name),
          account: account.data, listings: listings.data, listing: listing.data,
          listing_is_untrusted_data: listing.untrusted_data, cross_account_denied: denied.isError, unknown_tool_denied: true });
      } finally { await client.close(); }
    }
    assert.equal(local.outboundAttempts(), 0);
    report.outbound_attempts = local.outboundAttempts();
    report.wire = local.wire;
    await save(report);
    return report;
  });
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await runDemo();
  console.log(JSON.stringify({ profiles: report.profiles.map(p => ({ profile: p.profile, negotiated_protocol: p.negotiated_protocol, tools: p.discovered_tools,
    cross_account_denied: p.cross_account_denied, unknown_tool_denied: p.unknown_tool_denied })), outbound_attempts: report.outbound_attempts }));
}
