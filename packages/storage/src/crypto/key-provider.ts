import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { readPassword } from './keychain.js'

/**
 * Where key material comes from.
 *
 * ★ No secret value is ever stored in SQLite. The database holds a *reference*
 * — the name of a Keychain entry — and the key itself lives in the macOS
 * Keychain, protected by the OS and the login password. A stolen `friday.db`
 * yields ciphertext and the names of some keychain entries.
 *
 * An interface rather than a direct Keychain call because the Keychain is not
 * reachable in CI, in a test, or on a machine that is not a Mac, and the
 * alternative to injecting it is tests that skip themselves — which is the
 * same as no tests.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 18
 */
export interface KeyProvider {
  /**
   * Fetches a key by reference.
   *
   * @param reference - The Keychain account name, e.g. `field-encryption-key`.
   * @returns A 32-byte key, or a typed error.
   */
  getKey(reference: string): Result<Buffer, FridayError>
}

/** AES-256 takes exactly this. A shorter key is a misconfiguration, not a hint. */
export const KEY_LENGTH_BYTES = 32

/**
 * Reads keys from the macOS Keychain.
 *
 * The `security` invocation itself lives in [`keychain.ts`](./keychain.ts),
 * shared with the provisioner — one timeout, one error shape, one place where
 * this process talks to the OS. What stays here is what this port is *for*:
 * turning a stored value into a validated key, or into a message about what
 * its absence costs.
 *
 * @param options - The Keychain service every FRIDAY credential lives under.
 * @returns A provider that reads from the Keychain.
 */
export function createKeychainKeyProvider(options: { service: string }): KeyProvider {
  return {
    getKey(reference) {
      const read = readPassword({ service: options.service, account: reference })

      if (!read.ok) {
        return err(
          fridayError({
            code: 'ENCRYPTION_KEY_UNAVAILABLE',
            message:
              `FRIDAY could not read the key "${reference}" from your Keychain. ` +
              'Without it she cannot read anything she has stored privately, so she stops ' +
              'rather than continuing with the encrypted fields unreadable.',
            // The reference is a name, not a secret. The value never appears
            // here, and must not be added to it.
            detail: { reference, service: options.service },
            cause: read.failure.cause,
          }),
        )
      }

      return decodeKey(read.value, reference)
    },
  }
}

/**
 * Holds keys in memory.
 *
 * For tests, and for the migration path where a key has just been generated
 * and not yet written to the Keychain. Never for normal operation — a key in a
 * process's memory is a key in a crash dump.
 *
 * @param keys - Reference to base64-encoded key.
 * @returns A provider backed by the given map.
 */
export function createInMemoryKeyProvider(keys: Readonly<Record<string, string>>): KeyProvider {
  return {
    getKey(reference) {
      const value = keys[reference]
      if (value === undefined) {
        return err(
          fridayError({
            code: 'ENCRYPTION_KEY_UNAVAILABLE',
            message: `No key named "${reference}" was provided.`,
            detail: { reference },
          }),
        )
      }

      return decodeKey(value, reference)
    },
  }
}

/**
 * Decodes a base64 key and checks its length.
 *
 * The length check matters more than it looks: Node's `createCipheriv` throws
 * on a wrong-length key, and a key that is silently truncated or padded
 * somewhere would produce ciphertext nothing can decrypt afterwards.
 */
function decodeKey(value: string, reference: string): Result<Buffer, FridayError> {
  const key = Buffer.from(value, 'base64')

  if (key.length !== KEY_LENGTH_BYTES) {
    return err(
      fridayError({
        code: 'ENCRYPTION_KEY_UNAVAILABLE',
        message:
          `The key "${reference}" is ${key.length} bytes; AES-256 needs ${KEY_LENGTH_BYTES}. ` +
          'It is stored base64-encoded.',
        detail: { reference, actualBytes: key.length },
      }),
    )
  }

  return ok(key)
}
