import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';
// Explicit synthetic config avoids importing Worker code into the Vite config loader.
const TEST_KEY = Buffer.alloc(32, 7).toString('base64url');
const preparationConfig = {
  stage: 'production-preparation', transport: 'disabled', tenant: 'conduz_cobre',
  publicOrigin: 'https://conduz-cobre-ml-api.conduz-cobre.workers.dev',
  redirectUri: 'https://conduz-cobre-ml-api.conduz-cobre.workers.dev/oauth/mercadolivre/callback',
  accessIssuer: 'https://synthetic-b3-team.cloudflareaccess.com', accessAudience: 'b3-tests',
  operatorRoles: { 'synthetic-admin': 'administrator' }, accountRef: 'synthetic-b3-account', expectedSellerId: '42'
};

export default defineConfig({
  plugins: [cloudflareTest({
    wrangler: { configPath: './wrangler.b3.local.jsonc' }, remoteBindings: false,
    miniflare: { bindings: { B3_CONFIG: preparationConfig, B3_STATE_KEY: TEST_KEY,
      B3_ACTIVE_KEY_ID: 'test-v1', B3_TOKEN_KEYS: { 'test-v1': TEST_KEY } } }
  })],
  test: { include: ['tests/b3-runtime/*.integration.ts'], setupFiles: ['./tests/setup.ts'],
    maxWorkers: 1, fileParallelism: false, testTimeout: 15000, hookTimeout: 15000 }
});
