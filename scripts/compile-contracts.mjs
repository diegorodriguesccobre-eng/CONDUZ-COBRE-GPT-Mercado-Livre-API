import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import standalone from 'ajv/dist/standalone/index.js';
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
const ajv = new Ajv2020({ strict: true, allErrors: true, code: { source: true, esm: true } });
addFormats(ajv);
const names = ['common', 'health', 'oauth-start', 'oauth-callback', 'account', 'listing', 'listings', 'error'];
for (const name of names) ajv.addSchema(JSON.parse(readFileSync(`contracts/v1/${name}.schema.json`, 'utf8')));
const exports = Object.fromEntries(names.filter(n => n !== 'common').map(name => [
  name.replace(/-([a-z])/g, (_, c) => c.toUpperCase()), `https://schemas.conduz-cobre.invalid/v1/${name}.schema.json`
]));
const preparation = JSON.parse(readFileSync('contracts/preparation/disabled.schema.json', 'utf8'));
ajv.addSchema(preparation);
exports.preparationDisabled = preparation.$id;
mkdirSync('.wrangler/contracts', { recursive: true });
writeFileSync('.wrangler/contracts/source.mjs', standalone(ajv, exports));
await build({ entryPoints: ['.wrangler/contracts/source.mjs'], outfile: '.wrangler/contracts/validators.mjs',
  bundle: true, format: 'esm', platform: 'neutral', target: 'es2022' });
writeFileSync('.wrangler/contracts/validators.d.mts', Object.keys(exports)
  .map(name => `export function ${name}(data: unknown): boolean;`).join('\n') + '\n');
// Compilation happens in Node. Tests load static validators; no eval in the Worker.
console.log('JSON Schemas compilados para validadores estáticos.');
