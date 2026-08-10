import { randomBytes } from 'node:crypto'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { KEY_LENGTH_BYTES } from './key-provider.js'
import { hasPassword, writeNewPassword } from './keychain.js'

/**
 * Bringing key material into existence.
 *
 * ── Why this is not a method on `KeyProvider` ───────────────────────────────
 *
 * `KeyProvider` is held by everything that reads a key: `openStorage`, and the
 * Guardian's capability issuer through its own structurally identical
 * `CapabilityKeyProvider`. Adding a write to that interface would widen every
 * one of those holders at once so that a single command, run once, can
 * provision — and would give the Guardian, structurally, the ability to write
 * key material. That is the inversion Article V forbids.
 *
 * ── The property that makes this safe ───────────────────────────────────────
 *
 * **Key material crosses this boundary in neither direction.** A caller cannot
 * supply a key and cannot read one back; generation happens in here, and the
 * only thing that comes out is whether an item was created. A general
 * read-and-write key interface could not make that promise. This one can, and
 * it is why granting the capability to exactly one command is acceptable.
 *
 * Only `friday init` constructs one of these. A second holder is a design
 * change rather than a convenience — see ADR-0035's review triggers.
 *
 * Reference: docs/adr/0035-first-run-provisioning-is-creation-only.md
 *            docs/adr/0020-key-material-comes-from-an-injected-key-provider.md
 */

/** What provisioning did. Never *what* was provisioned. */
export type ProvisionOutcome = 'created' | 'already-present'

export interface KeyProvisioner {
  /**
   * Ensures a key exists, creating it only if it does not.
   *
   * @param reference - The Keychain account name, e.g. `field-encryption-key`.
   * @returns Whether it was created or already there, or why neither happened.
   */
  provision(reference: string): Result<ProvisionOutcome, FridayError>

  /**
   * Reports whether a key exists, without reading it.
   *
   * Separate from `provision` because `friday init` has to answer "is the
   * field key here?" *before* deciding whether creating one would be safe, and
   * it must answer without the key value entering the process.
   */
  has(reference: string): boolean
}

/**
 * Provisions keys into the macOS Keychain.
 *
 * @param options - The Keychain service every FRIDAY credential lives under.
 * @returns A provisioner backed by the Keychain.
 */
export function createKeychainKeyProvisioner(options: { service: string }): KeyProvisioner {
  return {
    has(reference) {
      return hasPassword({ service: options.service, account: reference })
    },

    provision(reference) {
      // Generated here and never returned. The platform CSPRNG, at exactly the
      // length `decodeKey` will accept — a provisioner that wrote a key the
      // reader rejects would be a self-inflicted outage.
      const value = randomBytes(KEY_LENGTH_BYTES).toString('base64')
      const written = writeNewPassword({
        service: options.service,
        account: reference,
        value,
      })

      if (written.outcome === 'failed') {
        return err(
          fridayError({
            code: 'ENCRYPTION_KEY_UNAVAILABLE',
            message:
              `FRIDAY could not save the key "${reference}" to your Keychain. ` +
              'Nothing has been changed, and running setup again is safe.',
            // The reference is a name, not a secret. The value never appears
            // here, and must not be added to it.
            detail: { reference, service: options.service },
            cause: written.failure.cause,
          }),
        )
      }

      return ok(written.outcome)
    },
  }
}

/**
 * Provisions keys into a map.
 *
 * For tests. Every decision this component makes — create once, never replace,
 * report which happened — is exercised here, because the Keychain
 * implementation above is deliberately thin enough that the only thing left
 * behind it is the subprocess call itself.
 *
 * @param keys - The map to provision into. Mutated in place.
 * @returns A provisioner backed by the given map.
 */
export function createInMemoryKeyProvisioner(keys: Record<string, string>): KeyProvisioner {
  return {
    has(reference) {
      return keys[reference] !== undefined
    },

    provision(reference) {
      if (keys[reference] !== undefined) return ok('already-present')

      keys[reference] = randomBytes(KEY_LENGTH_BYTES).toString('base64')

      return ok('created')
    },
  }
}
