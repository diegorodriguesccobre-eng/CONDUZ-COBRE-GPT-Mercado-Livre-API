import { z } from 'zod';
import { bounded } from '../integration/contracts';

export const PORT_DEADLINE_MS = 1000;
// A transport budget never extends the inherited command deadline or final revalidation.
export const EXECUTION_PORT_DEADLINE_MS = 3000;
export type ReadServices = Readonly<Record<'identity' | 'registry' | 'reference' | 'vaults', Pick<Fetcher, 'fetch'>>>;
export class PortUnavailable extends Error {
  constructor() { super('INTEGRATION_DEPENDENCY_UNAVAILABLE'); this.name = 'PortUnavailable'; }
}
const methods = Object.freeze({
  identity: Object.freeze(['issue', 'lookup', 'cancel']),
  registry: Object.freeze(['snapshot', 'resolve', 'barrier', 'event']),
  reference: Object.freeze(['current', 'permissions']),
  vaults: Object.freeze(['execute', 'assertPrepared'])
});
// Only declared service capabilities are used: no global fetch, URL selector or admin port.
export function createReadServiceClient(input: ReadServices) {
  if (!input || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(Object.keys(methods).sort())
    || Object.values(input).some(value => !value || typeof value.fetch !== 'function')) throw new PortUnavailable();
  const services = Object.freeze({ identity: input.identity, registry: input.registry, reference: input.reference, vaults: input.vaults });
  // Node/Undici follows the parent signal through the Request's dependent controller.
  // Own each Request until abort/cleanup; a consumer may retain only its signal.
  const activeRequests = new Set<Request>();
  async function call(port: keyof ReadServices, method: string, args: unknown): Promise<unknown> {
    if (!Object.hasOwn(methods, port) || !(methods[port] as readonly string[]).includes(method)) throw new PortUnavailable();
    const deadlineMs = port === 'vaults' || (port === 'reference' && method === 'permissions')
      ? EXECUTION_PORT_DEADLINE_MS : PORT_DEADLINE_MS;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined; let request: Request | undefined;
    try {
      const started = Date.now();
      const operation = Promise.resolve().then(async () => {
        request = new Request('https://m1-ports.invalid/' + port + '/' + method, {
          method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args }), signal: controller.signal
        });
        activeRequests.add(request);
        const value = await services[port].fetch(request);
        if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw new PortUnavailable(); }
        response = value; return value;
      });
      response = await Promise.race([operation, new Promise<never>((_, fail) => {
        timer = setTimeout(() => { controller.abort(); fail(new PortUnavailable()); }, deadlineMs);
      })]);
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('application/json')) throw new PortUnavailable();
      const bytes = await bounded(response.body, Math.max(1, deadlineMs - (Date.now() - started)), controller.signal);
      const envelope = z.strictObject({ ok: z.literal(true), value: z.unknown() }).parse(JSON.parse(new TextDecoder().decode(bytes)));
      return envelope.value;
    } catch { throw new PortUnavailable(); }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        // Keep the dependent controller alive while cancellation is propagated.
        controller.abort();
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      } finally {
        if (request) activeRequests.delete(request);
        request = undefined;
      }
    }
  }
  return call;
}
