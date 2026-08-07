import { type Capability, type FridayError, ok, type Result } from '@friday/contracts'

/**
 * Where capability records live.
 *
 * An interface rather than a database call, for the same reason the key
 * provider is one: the Guardian decides and nothing else, and a package that
 * opened its own SQLite connection would be reaching past `packages/storage`.
 *
 * Every method returns `Result`, reads included — ADR-0027. A store that could
 * not report a failure would leave the Guardian unable to tell "this token is
 * not valid" from "I could not tell whether it is valid", and only the first
 * of those belongs in a decision record.
 *
 * The methods are synchronous because the real implementation is
 * `better-sqlite3`, which is. An async surface here would be a promise that is
 * always already resolved, and in the authorization path an unawaited promise
 * is a security bug rather than a race.
 *
 * Reference: docs/adr/0026-capability-tokens-are-signed-handles-to-kernel-state.md
 */
export interface CapabilityStore {
  /** Records a newly issued capability. */
  put(capability: Capability): Result<void, FridayError>

  /** Reads one capability. `undefined` means no such record, not a failure. */
  get(id: string): Result<Capability | undefined, FridayError>

  /** Overwrites an existing capability — a use being counted, or a revocation. */
  replace(capability: Capability): Result<void, FridayError>

  /**
   * Every capability issued for one plan, live or not.
   *
   * Exists so that cancelling a plan can withdraw everything it was holding in
   * one operation. A plan that stopped, leaving live permissions behind, is
   * the quiet version of the failure this package prevents.
   */
  listByPlan(planId: string): Result<readonly Capability[], FridayError>
}

/**
 * An in-memory capability store.
 *
 * For tests, and for the CLI before the storage layer is wired through at M3.
 * **Not for normal operation**: capabilities held only in memory do not survive
 * a restart, so a plan resuming after a crash would find its permissions gone
 * — which fails safe, but fails.
 *
 * Its error branches are never taken. That is correct for a test double: its
 * job is to have the same shape as the real thing.
 *
 * @returns A store backed by a map.
 */
export function createInMemoryCapabilityStore(): CapabilityStore {
  const byId = new Map<string, Capability>()

  return {
    put(capability) {
      byId.set(capability.id, capability)
      return ok(undefined)
    },

    get(id) {
      return ok(byId.get(id))
    },

    replace(capability) {
      byId.set(capability.id, capability)
      return ok(undefined)
    },

    listByPlan(planId) {
      return ok([...byId.values()].filter((capability) => capability.planId === planId))
    },
  }
}
