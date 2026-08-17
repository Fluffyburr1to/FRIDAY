import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { type OpenedContext, openContext, runStartupSelfCheck } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createInMemoryKeyProvider, KEY_LENGTH_BYTES, type KeyProvider } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * FRIDAY recording that she started.
 *
 * `system.started` had a contract, a publisher, and kernel tests since M1, and
 * nothing in production called it — so the log never said she started. These
 * assert the production path: a real bus, a real Guardian, a real SQLite log,
 * and no hand-written events.
 *
 * ── Why the ordering test is the important one ──────────────────────────────
 *
 * Both events existing proves very little. What ADR-0044 decided is that the
 * announcement comes *first*, so the log reads in the order things happened
 * and the write-liveness gate runs before the work it guards. Asserting only
 * that both are present would pass with the order reversed.
 *
 * Reference: docs/adr/0044-apps-core-records-that-friday-started-before-she-checks-herself.md
 *            docs/adr/0035-first-run-provisioning-is-creation-only.md
 */

const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname

describe('recording that FRIDAY started', () => {
  let directory: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider
  const opened: OpenedContext[] = []

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-started-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_DATA_DIR = directory
    process.env.FRIDAY_POLICIES_DIR = POLICY_DIR

    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(`test setup could not load config: ${loaded.error.message}`)

    config = loaded.value
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

  /** Opens a context on the fresh directory, as startup does. */
  function open(): OpenedContext {
    const result = openContext({ config, keys })
    if (!result.ok) throw new Error(`could not open the context: ${result.error.message}`)

    opened.push(result.value)
    return result.value
  }

  it('records system.started, as FRIDAY herself', async () => {
    const context = open()

    const started = await context.announceStarted()

    expect(started.ok).toBe(true)
    if (!started.ok) return

    expect(started.value.type).toBe('system.started')

    // ★ `system` is correct here and `user` would not be. ADR-0043 settled the
    // other side of the same distinction: the owner running `friday events
    // emit` is a `user` acting. FRIDAY's own machinery starting is not.
    expect(started.value.actor.type).toBe('system')
    expect(started.value.actor.id).toBe('system:kernel')

    // ADR-0035 §4: only `private` payloads are encrypted, so the record stays
    // readable in exactly the failure its §2 guard exists to prevent.
    expect(started.value.sensitivity).toBe('internal')
  })

  it('carries the minimal payload, and nothing about provisioning', async () => {
    const context = open()

    const started = await context.announceStarted()

    expect(started.ok).toBe(true)
    if (!started.ok) return

    // ADR-0044 kept the existing schema. ADR-0035's initialization record —
    // what init found provisioned — is deliberately NOT here; it remains that
    // ADR's open review trigger rather than something this slice absorbed.
    expect(Object.keys(started.value.payload).sort()).toEqual(['nodeVersion', 'pid', 'version'])
    expect(started.value.payload.pid).toBe(process.pid)
    expect(started.value.payload.nodeVersion).toBe(process.version)
    expect(started.value.payload.version).toEqual(expect.any(String))
  })

  it('★ records that she started before she asks to check herself', async () => {
    const context = open()

    // The fresh-machine sequence, in the order `main()` runs it.
    const started = await context.announceStarted()
    const checked = await runStartupSelfCheck({
      authorizing: context.authorizing,
      events: context.context.events,
      principalId: config.principalId,
    })

    expect(started.ok).toBe(true)
    expect(checked.ok).toBe(true)
    if (!started.ok || !checked.ok) return

    const log = context.context.events.readAfter({ afterSeq: 0 })
    expect(log.ok).toBe(true)
    if (!log.ok) return

    const order = log.value.map((event) => event.type)

    // Not merely "both are present". The first event in a fresh log is now
    // FRIDAY saying she started — before, it was her asking permission to
    // verify a log that was empty.
    expect(order[0]).toBe('system.started')
    expect(order.indexOf('system.started')).toBeLessThan(order.indexOf('guardian.decided'))
  })

  it('reports that she has not started when the log cannot be written', async () => {
    const context = open()

    // The real failure path rather than a mocked one: a closed database makes
    // `append` return EVENT_LOG_UNWRITABLE, which is what a full disk does.
    context.close()
    opened.splice(opened.indexOf(context), 1)

    const started = await context.announceStarted()

    expect(started.ok).toBe(false)
    if (started.ok) return

    // `main()` exits on this rather than continuing, so nothing is served and
    // no self-check runs. Chapter 10: she will not act if she cannot record.
    expect(started.error.code).toBe('EVENT_LOG_UNWRITABLE')
    expect(started.error.message).toContain('has not started')
  })
})
