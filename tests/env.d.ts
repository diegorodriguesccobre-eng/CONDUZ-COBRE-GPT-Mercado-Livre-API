import type { Env as AppEnv } from '../src/types';
declare global {
  namespace Cloudflare {
    interface Env extends AppEnv {}
    interface GlobalProps {
      mainModule: typeof import('../src/index');
      durableNamespaces: 'AccountVault';
    }
  }
}
