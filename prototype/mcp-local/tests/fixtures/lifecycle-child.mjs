import assert from 'node:assert/strict';
import { Miniflare } from 'miniflare';
import { Client, SdkError } from '@modelcontextprotocol/client';
import { Server, createConnection } from 'node:net';
import { ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHook } from 'node:async_hooks';
import { setTimeout as delay, setImmediate as tick } from 'node:timers/promises';
import { startLocal, usingLocal } from '../../scripts/local-harness.mjs';
import { runDemo } from '../../scripts/demo.mjs';

const scenario = process.argv[2];
const counts = resources => resources.reduce((all, name) => ({ ...all, [name]: (all[name] ?? 0) + 1 }), {});
const baseline = counts(process.getActiveResourcesInfo());
const timers = new Map();
const timerHook = createHook({
  init(id, type, _trigger, resource) { if (type === 'Timeout') timers.set(id, resource); },
  destroy(id) { timers.delete(id); }
}).enable();
const children = new Map(); const ports = new Set();
function processIdentity(pid) {
  try { const stat = readFileSync(`/proc/${pid}/stat`, 'utf8'); return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[19]; }
  catch (error) { if (error.code === 'ENOENT') return undefined; throw error; }
}
function observe(url) {
  ports.add(Number(url.port));
  // Diagnostics only: getActiveResourcesInfo and natural exit are checked independently.
  for (const handle of process._getActiveHandles()) {
    if (handle instanceof Server && handle.listening) {
      const address = handle.address();
      if (address && typeof address === 'object') {
        assert.ok(['127.0.0.1', '::1'].includes(address.address));
        ports.add(address.port);
      }
    }
    if (handle instanceof ChildProcess && handle.pid) children.set(handle.pid, processIdentity(handle.pid));
  }
}
const failure = new Error('SYNTHETIC_EXPECTED_FAILURE');
const reset = Object.assign(new Error('SYNTHETIC_CONNECTION_RESET'), { code: 'ECONNRESET' });
let local;
if (scenario === 'ready-failure') {
  await assert.rejects(startLocal({}, { createRuntime: options => {
    const runtime = new Miniflare(options);
    return { ready: runtime.ready.then(url => { observe(url); throw failure; }), dispose: () => runtime.dispose() };
  } }), error => error === failure);
} else {
  const dependencies = { afterReady: observe };
  if (scenario === 'connect-reset') dependencies.fetch = async () => { throw reset; };
  if (scenario === 'demo-transport-reset') dependencies.fetch = (input, init) => {
    const body = JSON.parse(init.body ?? '{}');
    if (body.method === 'tools/call' && body.params.name === 'delete') throw reset;
    return fetch(input, init);
  };
  if (scenario === 'connect-close-race') dependencies.fetch = (_input, init) => new Promise((_, reject) => {
    if (init.signal.aborted) reject(init.signal.reason);
    else init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
  });
  if (scenario === 'client-close-failure' || scenario === 'client-close-timeout') dependencies.createClient = (info, options) => {
    const client = new Client(info, options); const close = client.close.bind(client);
    client.close = async () => { await close(); if (scenario === 'client-close-timeout') await new Promise(() => {}); throw failure; };
    return client;
  };
  if (scenario === 'runtime-dispose-failure') dependencies.createRuntime = options => {
    const runtime = new Miniflare(options);
    return { ready: runtime.ready, dispose: async () => { await runtime.dispose(); throw failure; } };
  };
  local = await startLocal({}, dependencies);
  try {
    if (scenario === 'normal') {
      await usingLocal(local, async () => {
        for (const mode of [{ pin: '2026-07-28' }, 'legacy']) {
          const client = await local.connect('synthetic-operator-a', mode);
          assert.equal((await client.listTools()).tools.length, 3);
          // Intentionally leave clients open; harness must own and close them.
        }
        await Promise.all([local.close(), local.close()]);
      });
    } else if (scenario === 'connect-reset') {
      await usingLocal(local, async () => {
        await assert.rejects(local.connect(), error => error === reset ||
          (error instanceof SdkError && error.code === 'ERA_NEGOTIATION_FAILED' && error.cause === reset));
      });
    } else if (scenario === 'assertion-failure') {
      await assert.rejects(usingLocal(local, async () => { await local.connect(); throw failure; }), error => error === failure);
    } else if (scenario === 'demo-write-failure') {
      await assert.rejects(runDemo({ start: async () => local, save: async () => { throw failure; } }), error => error === failure);
    } else if (scenario === 'demo-transport-reset') {
      let saved = false;
      await assert.rejects(runDemo({ start: async () => local, save: async () => { saved = true; } }), error => error === reset);
      assert.equal(saved, false);
    } else if (scenario === 'client-close-failure' || scenario === 'client-close-timeout' || scenario === 'runtime-dispose-failure') {
      await local.connect();
      await assert.rejects(local.close(), AggregateError);
    } else if (scenario === 'pending-http') {
      const pending = local.rawHttp({ incomplete: true });
      const rejected = assert.rejects(pending, /LOCAL_HARNESS_CLOSED/);
      while (local.resources().requests === 0) await tick();
      await local.close(); await rejected;
    } else if (scenario === 'connect-close-race') {
      const pending = local.connect();
      const rejected = assert.rejects(pending);
      while (local.resources().fetches === 0) await tick();
      await local.close(); await rejected;
    } else throw new Error('UNKNOWN_SCENARIO');
  } finally {
    // Already observed expected cleanup errors above; always re-attempt the cached close outcome.
    try { await local.close(); } catch (error) {
      if (!['client-close-failure', 'client-close-timeout', 'runtime-dispose-failure'].includes(scenario)) throw error;
    }
  }
  assert.deepEqual(local.resources(), { closed: true, clients: 0, requests: 0, fetches: 0 });
  await assert.rejects(local.connect(), /LOCAL_HARNESS_CLOSED/);
}

for (const port of ports) {
  await new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let refused = false;
    socket.setTimeout(1000, () => { socket.destroy(); reject(new Error('PORT_PROBE_TIMEOUT')); });
    socket.once('connect', () => { socket.destroy(); reject(new Error('LOCAL_PORT_STILL_OPEN')); });
    socket.once('error', error => { if (error.code === 'ECONNREFUSED') refused = true; else reject(error); });
    socket.once('close', () => { socket.setTimeout(0); if (refused) resolve(); });
  });
}
let extraResources; let liveOwnedChildren; let liveTimers;
const until = Date.now() + 1000;
do {
  await delay(25); await tick();
  const current = counts(process.getActiveResourcesInfo());
  extraResources = Object.entries(current).filter(([name, count]) => count > (baseline[name] ?? 0)).map(([name, count]) => ({ name, extra: count - (baseline[name] ?? 0) }));
  liveOwnedChildren = [...children].filter(([pid, identity]) => processIdentity(pid) === identity).map(([pid]) => pid);
  liveTimers = [...timers.values()].filter(timer => !timer._destroyed).map(timer => ({ referenced: timer.hasRef() }));
  if (!extraResources.length && !liveOwnedChildren.length && !liveTimers.length) break;
} while (Date.now() < until);
assert.deepEqual(extraResources, []);
assert.deepEqual(liveOwnedChildren, []);
assert.deepEqual(liveTimers, []);
timerHook.disable();
console.log(JSON.stringify({ scenario, baseline, extraResources, liveOwnedChildren,
  liveTimers, ownedChildrenChecked: children.size, portsChecked: [...ports], naturalExit: true }));
// No process.exit(): the parent requires a natural exit and kills the group only on failure.
