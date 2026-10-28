import { z } from 'zod';
import { integratedFetch } from '../integration/composition';
import { canonical, reject, commandSchema, type IntegrationEnv, type Command, type Code } from '../integration/contracts';
import { registry, type Binding } from '../integration/registry';
import { classifyReadFailure } from '../integration/read-failure';
import { IntegrationFailure } from '../integration/contracts';
import { VAULTS, accountSchema, materialSchema, type Account } from '../vault/model';
import { LOCAL_MODE, type HomologationPorts } from './ports';

function closedCode(value: unknown): Code {
  if (typeof value !== 'string') return 'INTEGRATION_DEPENDENCY_UNAVAILABLE';
  return classifyReadFailure(new IntegrationFailure(value as Code)).code;
}
const vaultReply = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true), data: z.record(z.string(), z.unknown()), prepared: z.unknown() }),
  z.strictObject({ ok: z.literal(false), code: z.string().max(100) })
]);
const preparedReply = z.discriminatedUnion('ok', [
  z.strictObject({ ok: z.literal(true) }),
  z.strictObject({ ok: z.literal(false), code: z.string().max(100) })
]);
// A private namespace adapter exposes only the methods the published B4 read flow consumes.
function namespace<T>(entries: Readonly<Record<string, T>>) {
  return Object.freeze({
    idFromName: (name: string) => {
      if (!Object.hasOwn(entries, name)) return reject('INTEGRATION_BINDING_DENIED');
      return name;
    },
    get: (id: unknown) => {
      if (typeof id !== 'string' || !Object.hasOwn(entries, id)) return reject('INTEGRATION_BINDING_DENIED');
      return entries[id]!;
    }
  });
}
export function createHomologationEnvironment(ports: HomologationPorts): IntegrationEnv {
  if (ports.mode !== LOCAL_MODE) return reject('INTEGRATION_DEPENDENCY_UNAVAILABLE');
  // The inherited canary guard is retained. These materials must match the closed fictional format.
  const materials = materialSchema.parse(ports.material);
  async function state() {
    const s = await ports.registry.snapshot();
    return { ...s, registryFault: '', pauseAt: '', streamFault: '' };
  }
  async function binding(account: Account): Promise<Binding> {
    const expected = (await registry(await state())).entries.find(e => e.account === account);
    const actual = await ports.registry.resolve(account);
    if (!expected || canonical(actual) !== canonical(expected)) return reject('INTEGRATION_BINDING_DENIED');
    return expected;
  }
  const vaults = Object.fromEntries((['account-a', 'account-b'] as const).map(account => [VAULTS[account].vault, Object.freeze({
    execute: async (input: unknown) => {
      const c: Command = commandSchema.parse(input);
      if (c.account !== account) return reject('INTEGRATION_BINDING_DENIED');
      await binding(account);
      const reply = vaultReply.parse(await ports.vaults.execute(account, c));
      return reply.ok ? reply : { ok: false, code: closedCode(reply.code) };
    },
    assertPrepared: async (input: unknown) => {
      const c = commandSchema.parse(z.object({ command: z.unknown() }).parse(input).command);
      if (c.account !== account) return reject('INTEGRATION_BINDING_DENIED');
      await binding(account);
      const reply = preparedReply.parse(await ports.vaults.assertPrepared(account, input));
      return reply.ok ? reply : { ok: false, code: closedCode(reply.code) };
    }
  })]));
  const identity = Object.freeze({
    issue: (input: unknown) => ports.identity.issue(input),
    lookup: (input: unknown, consume = false) => ports.identity.lookup(input, consume),
    cancel: (handle: string) => ports.identity.cancel(handle)
  });
  const reference = Object.freeze({ current: () => ports.reference.current() });
  const authority = Object.freeze({
    permissions: (input: { account: unknown; subject: string }, required: 'read') =>
      ports.reference.permissions({ account: accountSchema.parse(input.account), subject: input.subject }, required)
  });
  const control = Object.freeze({
    snapshot: state, barrier: (input: unknown) => ports.registry.barrier(input),
    event: (input: unknown) => ports.registry.event(input)
  });
  // One confined type boundary: DO namespace internals are replaced by capability-only local ports.
  // No caller gets these adapters or the underlying driver; runtime validation remains in B4.
  return Object.freeze({
    SYNTHETIC_ONLY: 'B4_MCP_LOCAL_ONLY', SYNTHETIC_POLICY: 'persistent',
    SYNTHETIC_JWKS: ports.jwks, SYNTHETIC_VAULT_MATERIAL: materials,
    INTEGRATION_IDENTITY: namespace({ 'local-identity-authority': identity }),
    INTEGRATION_CONTROL: namespace({ 'local-integration-control': control }),
    RECOVERY_REFERENCE: namespace({ 'trusted-reference': reference }),
    GRANT_AUTHORITY: namespace({ 'synthetic-security-authority': authority }),
    INTEGRATED_VAULTS: namespace(vaults), SYNTHETIC_VAULTS: namespace(vaults)
  }) as unknown as IntegrationEnv;
}
export function createHomologationHandler(ports: HomologationPorts) {
  const env = createHomologationEnvironment(ports);
  return (request: Request): Promise<Response> => integratedFetch(request, env);
}
