import assert from 'node:assert/strict';
import { build } from 'esbuild';
import ts from 'typescript';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const project = fileURLToPath(new URL('..', import.meta.url));
assert.equal(process.version, 'v24.22.1'); assert.equal(process.versions.undici, '7.30.1');
// Typecheck new files with the existing strict compiler configuration, unchanged.
const file = resolve(project, 'tsconfig.homologation.json');
const config = ts.readConfigFile(file, ts.sys.readFile); if (config.error) throw new Error('I2_TSC_CONFIG');
const parsed = ts.parseJsonConfigFileContent({ ...config.config, include: ['i2/**/*.ts'] }, ts.sys, project);
const program = ts.createProgram(parsed.fileNames, { ...parsed.options, noEmit: true });
const diagnostics = [...parsed.errors, ...ts.getPreEmitDiagnostics(program)];
if (diagnostics.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
  getCanonicalFileName: f => f, getCurrentDirectory: () => project, getNewLine: () => '\n'
}));
const work = resolve(project, 'work/i2-identity'); await mkdir(work, { recursive: true });
const result = await build({ absWorkingDir: project, entryPoints: ['i2/identity-worker.ts'],
  outfile: resolve(work, 'identity.mjs'), bundle: true, platform: 'browser', format: 'esm',
  conditions: ['workerd','browser'], external: ['cloudflare:workers'], metafile: true });
const inputs = Object.keys(result.metafile.inputs);
assert.ok(inputs.includes('integration/identity-core.ts'));
assert.ok(inputs.includes('../../src/preparation/access-identity.ts'));
assert.ok(inputs.every(p => !/tests\/fixtures\/|scripts\/|recovery\/storage|integration\/identity\.ts$/.test(p)));
assert.deepEqual(Object.values(result.metafile.outputs).flatMap(o => o.exports).sort(), ['I2Identity','default']);
await writeFile(resolve(work, 'build-report.json'), JSON.stringify({ syntheticOnly: true, productionReady: false,
  deployAuthorized: false, typecheck: 'PASS', privateInputs: inputs, exports: ['I2Identity','default'] }, null, 2)+'\n');
console.log('I2 private identity: typecheck and isolated bundle PASS');
