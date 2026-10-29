import { CryptoBox } from '../../src/crypto';
import { BrowserOAuthService } from '../../src/preparation/browser-oauth';
import { PRODUCTION_ORIGIN, PRODUCTION_REDIRECT_URI, type PreparationConfig } from '../../src/preparation/config';
import { MemoryStore, TEST_KEY } from '../helpers';

export const preparationConfig: PreparationConfig = {
  stage: 'production-preparation', transport: 'disabled', tenant: 'conduz_cobre',
  publicOrigin: PRODUCTION_ORIGIN, redirectUri: PRODUCTION_REDIRECT_URI,
  accessIssuer: 'https://synthetic-b1-team.cloudflareaccess.com', accessAudience: 'b1-tests',
  operatorRoles: { 'synthetic-admin': 'administrator', 'synthetic-viewer': 'viewer' },
  accountRef: 'synthetic-b1-account', expectedSellerId: '42'
};
export function browserHarness() {
  const clock = { now: 1800000000000 }; const store = new MemoryStore();
  const box = new CryptoBox(TEST_KEY, 'conduz_cobre:production-preparation:synthetic-b1-account:browser-v1');
  const service = new BrowserOAuthService(store, box, preparationConfig, () => clock.now);
  const identity = { subject: 'synthetic-admin-subject', role: 'administrator' as const, expiresAt: clock.now + 600000 };
  const startRequest = () => new Request(PRODUCTION_ORIGIN + '/oauth/start', {
    method: 'POST', headers: { Origin: PRODUCTION_ORIGIN, 'Sec-Fetch-Site': 'same-origin' }
  });
  const callback = (state: string, cookie: string, code = 'SYNTHETIC_CODE') => new Request(PRODUCTION_REDIRECT_URI + '?' +
    new URLSearchParams({ state, code }), { headers: { Cookie: cookie.split(';')[0]! } });
  return { clock, store, box, service, identity, startRequest, callback };
}
