import { z } from 'zod';
import type { JSONWebKeySet } from 'jose';
import type { Command } from '../integration/contracts';
import { createReadServiceClient, PortUnavailable } from './service-client';
export { PortUnavailable, PORT_DEADLINE_MS, EXECUTION_PORT_DEADLINE_MS } from './service-client';
import { materialSchema, type Materials, type Account } from '../vault/model';
import type { Binding } from '../integration/registry';

export const LOCAL_MODE = 'B4_M1_FICTIONAL_LOCAL_ONLY';
type Service = Pick<Fetcher, 'fetch'>;
export interface HomologationBindings {
  HML_MODE: string;
  HML_JWKS: JSONWebKeySet;
  HML_MATERIAL: Materials;
  HML_IDENTITY: Service;
  HML_REGISTRY: Service;
  HML_REFERENCE: Service;
  HML_VAULTS: Service;
}
// Read capabilities only. There is no seed, restore, mutate, refresh, connect or MFA assertion port.
export interface HomologationPorts {
  readonly mode: typeof LOCAL_MODE;
  readonly jwks: JSONWebKeySet;
  readonly material: Materials;
  readonly identity: {
    issue(input: unknown): Promise<unknown>;
    lookup(input: unknown, consume?: boolean): Promise<unknown>;
    cancel(handle: string): Promise<void>;
  };
  readonly registry: {
    snapshot(): Promise<{ revision: number; deadlineMs: number }>;
    resolve(account: Account): Promise<Binding>;
    barrier(input: unknown): Promise<void>;
    event(input: unknown): Promise<void>;
  };
  readonly reference: {
    current(): Promise<unknown>;
    permissions(pair: { account: Account; subject: string }, required: 'read'): Promise<readonly ('read' | 'connect')[]>;
  };
  readonly vaults: {
    execute(account: Account, command: Command): Promise<unknown>;
    assertPrepared(account: Account, prepared: unknown): Promise<unknown>;
  };
}
const snapshotSchema = z.strictObject({
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER - 1),
  deadlineMs: z.number().int().min(100).max(15000)
});
const publicJwks = z.strictObject({ keys: z.array(z.strictObject({
  kty: z.literal('RSA'), alg: z.literal('RS256'), use: z.literal('sig'),
  kid: z.literal('synthetic-ephemeral'), n: z.string().regex(/^[\w-]{300,1000}$/), e: z.literal('AQAB')
})).length(1) });
const expectedBindings = ['HML_MODE','HML_JWKS','HML_MATERIAL','HML_IDENTITY','HML_REGISTRY','HML_REFERENCE','HML_VAULTS'].sort();

export function createBoundPorts(input: HomologationBindings): HomologationPorts {
  if (!input || input.HML_MODE !== LOCAL_MODE
    || JSON.stringify(Object.keys(input).sort()) !== JSON.stringify(expectedBindings)) throw new PortUnavailable();
  const jwks = publicJwks.parse(input.HML_JWKS);
  const material = materialSchema.parse(input.HML_MATERIAL);
  const services = { identity: input.HML_IDENTITY, registry: input.HML_REGISTRY,
    reference: input.HML_REFERENCE, vaults: input.HML_VAULTS };
  if (Object.values(services).some(s => !s || typeof s.fetch !== 'function')) throw new PortUnavailable();
  const call = createReadServiceClient(services);
  const ports: HomologationPorts = {
    mode: LOCAL_MODE, jwks, material,
    identity: Object.freeze({
      issue: (input: unknown) => call('identity', 'issue', input),
      lookup: (input: unknown, consume = false) => call('identity', 'lookup', { input, consume }),
      cancel: async (handle: string) => { await call('identity', 'cancel', handle); }
    }),
    registry: Object.freeze({
      snapshot: async () => snapshotSchema.parse(await call('registry', 'snapshot', null)),
      resolve: async (account: Account) => await call('registry', 'resolve', account) as Binding,
      barrier: async (input: unknown) => { await call('registry', 'barrier', input); },
      event: async (input: unknown) => { await call('registry', 'event', input); }
    }),
    reference: Object.freeze({
      current: () => call('reference', 'current', null),
      permissions: async (pair: { account: Account; subject: string }, required: 'read') =>
        z.array(z.enum(['read', 'connect'])).max(2).parse(await call('reference', 'permissions', { pair, required }))
    }),
    vaults: Object.freeze({
      execute: (account: Account, command: Command) => call('vaults', 'execute', { account, command }),
      assertPrepared: (account: Account, prepared: unknown) => call('vaults', 'assertPrepared', { account, prepared })
    })
  };
  return Object.freeze(ports);
}
