import { isErr, isOk } from '@friday/contracts'
import {
  type CredentialItems,
  type CredentialStore,
  createCredentialStore,
  createInMemoryCredentialStore,
  createKeychainCredentialStore,
} from '@friday/storage'
import { beforeEach, describe, expect, it } from 'vitest'

const CONNECTOR = 'open-meteo'
const SECRET = 'not-a-real-key'

let store: CredentialStore

beforeEach(() => {
  store = createInMemoryCredentialStore()
})

describe('the three states', () => {
  it('starts absent', () => {
    const state = store.stateOf(CONNECTOR)

    expect(isOk(state) && state.value).toBe('absent')
  })

  it('becomes available once provisioned', () => {
    store.provision(CONNECTOR, SECRET)

    const state = store.stateOf(CONNECTOR)
    expect(isOk(state) && state.value).toBe('available')
  })

  it('becomes revoked, which is not the same as absent', () => {
    // ★ The distinction the whole design turns on. "Never set up" and
    // "deliberately withdrawn" must not be the same answer.
    store.provision(CONNECTOR, SECRET)
    store.revoke(CONNECTOR)

    const state = store.stateOf(CONNECTOR)
    expect(isOk(state) && state.value).toBe('revoked')
  })

  it('can be revoked before it was ever provisioned', () => {
    expect(isOk(store.revoke(CONNECTOR))).toBe(true)

    const state = store.stateOf(CONNECTOR)
    expect(isOk(state) && state.value).toBe('revoked')
  })

  it('can be revoked twice', () => {
    store.provision(CONNECTOR, SECRET)
    store.revoke(CONNECTOR)

    // The second revocation must not fail on the tombstone already existing.
    expect(isOk(store.revoke(CONNECTOR))).toBe(true)
  })
})

describe('a revocation does not wear off', () => {
  beforeEach(() => {
    store.provision(CONNECTOR, SECRET)
    store.revoke(CONNECTOR)
  })

  it('refuses an ordinary provisioning afterwards', () => {
    // ★ Article III. Revocation is the owner saying no, and a "no" that
    // expires the next time some code path stores a value is not a no.
    const again = store.provision(CONNECTOR, 'a-different-key')

    expect(isErr(again)).toBe(true)
    if (isErr(again)) expect(again.error.code).toBe('CREDENTIAL_REVOKED')
  })

  it('stays revoked after that refused attempt', () => {
    store.provision(CONNECTOR, 'a-different-key')

    const state = store.stateOf(CONNECTOR)
    expect(isOk(state) && state.value).toBe('revoked')
  })

  it('refuses to hand out a secret', () => {
    const read = store.read(CONNECTOR)

    expect(isErr(read)).toBe(true)
    if (isErr(read)) expect(read.error.code).toBe('CREDENTIAL_REVOKED')
  })

  it('refuses to hand out a secret even if the material is somehow still there', () => {
    // ★ The tombstone is authoritative, not the presence of a value. A stale
    // item left behind by a partial failure must not become usable again.
    const items = new Map<string, string>()
    const leaky: CredentialItems = {
      has: (account) => items.has(account),
      read: (account) => {
        const value = items.get(account)
        return value === undefined ? { ok: false, problem: 'absent' } : { ok: true, value }
      },
      write: (account, value) => {
        items.set(account, value)
        return 'created'
      },
      // A store whose deletion silently does nothing — the partial failure
      // this ordering is meant to survive.
      remove: () => 'deleted',
    }
    const leakyStore = createCredentialStore(leaky)

    leakyStore.provision(CONNECTOR, SECRET)
    leakyStore.revoke(CONNECTOR)

    const read = leakyStore.read(CONNECTOR)
    expect(isErr(read)).toBe(true)
    if (isErr(read)) expect(read.error.code).toBe('CREDENTIAL_REVOKED')
  })

  it('comes back only through the operation that says so', () => {
    const back = store.reprovision(CONNECTOR, 'a-new-key')

    expect(isOk(back)).toBe(true)
    const state = store.stateOf(CONNECTOR)
    expect(isOk(state) && state.value).toBe('available')

    const read = store.read(CONNECTOR)
    expect(isOk(read) && read.value).toBe('a-new-key')
  })
})

describe('provisioning never replaces silently', () => {
  it('refuses a second provisioning while one is live, and says why', () => {
    // ADR-0035's creation-only rule, carried into the credential domain.
    //
    // ★ The error code is asserted, not merely that it failed. Without the
    // explicit check, the underlying store's create-only write refuses anyway
    // — but reports "FRIDAY could not store the key", which reads as a
    // Keychain problem and would send someone to debug the wrong thing. The
    // truthful answer is that one is already there.
    store.provision(CONNECTOR, SECRET)

    const again = store.provision(CONNECTOR, 'a-different-key')

    expect(isErr(again)).toBe(true)
    if (isErr(again)) {
      expect(again.error.code).toBe('CONFIG_INVALID')
      expect(again.error.message).toContain('already has a key')
    }

    const read = store.read(CONNECTOR)
    expect(isOk(read) && read.value).toBe(SECRET)
  })

  it('replaces on an explicit reprovision, even when one is live', () => {
    store.provision(CONNECTOR, SECRET)

    expect(isOk(store.reprovision(CONNECTOR, 'a-new-key'))).toBe(true)

    const read = store.read(CONNECTOR)
    expect(isOk(read) && read.value).toBe('a-new-key')
  })
})

describe('reading', () => {
  it('returns nothing before it is set up', () => {
    const read = store.read(CONNECTOR)

    expect(isErr(read)).toBe(true)
    if (isErr(read)) expect(read.error.code).toBe('CREDENTIAL_UNAVAILABLE')
  })

  it('returns the secret when it is available', () => {
    store.provision(CONNECTOR, SECRET)

    const read = store.read(CONNECTOR)
    expect(isOk(read) && read.value).toBe(SECRET)
  })
})

describe('what a caller may name', () => {
  it.each(['Open-Meteo', 'open_meteo', '../field-encryption-key', 'open meteo', '', '*'])(
    'refuses %s as a connector id',
    (id) => {
      // ★ A caller cannot supply a path, a wildcard, or another item's name.
      // The account this store derives is always one it owns.
      expect(isErr(store.stateOf(id))).toBe(true)
      expect(isErr(store.revoke(id))).toBe(true)
      expect(isErr(store.provision(id, SECRET))).toBe(true)
      expect(isErr(store.reprovision(id, SECRET))).toBe(true)
    },
  )

  it('refuses an id longer than any real connector', () => {
    expect(isErr(store.stateOf('a'.repeat(129)))).toBe(true)
  })

  it('never touches an account outside its own two', () => {
    // The store owns exactly two accounts per connector and nothing else.
    const touched: string[] = []
    const items = new Map<string, string>()
    const watched: CredentialItems = {
      has: (account) => {
        touched.push(account)
        return items.has(account)
      },
      read: (account) => {
        touched.push(account)
        const value = items.get(account)
        return value === undefined ? { ok: false, problem: 'absent' } : { ok: true, value }
      },
      write: (account, value) => {
        touched.push(account)
        items.set(account, value)
        return 'created'
      },
      remove: (account) => {
        touched.push(account)
        return items.delete(account) ? 'deleted' : 'absent'
      },
    }
    const watchedStore = createCredentialStore(watched)

    watchedStore.provision(CONNECTOR, SECRET)
    watchedStore.read(CONNECTOR)
    watchedStore.revoke(CONNECTOR)
    watchedStore.reprovision(CONNECTOR, SECRET)

    expect(new Set(touched)).toEqual(new Set(['connector.open-meteo', 'revoked.open-meteo']))
  })
})

describe('the two namespaces cannot be the same', () => {
  it('refuses to build a store sharing a service with the encryption keys', () => {
    // ★ ADR-0050 §1. A copy-paste in a config file fails loudly at startup
    // rather than quietly at the moment of a revocation — where it would mean
    // deleting the key that decrypts the entire database.
    const built = createKeychainCredentialStore({
      service: 'com.friday.credentials',
      keyService: 'com.friday.credentials',
    })

    expect(isErr(built)).toBe(true)
    if (isErr(built)) expect(built.error.code).toBe('CONFIG_INVALID')
  })

  it('builds when they differ', () => {
    const built = createKeychainCredentialStore({
      service: 'com.friday.connector-credentials',
      keyService: 'com.friday.credentials',
    })

    expect(isOk(built)).toBe(true)
  })
})
