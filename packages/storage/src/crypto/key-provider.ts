import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { classifyReadFailure, type KeychainFailure, readPassword } from './keychain.js'

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
          describeReadFailure({ reference, service: options.service, failure: read.failure }),
        )
      }

      return decodeKey(read.value, reference)
    },
  }
}

/**
 * Explains why a key could not be read, in terms of what is actually wrong.
 *
 * ── Why this is not one message ─────────────────────────────────────────────
 *
 * The three reasons a read fails need three different actions from the owner,
 * and naming the key is only the useful part of one of them.
 *
 * **Locked** is the one this exists for. FRIDAY runs as a LaunchAgent started
 * at login, and a locked keychain refuses reads to a process that cannot ask
 * anyone — so the first thing she does on a fresh login can fail for a reason
 * that has nothing to do with her setup being wrong. Chapter 39 carries this as
 * a known M4 risk and predicted the failure would "name a key rather than a
 * timing problem". Leading with the key name would send the owner to check
 * their Keychain for an entry that is present and readable, and tell them
 * nothing about *when* she tried.
 *
 * **Absent** is a setup problem, and `friday init` is the answer.
 *
 * ★ The reference is a name, not a secret, and the key's value never appears
 * here. ADR-0020 and Chapter 18 both forbid it in an error, a log line, or an
 * event payload.
 *
 * @param input - The key's name, the Keychain service, and what `security` said.
 * @returns The error to report.
 */
export function describeReadFailure(input: {
  reference: string
  service: string
  failure: KeychainFailure
}): FridayError {
  const { reference, service, failure } = input
  const detail = { reference, service, status: failure.status }

  if (classifyReadFailure(failure) === 'locked') {
    return fridayError({
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
      message:
        'FRIDAY started before your Keychain was available, so she has stopped.\n\n' +
        '  Your login Keychain unlocks when you log in. She runs at login too, and this\n' +
        '  time she got there first — a locked Keychain refuses to answer a program that\n' +
        '  cannot ask you for a password, so she could not read what she needs to start.\n\n' +
        '  Nothing is wrong with her setup and nothing has been lost. She is supervised\n' +
        '  and will try again shortly; if she does not recover, unlocking your Mac and\n' +
        '  running `friday status` will say whether she can reach the Keychain now.',
      detail,
      cause: failure.cause,
    })
  }

  if (classifyReadFailure(failure) === 'absent') {
    return fridayError({
      code: 'ENCRYPTION_KEY_UNAVAILABLE',
      message:
        'FRIDAY has not been set up on this Mac yet, so she has stopped.\n\n' +
        `  The key she needs ("${reference}") is not in your Keychain. She creates her\n` +
        '  keys once, the first time she is set up, and she has not been.\n\n' +
        '  Run `friday init`.',
      detail,
      cause: failure.cause,
    })
  }

  return fridayError({
    code: 'ENCRYPTION_KEY_UNAVAILABLE',
    message:
      `FRIDAY could not read the key "${reference}" from your Keychain, and the reason\n` +
      `  is not one she recognises (your Mac reported ${failure.status ?? 'no status'}).\n\n` +
      '  Without it she cannot read anything she has stored privately, so she stops\n' +
      '  rather than continuing with the encrypted fields unreadable.',
    detail,
    cause: failure.cause,
  })
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
