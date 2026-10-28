import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const directory = fileURLToPath(new URL('..', import.meta.url));
const work = directory + 'work/homologation/';
await mkdir(work, { recursive: true });
const common = { absWorkingDir: directory, bundle: true, platform: 'browser', format: 'esm',
  conditions: ['workerd', 'browser'], external: ['cloudflare:workers'], metafile: true };
const front = await build({ ...common, entryPoints: ['homologation/worker.ts'], outfile: work + 'worker.mjs' });
await build({ ...common, entryPoints: ['tests/fixtures/integrated-worker.ts'], outfile: work + 'backend.mjs' });
await build({ ...common, stdin: {
  contents: "export {createBoundPorts, LOCAL_MODE, PORT_DEADLINE_MS, PortUnavailable} from './homologation/ports.ts'; export {registry} from './integration/registry.ts';",
  resolveDir: directory
}, outfile: work + 'ports-library.mjs' });
const output = Object.values(front.metafile.outputs).find(v => v.entryPoint?.endsWith('homologation/worker.ts'));
if (!output || JSON.stringify(output.exports) !== '["default"]'
  || Object.keys(front.metafile.inputs).some(p => p.includes('tests/fixtures/') || p.endsWith('recovery/storage.ts'))) {
  throw new Error('HOMOLOGATION_PUBLIC_GRAPH_REJECTED');
}
await writeFile(work + 'build-report.json', JSON.stringify({
  syntheticOnly: true, localOnly: true, productionReady: false, publicExports: output.exports,
  publicInputs: Object.keys(front.metafile.inputs), privateBackendFixture: 'tests/fixtures/integrated-worker.ts',
  deployAuthorized: false
}, null, 2) + '\n');
