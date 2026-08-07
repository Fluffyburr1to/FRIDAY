import { err, type FridayError, fridayError } from '@friday/contracts'
import {
  type ApprovalStore,
  type CapabilityStore,
  createInMemoryApprovalStore,
  createInMemoryCapabilityStore,
  createInMemoryGrantStore,
  type GrantStore,
} from '@friday/guardian'

/**
 * Stores that fail on demand.
 *
 * ADR-0027 made every store method able to report failure, and the whole point
 * of that change is what happens next: a Guardian that cannot reach its own
 * records must not answer as though it had consulted them. That behaviour is
 * unreachable without a store that can fail, so these exist.
 *
 * They wrap the real in-memory stores rather than reimplementing them, so a
 * method that is not being failed behaves exactly as it does in every other
 * test.
 */

/** The failure a store reports when told to. */
export const STORAGE_DOWN: FridayError = fridayError({
  code: 'STORAGE_UNAVAILABLE',
  message: 'The database could not be read.',
})

const failure = err(STORAGE_DOWN)

/**
 * Wraps a store so that the named methods fail.
 *
 * @param store - The working store to wrap.
 * @param failing - Which methods should report a failure.
 * @returns A store that fails exactly where asked and works everywhere else.
 */
function failingStore<T extends object>(store: T, failing: ReadonlySet<string>): T {
  return new Proxy(store, {
    get(target, property, receiver) {
      if (typeof property === 'string' && failing.has(property)) {
        return () => failure
      }
      return Reflect.get(target, property, receiver) as unknown
    },
  })
}

/**
 * A capability store that fails on the named methods.
 *
 * @param failing - Method names, e.g. `['put']`.
 * @returns The store.
 */
export function capabilityStoreFailing(...failing: (keyof CapabilityStore)[]): CapabilityStore {
  return failingStore(createInMemoryCapabilityStore(), new Set<string>(failing))
}

/**
 * A grant store that fails on the named methods.
 *
 * @param failing - Method names, e.g. `['listByPrincipal']`.
 * @returns The store.
 */
export function grantStoreFailing(...failing: (keyof GrantStore)[]): GrantStore {
  return failingStore(createInMemoryGrantStore(), new Set<string>(failing))
}

/**
 * An approval store that fails on the named methods.
 *
 * @param failing - Method names, e.g. `['replace']`.
 * @returns The store.
 */
export function approvalStoreFailing(...failing: (keyof ApprovalStore)[]): ApprovalStore {
  return failingStore(createInMemoryApprovalStore(), new Set<string>(failing))
}

/**
 * Wraps a working store so that writes start failing partway through a test.
 *
 * Needed because several paths write only after a successful read, so a store
 * that failed from the start would never reach them.
 *
 * @param store - The store to wrap.
 * @param method - The method to break.
 * @returns The store, and a switch that breaks it.
 */
export function breakableStore<T extends object>(
  store: T,
  method: string,
): { store: T; breakIt: () => void } {
  let broken = false

  return {
    store: new Proxy(store, {
      get(target, property, receiver) {
        if (broken && property === method) return () => failure
        return Reflect.get(target, property, receiver) as unknown
      },
    }),
    breakIt: () => {
      broken = true
    },
  }
}
