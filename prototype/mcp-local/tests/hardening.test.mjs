import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { ProtocolError, ProtocolErrorCode } from '@modelcontextprotocol/client';
import { expectReadDenied, expectInvalidArguments, expectUnknownTool, expectRpcError } from '../scripts/rejections.mjs';
import { startLocal, usingLocal } from '../scripts/local-harness.mjs';

const denied = { isError: true, content: [{ type: 'text', text: 'SYNTHETIC_READ_DENIED' }] };
const schema = { isError: true, content: [{ type: 'text', text: 'Input validation error: Invalid arguments for tool account: account_ref required' }] };
const call = async outcome => ({ callTool: async () => outcome });
const validators = [
  ['authorization', client => expectReadDenied(client, 'account', { account_ref: 'account-b' })],
  ['schema', client => expectInvalidArguments(client, 'account', {})],
  ['unknown tool', client => expectUnknownTool(client, 'delete')]
];
describe('negative results require their exact rejection contract', () => {
  for (const code of ['ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT', 'ENETUNREACH']) {
    for (const [label, validate] of validators) {
      it(`${label} propagates ${code} instead of accepting a denial`, async () => {
        const failure = Object.assign(new Error('SYNTHETIC_TRANSPORT_FAILURE'), { code });
        await assert.rejects(validate({ callTool: async () => { throw failure; } }), error => error === failure);
      });
    }
  }
  for (const [label, validate] of validators) {
    it(`${label} propagates timeout, fetch and HTTP availability failures`, async () => {
      for (const failure of [new DOMException('SYNTHETIC_TIMEOUT', 'TimeoutError'), new TypeError('fetch failed'), new Error('HTTP 503 unavailable')]) {
        await assert.rejects(validate({ callTool: async () => { throw failure; } }), error => error === failure);
      }
    });
  }
  it('does not interchange authorization, schema and JSON-RPC rejections', async () => {
    await expectReadDenied(await call(denied), 'account', {});
    await expectInvalidArguments(await call(schema), 'account', {});
    const unknown = new ProtocolError(ProtocolErrorCode.InvalidParams, 'Tool delete not found');
    const client = { callTool: async () => { throw unknown; } };
    await expectUnknownTool(client, 'delete');
    await assert.rejects(expectReadDenied(await call(schema), 'account', {}), { code: 'ERR_ASSERTION' });
    await assert.rejects(expectInvalidArguments(await call(denied), 'account', {}), { code: 'ERR_ASSERTION' });
    await assert.rejects(expectReadDenied(client, 'account', {}), error => error === unknown);
    await assert.rejects(expectUnknownTool(await call(denied), 'delete'), { code: 'ERR_ASSERTION' });
  });
  it('rejects false success, leaked data and unrelated tool errors', async () => {
    for (const result of [{ ...denied, isError: false }, { ...denied, structuredContent: { account: 'PRIVATE' } },
      { isError: true, content: [{ type: 'text', text: 'INTERNAL_ERROR' }] }]) {
      await assert.rejects(expectReadDenied(await call(result), 'account', {}), { code: 'ERR_ASSERTION' });
    }
  });
  it('rejects fake ProtocolError identity, wrong JSON-RPC code and wrong message', async () => {
    const fake = Object.assign(new Error('Tool delete not found'), { name: 'ProtocolError', code: -32602 });
    await assert.rejects(expectUnknownTool({ callTool: async () => { throw fake; } }, 'delete'), error => error === fake);
    for (const error of [new ProtocolError(-32603, 'Tool delete not found'), new ProtocolError(-32602, 'Internal failure'),
      new ProtocolError(-32602, 'Tool delete not found', { private: 'SYNTHETIC_DATA' })]) {
      await assert.rejects(expectUnknownTool({ callTool: async () => { throw error; } }, 'delete'), { code: 'ERR_ASSERTION' });
    }
  });
  it('requires exact HTTP status, JSON-RPC envelope, id, code and message', async () => {
    const expected = { status: 400, id: null, code: -32700, message: 'Parse error: Invalid JSON' };
    const error = { code: expected.code, message: expected.message };
    for (const [status, json] of [[503, { jsonrpc: '2.0', id: null, error }],
      [400, { jsonrpc: '2.0', id: 9, error }], [400, { jsonrpc: '2.0', id: null, error: { ...error, code: -32603 } }],
      [400, { jsonrpc: '2.0', id: null, error: { ...error, message: 'unavailable' } }],
      [400, { error: 'unavailable' }], [400, { jsonrpc: '2.0', id: null, error, result: {} }]]) {
      await assert.rejects(expectRpcError(Response.json(json, { status }), expected), { code: 'ERR_ASSERTION' });
    }
  });
  it('does not accept ECONNRESET while reading an error body', async () => {
    const reset = Object.assign(new Error('SYNTHETIC_BODY_RESET'), { code: 'ECONNRESET' });
    const response = new Response(new ReadableStream({ start(controller) { controller.error(reset); } }), {
      status: 400, headers: { 'Content-Type': 'application/json' }
    });
    await assert.rejects(expectRpcError(response, { status: 400, id: null, code: -32700, message: 'Parse error: Invalid JSON' }), error => error === reset);
  });
});

describe('real HTTP client faults cannot satisfy negative expectations', () => {
  for (const [profile, mode] of [['2026-07-28', { pin: '2026-07-28' }], ['2025-11-25', 'legacy']]) {
    it(`propagates injected ECONNRESET on tools/call in ${profile}`, async () => {
      const reset = Object.assign(new Error('SYNTHETIC_HTTP_RESET'), { code: 'ECONNRESET' });
      const local = await startLocal({}, { fetch: (input, init) => {
        if (JSON.parse(init.body ?? '{}').method === 'tools/call') throw reset;
        return fetch(input, init);
      } });
      await usingLocal(local, async () => {
        const client = await local.connect('synthetic-operator-a', mode);
        for (const [, validate] of validators) await assert.rejects(validate(client), error => error === reset);
      });
      assert.deepEqual(local.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
    });
  }
});

describe('lifecycle failure propagation', () => {
  it('disposes a runtime when ready rejects and preserves both cleanup errors', async () => {
    const ready = new Error('SYNTHETIC_READY_FAILURE'); const cleanup = new Error('SYNTHETIC_DISPOSE_FAILURE');
    let disposed = 0;
    await assert.rejects(startLocal({}, { createRuntime: () => ({
      ready: Promise.reject(ready), dispose: async () => { disposed++; throw cleanup; }
    }) }), error => error instanceof AggregateError && error.errors[0] === ready && error.errors[1].errors.includes(cleanup));
    assert.equal(disposed, 1);
  });
  it('always closes after a failing assertion/report and preserves operation plus cleanup failure', async () => {
    const failure = new Error('SYNTHETIC_ASSERTION_OR_WRITE_FAILURE'); const cleanup = new Error('SYNTHETIC_CLOSE_FAILURE');
    let count = 0;
    await assert.rejects(usingLocal({ close: async () => { count++; throw cleanup; } }, async () => { throw failure; }),
      error => error instanceof AggregateError && error.errors[0] === failure && error.errors[1] === cleanup);
    assert.equal(count, 1);
  });
});

function childScenario(scenario) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['--unhandled-rejections=strict', 'tests/fixtures/lifecycle-child.mjs', scenario], {
      cwd: process.cwd(), detached: true, stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = ''; let stderr = ''; let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, 'SIGKILL'); } catch (error) { if (error.code !== 'ESRCH') reject(error); }
    }, 20000);
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.stderr.on('data', chunk => { stderr += chunk; });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('close', (code, signal) => {
      clearTimeout(timer);
      try {
        assert.equal(timedOut, false, `Scenario did not exit naturally: ${scenario}`);
        assert.equal(code, 0, `${scenario}: ${signal ?? ''}\n${stderr}\n${stdout}`);
        resolve(JSON.parse(stdout));
      } catch (error) { reject(error); }
    });
  });
}
describe('natural subprocess shutdown without process.exit or forced-exit test options', () => {
  const evidence = [];
  for (const scenario of ['normal', 'ready-failure', 'connect-reset', 'assertion-failure', 'demo-write-failure', 'demo-transport-reset',
    'client-close-failure', 'runtime-dispose-failure', 'pending-http', 'connect-close-race', 'client-close-timeout']) {
    it(`releases ports, child processes and timers after ${scenario}`, { timeout: 25000 }, async () => {
      const report = await childScenario(scenario);
      assert.equal(report.scenario, scenario);
      assert.deepEqual(report.extraResources, []);
      assert.deepEqual(report.liveOwnedChildren, []);
      assert.deepEqual(report.liveTimers, []);
      assert.ok(report.portsChecked.length > 0);
      evidence.push(report);
      await writeFile('work/lifecycle-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
    });
  }
});
