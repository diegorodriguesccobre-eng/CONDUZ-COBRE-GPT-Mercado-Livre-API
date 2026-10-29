export { B3AccountVault } from './vault';

// No variable, JWT, binding or request can activate B3 in this revision.
// The local router is exercised with synthetic dependencies only.
export default {
  async fetch(): Promise<Response> {
    return Response.json({ error: { code: 'PRODUCTION_DISABLED', message: 'B3 local; integração real desativada.' } }, {
      status: 503, headers: { 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
        'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", 'X-Content-Type-Options': 'nosniff' }
    });
  }
} satisfies ExportedHandler;
