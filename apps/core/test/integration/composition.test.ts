import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { type OpenedContext, openContext } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import {
  createInMemoryKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
  openStorage,
} from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Composing the Guardian at startup, and refusing to start without it.
 *
 * Everything here goes through the real `loadPolicySet`, the real shipped
 * rules, and real SQLite. A Guardian exists in production for the first time,
 * so a test that stubbed the loader would prove the wiring it replaced. The
 * key provider is injected, which is ADR-0020's seam and the only sanctioned
 * way to run this without the machine's Keychain.
 *
 * Reference: docs/adr/0033 · docs/adr/0020 · docs/adr/0029
 */

const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname

describe('composing a context', () => {
  let directory: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider
  const opened: OpenedContext[] = []

  /** Reloads configuration after a test has repointed an environment variable. */
  function reload(): FridayConfig {
    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(loaded.error.message)
    return loaded.value
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-composition-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_DATA_DIR = directory
    process.env.FRIDAY_POLICIES_DIR = POLICY_DIR

    config = reload()

    // Both keys production needs, so a test that fails does so for the reason
    // it is about rather than for a missing fixture.
    keys = createInMemoryKeyProvider({
      [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
    })
  })

  afterEach(() => {
    for (const context of opened.splice(0)) context.close()

    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
  })

  /** Opens a real context, closed by `afterEach`. */
  function open(withKeys: KeyProvider = keys): OpenedContext {
    const result = openContext({ config, keys: withKeys })
    if (!result.ok) throw new Error(result.error.message)

    opened.push(result.value)
    return result.value
  }

  describe('when everything it needs is there', () => {
    it('builds a Guardian behind the clerk that records what it decides', () => {
      const context = open()

      // The Guardian is never held directly. ADR-0031 makes the clerk its only
      // production caller, so a composed Guardian *is* a composed clerk.
      expect(typeof context.authorizing.authorize).toBe('function')
    })
  })

  describe('when the rules cannot be loaded', () => {
    /** Whether opening a context left a usable database behind. */
    function databasesExist(): boolean {
      const storage = openStorage({
        eventsDbPath: config.paths.eventsDb,
        mainDbPath: config.paths.mainDb,
        keys,
        fieldKeyReference: config.keychain.fieldKeyRef,
      })

      if (!storage.ok) return false

      try {
        return storage.value.events.latestSeq() > 0
      } finally {
        storage.value.close()
      }
    }

    it('refuses when the directory does not exist, before creating anything', () => {
      process.env.FRIDAY_POLICIES_DIR = join(directory, 'nowhere')

      const result = openContext({ config: reload(), keys })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('a missing rule directory must not start')
      expect(result.error.code).toBe('POLICY_INVALID')

      // ★ The rules are checked ahead of storage precisely so a run that cannot
      // start leaves no trace of having tried — and so the server never reaches
      // `listen`.
      expect(databasesExist()).toBe(false)
    })

    it('refuses when the directory holds no rules', () => {
      const empty = join(directory, 'empty-policies')
      mkdirSync(empty)
      process.env.FRIDAY_POLICIES_DIR = empty

      const result = openContext({ config: reload(), keys })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('an empty rule set must not start')

      // Not "deny everything". A Guardian with no rules refuses every action,
      // and a broken system that looks like a strict one is the worse failure.
      expect(result.error.code).toBe('POLICY_SET_EMPTY')
    })

    it('refuses when a rule file is malformed', () => {
      const broken = join(directory, 'broken-policies')
      mkdirSync(broken)
      writeFileSync(join(broken, '00-broken.json'), '[{ "id": "no-effect" }]')
      process.env.FRIDAY_POLICIES_DIR = broken

      const result = openContext({ config: reload(), keys })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('a malformed rule must not start')
      expect(result.error.code).toBe('POLICY_INVALID')
    })
  })

  describe('when the capability signing key is missing', () => {
    /** Everything except the key composing a Guardian needs. */
    function withoutSigningKey(): KeyProvider {
      return createInMemoryKeyProvider({
        [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      })
    }

    it('refuses to start, and names the key rather than guessing at one', () => {
      const result = openContext({ config, keys: withoutSigningKey() })

      expect(result.ok).toBe(false)
      if (result.ok) throw new Error('a Guardian without its signing key must not start')

      // ★ Nothing provisions this Keychain entry yet, so on a real machine this
      // is where startup stops. Reported as the infrastructure failure it is —
      // no fallback signer, no generated key, no Guardian that quietly cannot
      // verify a capability. See ADR-0033's closing note.
      expect(result.error.code).toBe('ENCRYPTION_KEY_UNAVAILABLE')
      expect(result.error.detail).toMatchObject({ reference: CAPABILITY_KEY_REFERENCE })
    })

    it('releases the databases it opened before failing', () => {
      expect(openContext({ config, keys: withoutSigningKey() }).ok).toBe(false)

      // A failed composition that held the connections would make the next
      // attempt fail for a reason that has nothing to do with the first.
      expect(() => open()).not.toThrow()
    })
  })

  describe('the boundary', () => {
    it('gives the context no way to append to the log', () => {
      const context = open()

      // ★ `EventReader` is a `Pick<>`, which the compiler enforces and the
      // running program does not. This asserts the narrowing is structural, so
      // `append` cannot be reached by an `as` or from untyped code.
      expect('append' in context.context.events).toBe(false)
    })

    it('keeps the authorizing clerk off the context procedures are given', () => {
      const context = open()

      expect('authorizing' in context.context).toBe(false)
    })

    it('keeps the startup announcement off the context procedures are given', () => {
      const context = open()

      // ADR-0044 put `announceStarted` on the opened context beside
      // `authorizing`, for the same reason: startup is not a request from
      // anybody, and no procedure may reach it.
      expect('announceStarted' in context.context).toBe(false)
      expect(typeof context.announceStarted).toBe('function')
    })

    it('never exposes the bus itself', () => {
      const context = open()

      // ★ The announcement is one closure over one call, not the bus. A bus on
      // either object would be a way to record an arbitrary event — ADR-0021's
      // concern, and the reason it is built inside `openContext` and stays
      // there.
      expect('bus' in context.context).toBe(false)
      expect('bus' in context).toBe(false)
    })
  })
})
