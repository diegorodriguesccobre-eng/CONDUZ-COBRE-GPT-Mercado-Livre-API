import { build } from 'esbuild';
import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('work', { recursive: true });
const built = await build({ entryPoints: ['src/worker.ts'], outfile: 'work/worker.mjs', bundle: true,
  platform: 'browser', format: 'esm', conditions: ['workerd', 'browser'], metafile: true });
const builtins = Object.keys(built.metafile.inputs).filter(name => name.startsWith('node:'));
if (builtins.length) throw new Error('NODE_RUNTIME_DEPENDENCY');
await writeFile('work/bundle-report.json', JSON.stringify({ platform: 'workerd', nodeBuiltins: builtins,
  outputBytes: built.metafile.outputs['work/worker.mjs'].bytes, inputModules: Object.keys(built.metafile.inputs).length }, null, 2) + '\n');
// Pure local policy/response-limit checks use a Node bundle; no HTTP server uses this artifact.
await build({ entryPoints: ['src/server.ts', 'src/synthetic.ts'], outdir: 'work/unit', bundle: true,
  platform: 'node', format: 'esm', outExtension: { '.js': '.mjs' } });
