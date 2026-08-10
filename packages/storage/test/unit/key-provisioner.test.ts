import {
  createInMemoryKeyProvisioner,
  createKeychainKeyProvisioner,
  KEY_LENGTH_BYTES,
} from '@friday/storage'
import { describe, expect, it } from 'vitest'

/**
 * Provisioning key material.
 *
 * ── What is and is not covered, stated plainly ──────────────────────────────
 *
 * Every decision this component makes is tested: generate at the length the
 * reader accepts, never replace what is there, report which happened, and
 * never hand key material back to the caller.
 *
 * The `security` subprocess is **not** exercised writing. It cannot be: the
 * invocation that keeps key material out of `argv` requires `-w` to be the last
 * argument, and targeting a keychain other than the login one requires a
 * trailing positional path — the same position. So a real write goes to the
 * developer's own Keychain or nowhere, and a test suite that writes real key
 * material to a developer's Keychain must not exist.
 *
 * That boundary is the reason ADR-0020 made key access an injected port in the
 * first place, and it is why the Keychain implementation is kept thin enough
 * that the only thing behind it is `execFileSync`.
 */

describe('createInMemoryKeyProvisioner', () => {
  it('creates a key at exactly the length the reader will accept', () => {
    const keys: Record<string, string> = {}

    const result = createInMemoryKeyProvisioner(keys).provision('field-encryption-key')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('created')
    expect(Buffer.from(keys['field-encryption-key'] ?? '', 'base64')).toHaveLength(KEY_LENGTH_BYTES)
  })

  it('never replaces a key that is already there', () => {
    // The property the whole design rests on. Replacing a field-encryption key
    // makes every value encrypted under the old one unreadable forever.
    const keys = { 'field-encryption-key': 'existing-value' }

    const result = createInMemoryKeyProvisioner(keys).provision('field-encryption-key')

    expect(result.ok).toBe(true)
    if (result.ok) expect(result.value).toBe('already-present')
    expect(keys['field-encryption-key']).toBe('existing-value')
  })

  it('gives a different key each time', () => {
    const first: Record<string, string> = {}
    const second: Record<string, string> = {}

    createInMemoryKeyProvisioner(first).provision('k')
    createInMemoryKeyProvisioner(second).provision('k')

    expect(first.k).not.toBe(second.k)
  })

  it('reports presence without returning the key', () => {
    const keys = { present: 'value' }
    const provisioner = createInMemoryKeyProvisioner(keys)

    expect(provisioner.has('present')).toBe(true)
    expect(provisioner.has('absent')).toBe(false)
  })

  it('returns nothing that could be a key, on either path', () => {
    // ★ The property that makes granting this capability to one command safe:
    // key material crosses the boundary in neither direction.
    const keys: Record<string, string> = {}
    const provisioner = createInMemoryKeyProvisioner(keys)

    const created = provisioner.provision('k')
    const again = provisioner.provision('k')

    expect(created.ok && created.value).toBe('created')
    expect(again.ok && again.value).toBe('already-present')
    expect(JSON.stringify([created, again])).not.toContain(keys.k)
  })
})

describe('createKeychainKeyProvisioner', () => {
  it('reports a key the Keychain does not hold, without throwing', () => {
    // Against a service guaranteed absent — the same pattern the key provider's
    // tests use, and safe for the same reason: it reads, and finds nothing.
    const provisioner = createKeychainKeyProvisioner({
      service: 'com.friday.test.does-not-exist',
    })

    expect(provisioner.has('no-such-key')).toBe(false)
  })
})
