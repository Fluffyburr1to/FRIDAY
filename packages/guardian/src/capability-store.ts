import type { Capability } from '@friday/contracts'

/**
 * Where capability records live.
 *
 * An interface rather than a database call, for the same reason the key
 * provider is one: the Guardian decides and nothing else, and a package that
 * opened its own SQLite connection would be reaching past
 * `packages/storage` — which the boundary rules forbid, and which would give
 * the system two components that believe they own the same rows.
 *
 * The methods are synchronous because the real implementation is
 * `better-sqlite3`, which is. An async surface here would be a promise that is
 * always already resolved, and it would make the authorization path — the one
 * place where an unawaited promise is a security bug rather than a race —
 * harder to read for no benefit.
 *
 * Reference: docs/adr/0026-capability-tokens-are-signed-handles-to-kernel-state.md
 */
export interface CapabilityStore {
  /**
   * Records a newly issued capability.
   *
   * @param capability - The complete record, already validated.
   */
  put(capability: Capability): void

  /**
   * Reads one capability.
   *
   * @param id - The identifier carried in the token.
   * @returns The record, or undefined when nothing was ever issued under it.
   */
  get(id: string): Capability | undefined

  /**
   * Overwrites an existing capability — a use being counted, or a revocation.
   *
   * @param capability - The record in its new state.
   */
  replace(capability: Capability): void

  /**
   * Every capability issued for one plan, live or not.
   *
   * Exists so that cancelling a plan can withdraw everything it was holding in
   * one operation. A plan that stopped, leaving live permissions behind, is
   * the quiet version of the failure this whole package prevents.
   *
   * @param planId - The plan whose capabilities to list.
   * @returns The records, in issuance order.
   */
  listByPlan(planId: string): readonly Capability[]
}

/**
 * An in-memory capability store.
 *
 * For tests, and for the CLI before the storage layer is wired through at M3.
 * **Not for normal operation**: capabilities held only in memory do not survive
 * a restart, so a plan resuming after a crash would find its permissions gone
 * — which fails safe, but fails.
 *
 * @returns A store backed by a map.
 */
export function createInMemoryCapabilityStore(): CapabilityStore {
  const byId = new Map<string, Capability>()

  return {
    put(capability) {
      byId.set(capability.id, capability)
    },

    get(id) {
      return byId.get(id)
    },

    replace(capability) {
      byId.set(capability.id, capability)
    },

    listByPlan(planId) {
      return [...byId.values()].filter((capability) => capability.planId === planId)
    },
  }
}
