import type { StandingGrant } from '@friday/contracts'

/**
 * Where standing grants live.
 *
 * Injected for the same reason the capability store is: the Guardian decides,
 * and `packages/storage` owns the database.
 *
 * Reference: docs/01-bible/19-approval-system.md
 */
export interface GrantStore {
  put(grant: StandingGrant): void
  get(id: string): StandingGrant | undefined
  replace(grant: StandingGrant): void

  /**
   * Every grant belonging to one principal, live or not.
   *
   * Deliberately not "every *live* grant": expired and revoked grants are what
   * Chapter 19's renewal review is made of, and a store that could only return
   * live ones would make "you used this 23 times before it lapsed" unanswerable.
   *
   * @param principalId - Whose grants to list.
   * @returns The grants, in creation order.
   */
  listByPrincipal(principalId: string): readonly StandingGrant[]
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
    },

    get(id) {
      return byId.get(id)
    },

    replace(grant) {
      byId.set(grant.id, grant)
    },

    listByPrincipal(principalId) {
      return [...byId.values()].filter((grant) => grant.principalId === principalId)
    },
  }
}
