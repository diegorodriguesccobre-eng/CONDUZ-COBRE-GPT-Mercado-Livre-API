import { CALLBACK_PATH, productionBlock } from './config';
import { failure } from '../errors';
export { BrowserOAuthVault } from './browser-vault';

// Deployable preparation target, deliberately fail-closed. Real Access, routes and exchange need a new approval.
export default {
  async fetch(request: Request): Promise<Response> {
    const path = new URL(request.url).pathname;
    try { productionBlock(); }
    catch (error) {
      const safe = failure(error);
      return Response.json({ error: { code: safe.code,
        message: path === CALLBACK_PATH ? 'Callback preparado; OAuth de produção desativado.' : safe.message } }, {
        status: safe.status, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
          'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' }
      });
    }
  }
} satisfies ExportedHandler;
