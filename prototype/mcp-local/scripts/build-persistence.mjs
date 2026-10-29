import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('work', { recursive: true });
await build({ entryPoints: ['tests/fixtures/persistent-worker.ts'], outfile: 'work/persistent-worker.mjs',
  bundle: true, platform: 'browser', format: 'esm', conditions: ['workerd', 'browser'], external: ['cloudflare:workers'] });
