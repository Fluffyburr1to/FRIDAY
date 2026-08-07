import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import Database from 'better-sqlite3'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Field-level encryption, checked against the file rather than the API.
 *
 * The guarantee that matters is "a stolen `friday.db` does not expose your
 * private content", and only a test that reads the raw column can assert it.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const KEY = randomBytes(32).toString('base64')
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: KEY })

const SECRET_TEXT = 'I have been feeling unwell and did not tell anyone'

describe('field encryption', () => {
  let directory: string
  let eventsDbPath: string
  let storage: Storage

  function open(provider = keys): Storage {
    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath,
      keys: provider,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    return opened.value
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-encryption-'))
    eventsDbPath = join(directory, 'events.db')
    storage = open()
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('writes a private payload to disk as ciphertext', () => {
    storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: SECRET_TEXT },
        sensitivity: 'private',
      },
    })
    storage.close()

    const raw = new Database(eventsDbPath, { readonly: true })
    const row = raw.prepare('SELECT payload FROM events WHERE seq = 1').get() as { payload: string }
    raw.close()

    expect(row.payload).not.toContain('feeling unwell')
    expect(row.payload.startsWith('enc:v1:')).toBe(true)

    storage = open()
  })

  it('reads a private payload back as plaintext', () => {
    storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: SECRET_TEXT },
        sensitivity: 'private',
      },
    })

    const read = storage.events.readAfter({ afterSeq: 0 })

    expect(read.ok && read.value[0]?.payload.note).toBe(SECRET_TEXT)
  })

  it('leaves an internal payload readable in the file', () => {
    // Deliberate: field-level rather than whole-file encryption is what keeps
    // the database openable with ordinary tools, which is the practical
    // meaning of "your data belongs to you".
    storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: 'nothing private here' },
        sensitivity: 'internal',
      },
    })
    storage.close()

    const raw = new Database(eventsDbPath, { readonly: true })
    const row = raw.prepare('SELECT payload FROM events WHERE seq = 1').get() as { payload: string }
    raw.close()

    expect(row.payload).toContain('nothing private here')

    storage = open()
  })

  it('refuses an event that claims to carry secret content', () => {
    // ★ Secrets live in the Keychain. Events carry references to them, never
    // the values — so this is refused rather than encrypted into the log
    // forever, where nothing could ever remove it.
    const result = storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: 'an access token' },
        sensitivity: 'secret',
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('STORAGE_WRITE_FAILED')
      expect(result.error.message).toContain('Keychain')
    }
    expect(storage.events.count()).toBe(0)
  })

  it('reports a missing key rather than storing plaintext', () => {
    const withoutKey = createInMemoryKeyProvider({})
    storage.close()
    storage = open(withoutKey)

    const result = storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: SECRET_TEXT },
        sensitivity: 'private',
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('ENCRYPTION_KEY_UNAVAILABLE')
    expect(storage.events.count()).toBe(0)
  })

  it('reports a wrong-length key rather than using it', () => {
    const shortKey = createInMemoryKeyProvider({
      [FIELD_KEY_REF]: randomBytes(16).toString('base64'),
    })

    storage.close()
    storage = open(shortKey)

    const result = storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: SECRET_TEXT },
        sensitivity: 'private',
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('AES-256')
  })

  it('reports a decryption failure rather than returning garbage', () => {
    // The key changed, or the bytes did. GCM does not distinguish the two,
    // deliberately — both mean the stored value can no longer be trusted.
    storage.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: SECRET_TEXT },
        sensitivity: 'private',
      },
    })
    storage.close()

    const wrongKey = createInMemoryKeyProvider({
      [FIELD_KEY_REF]: randomBytes(32).toString('base64'),
    })
    storage = open(wrongKey)

    const read = storage.events.readAfter({ afterSeq: 0 })

    expect(read.ok).toBe(false)
    if (!read.ok) expect(read.error.code).toBe('DECRYPTION_FAILED')
  })

  it('keeps the chain verifiable over encrypted payloads', () => {
    // The hash covers the stored bytes, so ciphertext chains exactly as
    // plaintext does — and verification needs no key at all.
    for (const note of ['one', 'two', 'three']) {
      storage.events.append({
        event: {
          type: 'test.event.emitted',
          actor: SYSTEM_ACTOR,
          principalId: 'usr_owner',
          payload: { note },
          sensitivity: 'private',
        },
      })
    }

    expect(storage.events.verifyChain().ok).toBe(true)

    const verified = storage.events.verifyChain()
    expect(verified.ok && verified.value.intact).toBe(true)
    expect(verified.ok && verified.value.eventsChecked).toBe(3)
  })
})
