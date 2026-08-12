import { execFileSync } from 'node:child_process'

/**
 * Talking to the macOS Keychain.
 *
 * One module, because there are two ports over this — reading a key
 * ([`key-provider.ts`](./key-provider.ts)) and provisioning one
 * ([`key-provisioner.ts`](./key-provisioner.ts)) — and they are separate
 * *interfaces* that must not become separate *implementations*. Two
 * `execFileSync` call sites drift to two timeouts and two error mappings, and
 * the drift is invisible until the day one of them behaves differently on a
 * machine nobody is watching.
 *
 * Implemented by invoking `/usr/bin/security` rather than by linking a native
 * Keychain binding, for the reasons ADR-0020 records: a native module has to be
 * rebuilt for every Node and macOS version for the next decade, on the
 * component whose failure mode is "FRIDAY cannot decrypt anything she has
 * stored".
 *
 * ★ **No key material is ever passed as an argument.** An argument vector is
 * readable by any process on the machine, and `security`'s own usage text says
 * so: *"Use of the -p or -w options is insecure."* Writing goes over stdin.
 *
 * Reference: docs/adr/0020-key-material-comes-from-an-injected-key-provider.md
 *            docs/adr/0035-first-run-provisioning-is-creation-only.md
 */

/** Every external call gets a timeout (Chapter 30). This one runs at startup. */
const KEYCHAIN_TIMEOUT_MS = 5_000

const SECURITY = '/usr/bin/security'

/** `security` exits with this when an item exists and `-U` was not given. */
const ITEM_ALREADY_EXISTS = 45

/** `security` exits with this when there is no such item. */
const ITEM_NOT_FOUND = 44

/**
 * `security` exits with this when it needed to ask the owner and could not.
 *
 * ★ This is what a **locked** keychain looks like to a non-interactive process,
 * and it is the difference between "FRIDAY has not been set up" and "FRIDAY was
 * started before you unlocked your Mac". Chapter 39 carries the second as an M4
 * risk precisely because the two are indistinguishable unless something looks
 * at this number.
 */
const INTERACTION_NOT_ALLOWED = 128

/** What a failed read means, as far as the exit status can say. */
export type KeychainReadProblem = 'locked' | 'absent' | 'unknown'

/**
 * Classifies a failed Keychain read.
 *
 * Exported because the message a caller should print differs completely between
 * these, and because it is the one piece of this module testable without a Mac.
 *
 * @param failure - What the invocation reported.
 * @returns Which of the three situations this is.
 */
export function classifyReadFailure(failure: KeychainFailure): KeychainReadProblem {
  if (failure.status === INTERACTION_NOT_ALLOWED) return 'locked'
  if (failure.status === ITEM_NOT_FOUND) return 'absent'

  return 'unknown'
}

/** What a failed `security` invocation tells us, without its output. */
export interface KeychainFailure {
  readonly status: number | null
  readonly cause: unknown
}

/** Narrows a thrown `execFileSync` error to the part worth acting on. */
function failureOf(cause: unknown): KeychainFailure {
  const status = (cause as { status?: unknown }).status

  return { status: typeof status === 'number' ? status : null, cause }
}

/**
 * Reads a password out of the Keychain.
 *
 * @param input - The service and account naming the item.
 * @returns The stored value, or why it could not be read.
 */
export function readPassword(input: {
  service: string
  account: string
}): { ok: true; value: string } | { ok: false; failure: KeychainFailure } {
  try {
    const value = execFileSync(
      SECURITY,
      ['find-generic-password', '-w', '-s', input.service, '-a', input.account],
      { encoding: 'utf8', timeout: KEYCHAIN_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] },
    ).trim()

    return { ok: true, value }
  } catch (cause) {
    return { ok: false, failure: failureOf(cause) }
  }
}

/**
 * Reports whether an item exists, without materialising its value.
 *
 * ★ Deliberately **not** `readPassword` with the result discarded. Omitting
 * `-w` makes `security` print attributes rather than the secret, so asking
 * "is this key here?" never brings key material into this process at all —
 * which is what lets `friday init` check for a key it is forbidden to read.
 *
 * @param input - The service and account naming the item.
 * @returns True when the item is present.
 */
export function hasPassword(input: { service: string; account: string }): boolean {
  try {
    execFileSync(SECURITY, ['find-generic-password', '-s', input.service, '-a', input.account], {
      encoding: 'utf8',
      timeout: KEYCHAIN_TIMEOUT_MS,
      stdio: ['ignore', 'ignore', 'ignore'],
    })

    return true
  } catch {
    return false
  }
}

/**
 * Writes a new password, refusing to replace one that is already there.
 *
 * Two properties, both load-bearing, and both obtained by *not* doing
 * something:
 *
 * **`-U` is omitted**, so an existing item makes `security` fail with status
 * 45 rather than overwrite. The safe behaviour is the one the OS enforces, not
 * one this module remembers to check for — and overwriting a field-encryption
 * key would make every value encrypted under the old one unreadable forever.
 *
 * **`-w` is last and carries no value**, which makes `security` read the
 * password from stdin instead of from `argv`. It prompts twice for
 * confirmation, so the value is written twice.
 *
 * @param input - The service, the account, and the value to store.
 * @returns Whether it was created, already there, or failed.
 */
export function writeNewPassword(input: {
  service: string
  account: string
  value: string
}): { outcome: 'created' | 'already-present' } | { outcome: 'failed'; failure: KeychainFailure } {
  try {
    execFileSync(
      SECURITY,
      ['add-generic-password', '-s', input.service, '-a', input.account, '-w'],
      {
        // The value, twice, because the tool asks for confirmation. This is
        // the only place key material exists outside a Buffer, and it goes to
        // a pipe rather than to a command line.
        input: `${input.value}\n${input.value}\n`,
        encoding: 'utf8',
        timeout: KEYCHAIN_TIMEOUT_MS,
        stdio: ['pipe', 'ignore', 'ignore'],
      },
    )

    return { outcome: 'created' }
  } catch (cause) {
    const failure = failureOf(cause)

    if (failure.status === ITEM_ALREADY_EXISTS) return { outcome: 'already-present' }

    return { outcome: 'failed', failure }
  }
}
