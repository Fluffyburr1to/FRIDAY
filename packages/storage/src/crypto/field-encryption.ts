import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import type { KeyProvider } from './key-provider.js'

/**
 * Field-level encryption for `private` data.
 *
 * Field-level rather than whole-database, and the reasoning is worth keeping
 * in front of whoever changes this. SQLCipher was the leading alternative and
 * is simpler to reason about. It was rejected because it makes the file opaque
 * to ordinary tooling — you could no longer open your own data in a SQLite
 * browser — which undermines "your data belongs to you" in a practical way,
 * and because it prevents indexing anything.
 *
 * The cost is that the *classification* has to be right. A field misclassified
 * as `internal` is stored in the clear. That is why sensitivity is a required
 * property on every schema in `contracts` — it can be decided wrongly, but it
 * cannot be forgotten.
 *
 * AES-256-GCM: authenticated, so tampering with a stored value is detected on
 * read rather than producing plausible garbage. Never hand-rolled, and never
 * anything other than Node's own `crypto`.
 *
 * Reference: docs/01-bible/09-database-design.md
 */

const ALGORITHM = 'aes-256-gcm'

/** 96 bits is the size GCM is specified for; other sizes weaken it. */
const IV_LENGTH_BYTES = 12
const TAG_LENGTH_BYTES = 16

/**
 * Marks a stored value as ciphertext, so a reader can tell without a schema.
 *
 * A column that may hold either plaintext or ciphertext needs this: without a
 * marker, deciding whether to decrypt means guessing, and guessing wrong on a
 * value that merely looks like base64 corrupts it.
 */
const PREFIX = 'enc:v1:'

/**
 * Encrypts a string.
 *
 * The output is `enc:v1:<base64 of iv || ciphertext || tag>`. The version in
 * the prefix is what makes an algorithm change possible later without a
 * migration that has to rewrite every row at once.
 *
 * @param input - The plaintext, the key reference, and the provider to get it.
 * @returns The encoded ciphertext, or a typed error.
 */
export function encryptField(input: {
  plaintext: string
  keyReference: string
  keys: KeyProvider
}): Result<string, FridayError> {
  const key = input.keys.getKey(input.keyReference)
  if (!key.ok) return key

  try {
    const iv = randomBytes(IV_LENGTH_BYTES)
    const cipher = createCipheriv(ALGORITHM, key.value, iv)

    const ciphertext = Buffer.concat([cipher.update(input.plaintext, 'utf8'), cipher.final()])

    const packed = Buffer.concat([iv, ciphertext, cipher.getAuthTag()])
    return ok(PREFIX + packed.toString('base64'))
  } catch (cause) {
    return err(
      fridayError({
        code: 'STORAGE_WRITE_FAILED',
        message: 'FRIDAY could not encrypt a private value, so she did not store it.',
        cause,
      }),
    )
  }
}

/**
 * Decrypts a value produced by `encryptField`.
 *
 * @param input - The stored value, the key reference, and the provider.
 * @returns The plaintext, or a typed error. A failed authentication tag is
 *   reported as `DECRYPTION_FAILED` and means the stored bytes changed.
 */
export function decryptField(input: {
  stored: string
  keyReference: string
  keys: KeyProvider
}): Result<string, FridayError> {
  if (!isEncrypted(input.stored)) {
    return err(
      fridayError({
        code: 'DECRYPTION_FAILED',
        message: 'That value is not encrypted, so there is nothing to decrypt.',
      }),
    )
  }

  const key = input.keys.getKey(input.keyReference)
  if (!key.ok) return key

  try {
    const packed = Buffer.from(input.stored.slice(PREFIX.length), 'base64')

    const iv = packed.subarray(0, IV_LENGTH_BYTES)
    const tag = packed.subarray(packed.length - TAG_LENGTH_BYTES)
    const ciphertext = packed.subarray(IV_LENGTH_BYTES, packed.length - TAG_LENGTH_BYTES)

    const decipher = createDecipheriv(ALGORITHM, key.value, iv)
    decipher.setAuthTag(tag)

    return ok(Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8'))
  } catch (cause) {
    return err(
      fridayError({
        code: 'DECRYPTION_FAILED',
        message:
          'A stored private value could not be decrypted. Either the key has changed or the ' +
          'stored bytes have — GCM authentication does not distinguish the two, deliberately.',
        cause,
      }),
    )
  }
}

/**
 * Whether a stored value is ciphertext.
 *
 * @param stored - The value read from a column.
 * @returns True when it was written by `encryptField`.
 */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX)
}
