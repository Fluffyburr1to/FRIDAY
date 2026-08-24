import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import {
  classifyReadFailure,
  deletePassword,
  hasPassword,
  type KeychainReadProblem,
  readPassword,
  writeNewPassword,
} from './keychain.js'

/**
 * Where the secrets actually sit, addressed by account alone.
 *
 * ★ The service is bound before this port exists, so the lifecycle below
 * cannot name a namespace at all — not even its own. That is what keeps
 * [ADR-0050](../../../../docs/adr/0050-revocation-is-a-credential-domain-operation.md)
 * §1 a property of the code rather than a habit of its authors.
 *
 * It also lets the state machine — the part actually worth getting right — be
 * tested exhaustively without a Mac, a Keychain, or a prompt.
 */
export interface CredentialItems {
  has(account: string): boolean
  read(account: string): { ok: true; value: string } | { ok: false; problem: KeychainReadProblem }
  write(account: string, value: string): 'created' | 'already-present' | 'failed'
  remove(account: string): 'deleted' | 'absent' | 'failed'
}

/**
 * Where a connector's credential lives, and what state it is in.
 *
 * The third port over the one Keychain implementation, alongside `KeyProvider`
 * and `KeyProvisioner` —
 * [ADR-0050](../../../../docs/adr/0050-revocation-is-a-credential-domain-operation.md).
 *
 * ★ **The credential store cannot name an encryption key.** It is bound at
 * construction to a Keychain service of its own, separate from the one holding
 * `field-encryption-key`, and that service is never a parameter to any method.
 * The guarantee is structural rather than careful: the encryption key is not
 * merely hard to address from here, it is **not in the space this store can
 * address at all.** Deleting it would destroy every encrypted field in the
 * database, and there is no copy of it inside FRIDAY.
 *
 * ★★ **Revocation is a state, not the absence of a value.** A revoked
 * credential does not become usable again because something wrote a value
 * under the same identity. Article III: revocation is the owner saying no, and
 * a "no" that expires the next time some code path stores something is not a
 * no. Returning to service is `reprovision`, which says so.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 18 · ADR-0035
 */

/** What FRIDAY knows about one connector's credential. */
export type CredentialState = 'absent' | 'available' | 'revoked'

export interface CredentialStore {
  /** Which of the three states this credential is in. */
  stateOf(connectorId: string): Result<CredentialState, FridayError>

  /** The secret, and only while it is `available`. */
  read(connectorId: string): Result<string, FridayError>

  /**
   * First-time setup. Refuses when one already exists, and refuses when the
   * credential was revoked — ADR-0035's creation-only rule, extended so that
   * an ordinary write cannot undo a revocation.
   */
  provision(connectorId: string, secret: string): Result<'created', FridayError>

  /**
   * Deliberately putting a revoked credential back into service.
   *
   * Separate from `provision` because it is a different decision: this one
   * overrides something the owner previously refused, and the name is what
   * makes that visible at the call site and in review.
   */
  reprovision(connectorId: string, secret: string): Result<'created', FridayError>

  /** Withdraw it. Idempotent, and durable against later writes. */
  revoke(connectorId: string): Result<void, FridayError>
}

/**
 * Connector ids are validated before they become part of an item name.
 *
 * ★ The same shape a connector manifest requires. A caller cannot supply a
 * path, a wildcard, or another item's name — so the account this store derives
 * is always one it owns.
 */
const CONNECTOR_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
const MAX_CONNECTOR_ID = 128

export interface CredentialStoreOptions {
  /** The Keychain service holding connector credentials, and nothing else. */
  readonly service: string

  /**
   * The service holding encryption and model keys.
   *
   * Supplied only so construction can refuse when the two are the same. A
   * copy-paste in a config file then fails loudly at startup rather than
   * quietly at the moment of a revocation.
   */
  readonly keyService: string
}

function invalid(connectorId: string): FridayError {
  return fridayError({
    code: 'CONFIG_INVALID',
    message: `"${connectorId}" is not a connector id, so FRIDAY will not look for a credential under it.`,
    detail: { connectorId },
  })
}

/** The two items one connector may have, and no others. */
function accounts(connectorId: string): { secret: string; tombstone: string } {
  return { secret: `connector.${connectorId}`, tombstone: `revoked.${connectorId}` }
}

/**
 * Builds a Keychain-backed credential store.
 *
 * @param options - The credential service, and the key service it must differ from.
 * @returns The store, or a failure when the two services collide.
 */
export function createCredentialStore(items: CredentialItems): CredentialStore {
  function check(connectorId: string): FridayError | null {
    if (connectorId.length === 0 || connectorId.length > MAX_CONNECTOR_ID) {
      return invalid(connectorId)
    }
    return CONNECTOR_ID.test(connectorId) ? null : invalid(connectorId)
  }

  function stateOf(connectorId: string): Result<CredentialState, FridayError> {
    const bad = check(connectorId)
    if (bad !== null) return err(bad)

    const { secret, tombstone } = accounts(connectorId)

    // ★ The tombstone is checked FIRST and wins outright. A value written
    // under the same identity while a revocation stands does not resurrect it.
    if (items.has(tombstone)) return ok('revoked')

    return ok(items.has(secret) ? 'available' : 'absent')
  }

  function store(connectorId: string, secret: string): Result<'created', FridayError> {
    const written = items.write(accounts(connectorId).secret, secret)

    if (written !== 'created') {
      return err(
        fridayError({
          code: 'CREDENTIAL_UNAVAILABLE',
          message: `FRIDAY could not store the key for ${connectorId}.`,
          detail: { connectorId, outcome: written },
        }),
      )
    }

    return ok('created')
  }

  return {
    stateOf,

    read(connectorId: string): Result<string, FridayError> {
      const state = stateOf(connectorId)
      if (!state.ok) return state

      // ★ A secret is returned only while the credential is `available`. Not
      // "if the item happens to exist" — a revoked credential with a stale
      // value still present must never be handed out.
      if (state.value !== 'available') {
        return err(
          fridayError({
            code: state.value === 'revoked' ? 'CREDENTIAL_REVOKED' : 'CREDENTIAL_UNAVAILABLE',
            message:
              state.value === 'revoked'
                ? `You disconnected ${connectorId}, so FRIDAY has no key for it.`
                : `${connectorId} has not been connected yet.`,
            detail: { connectorId, state: state.value },
          }),
        )
      }

      const result = items.read(accounts(connectorId).secret)
      if (result.ok) return ok(result.value)

      return err(
        fridayError({
          code: 'CREDENTIAL_UNAVAILABLE',
          message:
            result.problem === 'locked'
              ? `FRIDAY could not reach the key for ${connectorId} — your Keychain is locked.`
              : `FRIDAY could not read the key for ${connectorId}.`,
          detail: { connectorId, problem: result.problem },
        }),
      )
    },

    provision(connectorId: string, secret: string): Result<'created', FridayError> {
      const state = stateOf(connectorId)
      if (!state.ok) return state

      // ★ An ordinary write cannot undo a revocation. This is the branch that
      // makes "no" durable rather than valid until the next code path stores
      // something.
      if (state.value === 'revoked') {
        return err(
          fridayError({
            code: 'CREDENTIAL_REVOKED',
            message: `${connectorId} was disconnected. Reconnecting it is a separate, deliberate step.`,
            detail: { connectorId },
          }),
        )
      }

      if (state.value === 'available') {
        return err(
          fridayError({
            code: 'CONFIG_INVALID',
            message: `${connectorId} already has a key, and FRIDAY never replaces one silently.`,
            detail: { connectorId },
          }),
        )
      }

      return store(connectorId, secret)
    },

    reprovision(connectorId: string, secret: string): Result<'created', FridayError> {
      const bad = check(connectorId)
      if (bad !== null) return err(bad)

      const { secret: account, tombstone } = accounts(connectorId)

      // Clearing the tombstone IS the decision. Everything after it is an
      // ordinary first-time provisioning again.
      if (items.remove(tombstone) === 'failed') {
        return err(
          fridayError({
            code: 'CREDENTIAL_UNAVAILABLE',
            message: `FRIDAY could not clear the disconnection on ${connectorId}.`,
            detail: { connectorId },
          }),
        )
      }

      // A stale value may still be there from before the revocation, and the
      // write below refuses to replace an existing item.
      if (items.remove(account) === 'failed') {
        return err(
          fridayError({
            code: 'CREDENTIAL_UNAVAILABLE',
            message: `FRIDAY could not clear the old key for ${connectorId}.`,
            detail: { connectorId },
          }),
        )
      }

      return store(connectorId, secret)
    },

    revoke(connectorId: string): Result<void, FridayError> {
      const bad = check(connectorId)
      if (bad !== null) return err(bad)

      const { secret: account, tombstone } = accounts(connectorId)

      if (items.remove(account) === 'failed') {
        return err(
          fridayError({
            code: 'CREDENTIAL_UNAVAILABLE',
            message: `FRIDAY could not remove the key for ${connectorId}.`,
            detail: { connectorId },
          }),
        )
      }

      // ★ Written AFTER the material is gone. Ordered this way because the
      // dangerous failure is a credential that still works while FRIDAY
      // believes it is revoked. The reverse — a tombstone with no material —
      // is simply a revoked credential, which is the intent.
      const marked = items.write(tombstone, 'revoked')

      if (marked === 'failed') {
        return err(
          fridayError({
            code: 'CREDENTIAL_UNAVAILABLE',
            message: `FRIDAY removed the key for ${connectorId} but could not record that you disconnected it.`,
            detail: { connectorId },
          }),
        )
      }

      return ok(undefined)
    },
  }
}

/**
 * Builds a Keychain-backed credential store.
 *
 * @param options - The credential service, and the key service it must differ from.
 * @returns The store, or a failure when the two services collide.
 */
export function createKeychainCredentialStore(
  options: CredentialStoreOptions,
): Result<CredentialStore, FridayError> {
  // ★ ADR-0050 §1, belt and braces. A copy-paste in a config file fails loudly
  // here rather than quietly at the moment of a revocation.
  if (options.service === options.keyService) {
    return err(
      fridayError({
        code: 'CONFIG_INVALID',
        message:
          'Connector credentials must not share a Keychain service with encryption keys, because revoking one could then reach the other.',
        detail: { service: options.service },
      }),
    )
  }

  const service = options.service

  return ok(
    createCredentialStore({
      has: (account) => hasPassword({ service, account }),

      read: (account) => {
        const result = readPassword({ service, account })
        if (result.ok) return { ok: true, value: result.value }
        return { ok: false, problem: classifyReadFailure(result.failure) }
      },

      write: (account, value) => writeNewPassword({ service, account, value }).outcome,
      remove: (account) => deletePassword({ service, account }).outcome,
    }),
  )
}

/**
 * A credential store held in memory.
 *
 * Matches `createInMemoryKeyProvider`: the same lifecycle, without a Mac.
 *
 * @returns A store backed by a map.
 */
export function createInMemoryCredentialStore(): CredentialStore {
  const items = new Map<string, string>()

  return createCredentialStore({
    has: (account) => items.has(account),
    read: (account) => {
      const value = items.get(account)
      return value === undefined ? { ok: false, problem: 'absent' } : { ok: true, value }
    },
    write: (account, value) => {
      if (items.has(account)) return 'already-present'
      items.set(account, value)
      return 'created'
    },
    remove: (account) => (items.delete(account) ? 'deleted' : 'absent'),
  })
}
