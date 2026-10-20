import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
const mode = process.argv[2];
const commands = {
  test: ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(3)],
  build: ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--outdir', 'dist'],
  'build:production': ['node_modules/wrangler/bin/wrangler.js', 'deploy', '--dry-run', '--config', 'wrangler.production.jsonc', '--outdir', 'dist/production-preparation'],
  dev: ['node_modules/wrangler/bin/wrangler.js', 'dev', '--local', '--ip', '127.0.0.1']
};
if (!(mode in commands)) throw new Error('Unsupported local tooling mode');
const config = resolve('.wrangler/config');
mkdirSync(config, { recursive: true });
// Wrangler's debug protocol logs can include its own ephemeral proxy secret. Never retain them.
const logDirectory = mkdtempSync(resolve('.wrangler/temporary-tool-logs-'));
const cleanup = () => rmSync(logDirectory, { recursive: true, force: true });
const toolEnv = { ...process.env, XDG_CONFIG_HOME: config, WRANGLER_LOG_PATH: logDirectory,
  WRANGLER_SEND_METRICS: 'false', CLOUDFLARE_CF_FETCH_ENABLED: 'false' };
// B0 tooling never needs a real Cloudflare identity, including dry-run.
for (const name of ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_API_KEY', 'CLOUDFLARE_EMAIL', 'CLOUDFLARE_ACCOUNT_ID']) delete toolEnv[name];
const child = spawn(process.execPath, commands[mode], { stdio: 'inherit', env: toolEnv });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', () => { cleanup(); console.error('Falha ao iniciar ferramenta local.'); process.exitCode = 1; });
child.on('exit', (code, signal) => { cleanup(); process.exitCode = code ?? (signal === 'SIGINT' ? 130 : 1); });
