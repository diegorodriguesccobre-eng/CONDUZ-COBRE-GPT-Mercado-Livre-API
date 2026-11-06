import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHomologationFixture } from './homologation-harness.mjs';

const project = fileURLToPath(new URL('..', import.meta.url));
const workerName = 'i2-identity', objectName = 'local-identity-authority';
const object = { className: 'I2Identity', scriptName: workerName, useSQLite: true, unsafeUniqueKey: 'i2-local-identity-v1' };
// Privileged Node-only seam. No Worker binding exposes these lifecycle controls.
export async function createI2IdentityFixture() {
  let runtime;
  const identityRuntime = {
    onRuntime(value) { runtime = value; },
    configureBackend(options) {
      const { host, port, inspectorHost, inspectorPort, cf, resourcePersistencePath, ...backend } = options;
      return { host, port, inspectorHost, inspectorPort, cf, resourcePersistencePath,
        workers: [
          { ...backend, name: 'i1-backend', durableObjects: { ...backend.durableObjects, INTEGRATION_IDENTITY: object } },
          { name: workerName, modules: true, scriptPath: resolve(project, 'work/i2-identity/identity.mjs'),
            compatibilityDate: backend.compatibilityDate, outboundService: backend.outboundService,
            bindings: { I2_MODE: 'I2_IDENTITY_FICTIONAL_LOCAL_ONLY', I2_JWKS: backend.bindings.SYNTHETIC_JWKS },
            durableObjects: { I2_IDENTITIES: object } }
        ] };
    },
    async fetch(request, currentRuntime) {
      runtime = currentRuntime;
      return (await runtime.getWorker(workerName)).fetch(request);
    }
  };
  const fixture = await createHomologationFixture({ identityRuntime });
  return {
    async open(options) {
      const h = await fixture.open(options);
      const current = runtime; assert.ok(current);
      return { ...h,
        async identity(method, args) {
          const response = await (await current.getWorker(workerName)).fetch(new Request('https://m1-ports.invalid/identity/' + method, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ args })
          }));
          return { status: response.status, body: await response.json() };
        },
        async privateRequest(request) { return (await current.getWorker(workerName)).fetch(request); },
        async restartIdentity() {
          await current.unsafeEvictDurableObject(workerName, 'I2Identity', { name: objectName });
        }
      };
    }
  };
}
