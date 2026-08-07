import { randomBytes } from 'node:crypto'
import {
  createInMemoryKeyProvider,
  createKeychainKeyProvider,
  KEY_LENGTH_BYTES,
} from '@friday/storage'
import { describe, expect, it } from 'vitest'

describe('createInMemoryKeyProvider', () => {
  it('returns a well-formed key', () => {
    const key = randomBytes(KEY_LENGTH_BYTES)
    const provider = createInMemoryKeyProvider({ 'field-key': key.toString('base64') })

    const result = provider.getKey('field-key')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value.equals(key)).toBe(true)
  })

  it('reports a key it does not have', () => {
    const result = createInMemoryKeyProvider({}).getKey('field-key')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ENCRYPTION_KEY_UNAVAILABLE')
  })

  it('refuses a key of the wrong length rather than padding it', () => {
    // A silently truncated or padded key produces ciphertext that nothing can
    // ever decrypt afterwards — including FRIDAY.
    const provider = createInMemoryKeyProvider({ 'field-key': randomBytes(16).toString('base64') })

    const result = provider.getKey('field-key')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('16 bytes')
      expect(result.error.message).toContain('AES-256')
    }
  })

  it('never puts the key value in the error', () => {
    // ★ The reference is a name; the value is a secret. An error that carries
    // the value would put it in a log, a backup, and possibly a bug report.
    const provider = createInMemoryKeyProvider({ 'field-key': 'c2hvcnQ=' })

    const result = provider.getKey('field-key')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(JSON.stringify(result.error)).not.toContain('c2hvcnQ')
  })
})

describe('createKeychainKeyProvider', () => {
  it('reports a key the Keychain does not hold, without throwing', () => {
    // A missing key is an operational failure with a required response —
    // FRIDAY stops rather than continuing with her private fields unreadable
    // — so it is a Result, not an exception.
    const provider = createKeychainKeyProvider({ service: 'com.friday.test.does-not-exist' })

    const result = provider.getKey('no-such-key')

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('ENCRYPTION_KEY_UNAVAILABLE')
      expect(result.error.detail?.reference).toBe('no-such-key')
    }
  })

  it('explains what the missing key costs, in plain language', () => {
    const provider = createKeychainKeyProvider({ service: 'com.friday.test.does-not-exist' })

    const result = provider.getKey('no-such-key')

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('Keychain')
  })
})
