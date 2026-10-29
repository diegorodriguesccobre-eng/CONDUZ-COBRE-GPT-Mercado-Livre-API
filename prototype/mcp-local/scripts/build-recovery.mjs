import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
await mkdir('work', { recursive: true });
await build({ entryPoints: ['tests/fixtures/recovery-worker.ts'], outfile: 'work/recovery-worker.mjs',
  bundle: true, platform: 'browser', format: 'esm', conditions: ['workerd', 'browser'], external: ['cloudflare:workers'] });
