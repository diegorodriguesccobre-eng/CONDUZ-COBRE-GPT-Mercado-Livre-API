import { z } from 'zod';
import { bounded } from '../integration/contracts';

export const PORT_DEADLINE_MS = 1000;
// A transport budget never extends the inherited command deadline or final revalidation.
export const EXECUTION_PORT_DEADLINE_MS = 3000;
export type ReadServices = Readonly<Record<'identity' | 'registry' | 'reference' | 'vaults', Pick<Fetcher, 'fetch'>>>;
export class PortUnavailable extends Error {
  constructor() { super('INTEGRATION_DEPENDENCY_UNAVAILABLE'); this.name = 'PortUnavailable'; }
}
// Module-private, non-serializable diagnostics. No getter, sink, binding, flag or
// extra Error property is exposed. In particular, never retain a raw cause,
// Request, Response, argument, header, token or stack in this map.
type PrivateCause = 'deadline' | 'abort' | 'transport' | 'http_status' | 'content_type'
  | 'body_read' | 'json' | 'envelope' | 'unexpected';
type PrivatePhase = 'configuration' | 'capability' | 'request' | 'fetch' | 'response'
  | 'status' | 'content_type' | 'body' | 'json' | 'envelope' | 'late-response' | 'cleanup';
interface PrivateDiagnostic {
  readonly cause: PrivateCause;
  readonly phase: PrivatePhase;
  readonly port: keyof ReadServices | null;
  readonly method: string | null;
  readonly deadlineMs: number;
  readonly elapsedMs: number;
}
const privateDiagnostics = new WeakMap<PortUnavailable, { owner: object; diagnostic: Readonly<PrivateDiagnostic> }>();
function unavailable(owner: object, diagnostic: PrivateDiagnostic): PortUnavailable {
  const error = new PortUnavailable();
  privateDiagnostics.set(error, { owner, diagnostic: Object.freeze(diagnostic) });
  return error;
}
function causeAt(phase: PrivatePhase): PrivateCause {
  return phase === 'fetch' ? 'transport' : phase === 'body' ? 'body_read'
    : phase === 'json' ? 'json' : phase === 'envelope' ? 'envelope' : 'unexpected';
}
const methods = Object.freeze({
  identity: Object.freeze(['issue', 'lookup', 'cancel']),
  registry: Object.freeze(['snapshot', 'resolve', 'barrier', 'event']),
  reference: Object.freeze(['current', 'permissions']),
  vaults: Object.freeze(['execute', 'assertPrepared'])
});
// Only declared service capabilities are used: no global fetch, URL selector or admin port.
export function createReadServiceClient(input: ReadServices) {
  let services: ReadServices;
  try {
    if (!input || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(Object.keys(methods).sort())
      || Object.values(input).some(value => !value || typeof value.fetch !== 'function')) throw new PortUnavailable();
    services = Object.freeze({ identity: input.identity, registry: input.registry, reference: input.reference, vaults: input.vaults });
  } catch {
    throw unavailable({}, { cause: 'unexpected', phase: 'configuration', port: null, method: null, deadlineMs: 0, elapsedMs: 0 });
  }
  // Node/Undici follows the parent signal through the Request's dependent controller.
  // Own each Request until abort/cleanup; a consumer may retain only its signal.
  const activeRequests = new Set<Request>();
  async function call(port: keyof ReadServices, method: string, args: unknown): Promise<unknown> {
    try {
      if (!Object.hasOwn(methods, port) || !(methods[port] as readonly string[]).includes(method)) throw new PortUnavailable();
    } catch {
      throw unavailable({}, { cause: 'unexpected', phase: 'capability', port: null, method: null, deadlineMs: 0, elapsedMs: 0 });
    }
    const deadlineMs = port === 'vaults' || (port === 'reference' && method === 'permissions')
      ? EXECUTION_PORT_DEADLINE_MS : PORT_DEADLINE_MS;
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Response | undefined; let request: Request | undefined;
    const owner = {}, started = Date.now();
    let phase: PrivatePhase = 'request', deadlineExpired = false;
    const fail = (cause: PrivateCause, at: PrivatePhase = phase) => unavailable(owner, {
      cause, phase: at, port: typeof port === 'string' ? port : null, method: typeof method === 'string' ? method : null,
      deadlineMs, elapsedMs: Math.max(0, Date.now() - started)
    });
    try {
      const operation = Promise.resolve().then(async () => {
        request = new Request('https://m1-ports.invalid/' + port + '/' + method, {
          method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ args }), signal: controller.signal
        });
        activeRequests.add(request);
        phase = 'fetch';
        const value = await services[port].fetch(request);
        if (controller.signal.aborted) { void value.body?.cancel().catch(() => {}); throw fail('abort', 'late-response'); }
        phase = 'response';
        response = value; return value;
      });
      response = await Promise.race([operation, new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          deadlineExpired = true;
          const error = fail('deadline');
          controller.abort(); reject(error);
        }, deadlineMs);
      })]);
      phase = 'status';
      if (!response.ok) throw fail('http_status');
      phase = 'content_type';
      if (!response.headers.get('Content-Type')?.startsWith('application/json')) throw fail('content_type');
      phase = 'body';
      const bytes = await bounded(response.body, Math.max(1, deadlineMs - (Date.now() - started)), controller.signal);
      phase = 'json';
      const decoded: unknown = JSON.parse(new TextDecoder().decode(bytes));
      phase = 'envelope';
      const envelope = z.strictObject({ ok: z.literal(true), value: z.unknown() }).parse(decoded);
      return envelope.value;
    } catch (error) {
      // Only failures created by this invocation may carry an authoritative tag.
      // A fetch can throw an old PortUnavailable, a forged Error or any value.
      const own = privateDiagnostics.get(error as PortUnavailable);
      if (own?.owner === owner) throw error;
      const cause: PrivateCause = deadlineExpired ? 'deadline' : controller.signal.aborted ? 'abort'
        : causeAt(phase);
      throw fail(cause);
    }
    finally {
      if (timer !== undefined) clearTimeout(timer);
      try {
        // Keep the dependent controller alive while cancellation is propagated.
        controller.abort();
        if (response?.body && !response.body.locked) void response.body.cancel().catch(() => {});
      } catch {
        throw fail('unexpected', 'cleanup');
      } finally {
        if (request) activeRequests.delete(request);
        request = undefined;
      }
    }
  }
  return call;
}
