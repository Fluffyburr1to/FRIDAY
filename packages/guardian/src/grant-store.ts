import { type FridayError, ok, type Result, type StandingGrant } from '@friday/contracts'

/**
 * Where standing grants live.
 *
 * Injected for the same reason the capability store is: the Guardian decides,
 * and `packages/storage` owns the database. Every method returns `Result` —
 * ADR-0027.
 *
 * Reference: docs/01-bible/19-approval-system.md
 */
export interface GrantStore {
  put(grant: StandingGrant): Result<void, FridayError>
  get(id: string): Result<StandingGrant | undefined, FridayError>
  replace(grant: StandingGrant): Result<void, FridayError>

  /**
   * Every grant belonging to one principal, live or not.
   *
   * Deliberately not "every *live* grant": expired and revoked grants are what
   * Chapter 19's renewal review is made of, and a store that could only return
   * live ones would make "you used this 23 times before it lapsed"
   * unanswerable.
   */
  listByPrincipal(principalId: string): Result<readonly StandingGrant[], FridayError>
}

/**
 * An in-memory grant store, for tests and for the CLI before storage is wired
 * through. Grants held only in memory do not survive a restart.
 *
 * @returns A store backed by a map.
 */
export function createInMemoryGrantStore(): GrantStore {
  const byId = new Map<string, StandingGrant>()

  return {
    put(grant) {
      byId.set(grant.id, grant)
      return ok(undefined)
    },

    get(id) {
      return ok(byId.get(id))
    },

    replace(grant) {
      byId.set(grant.id, grant)
      return ok(undefined)
    },

    listByPrincipal(principalId) {
      return ok([...byId.values()].filter((grant) => grant.principalId === principalId))
    },
  }
}
