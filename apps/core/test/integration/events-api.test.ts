import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { appRouter, openContext, type RunningServer, startServer } from '@friday/core'
import {
  createInMemoryKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
  openStorage,
} from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The dashboard's data path, end to end.
 *
 * These tests use a real SQLite event log with real recorded events rather
 * than a stubbed store. The thing being proved is that what the owner sees in
 * a browser is what is actually in the log — a mocked reader would prove only
 * that the mock was returned.
 *
 * The key provider is in-memory, which is what ADR-0020's injection seam is
 * for: real encryption, no Keychain.
 */

/** The field key reference the test log is written and read with. */
const FIELD_KEY_REF = 'friday-field-key'

describe('the events API', () => {
  let directory: string
  let previousDataDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider

  /** Records `count` events in a real log and closes it, as the kernel would. */
  function recordEvents(count: number): void {
    const storage = openStorage({
      eventsDbPath: config.paths.eventsDb,
      mainDbPath: config.paths.mainDb,
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!storage.ok) throw new Error(`test setup could not open storage: ${storage.error.message}`)

    for (let index = 0; index < count; index += 1) {
      const appended = storage.value.events.append({
        event: {
          type: 'test.recorded',
          actor: SYSTEM_ACTOR,
          principalId: config.principalId,
          payload: { index },
          sensitivity: 'internal',
        },
      })

      if (!appended.ok) throw new Error(`test setup could not append: ${appended.error.message}`)
    }

    storage.value.close()
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-core-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory

    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(`test setup could not load config: ${loaded.error.message}`)

    config = loaded.value
    // A fixed 32-byte key, base64 as the provider expects. Fixed rather than
    // random so a decryption failure is reproducible.
    keys = createInMemoryKeyProvider({
      [FIELD_KEY_REF]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
    })
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    rmSync(directory, { recursive: true, force: true })
  })

  it('returns events that were actually recorded, newest first', async () => {
    recordEvents(3)

    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const caller = appRouter.createCaller(opened.value.context)
      const page = await caller.events.list({ limit: 10 })

      expect(page.events).toHaveLength(3)
      expect(page.events.map((event) => event.payload['index'])).toEqual([2, 1, 0])

      // seq is the ordering authority, not the timestamp. Asserting on it
      // rather than on recordedAt keeps this test honest on a fast machine
      // where three events share a millisecond.
      expect(page.events.map((event) => event.seq)).toEqual([3, 2, 1])
    } finally {
      opened.value.close()
    }
  })

  it('honours the requested limit', async () => {
    recordEvents(5)

    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const caller = appRouter.createCaller(opened.value.context)
      const page = await caller.events.list({ limit: 2 })

      expect(page.events).toHaveLength(2)
    } finally {
      opened.value.close()
    }
  })

  it('rejects a limit beyond the page cap rather than silently clamping it', async () => {
    recordEvents(1)

    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const caller = appRouter.createCaller(opened.value.context)

      // Silently returning 200 for a request of 5,000 would leave the client
      // believing it had the whole log.
      await expect(caller.events.list({ limit: 5_000 })).rejects.toThrow(/200/)
    } finally {
      opened.value.close()
    }
  })

  it('reports an unreadable log as an error rather than as no events', () => {
    // The log is never created — this is the "FRIDAY has never run" case, and
    // the failure mode being guarded against is a dashboard that renders a
    // calm empty state when it cannot see anything at all.
    const opened = openContext({ config, keys })

    expect(opened.ok).toBe(false)
    if (opened.ok) return

    expect(opened.error.message).toContain(config.paths.eventsDb)
  })

  it('serves the same events over HTTP', async () => {
    recordEvents(2)

    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    // Port 0 lets the OS pick a free one, so the suite never collides with a
    // developer's running core.
    const listening: RunningServer = await startServer({
      config: { ...config, server: { ...config.server, port: 0 } },
      context: opened.value.context,
    })

    try {
      const input = encodeURIComponent(JSON.stringify({ limit: 10 }))
      const response = await fetch(
        `http://${config.server.host}:${listening.port}/events.list?input=${input}`,
      )

      expect(response.status).toBe(200)

      const body = (await response.json()) as {
        result: { data: { events: { seq: number }[] } }
      }

      expect(body.result.data.events.map((event) => event.seq)).toEqual([2, 1])
    } finally {
      await listening.close()
      opened.value.close()
    }
  })

  it('binds to loopback only', async () => {
    recordEvents(1)

    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    const listening = await startServer({
      config: { ...config, server: { ...config.server, port: 0 } },
      context: opened.value.context,
    })

    try {
      // Article IV as a bind address: the default host is loopback, so there
      // is no interface on which FRIDAY's log is reachable from the network.
      expect(config.server.host).toBe('127.0.0.1')
    } finally {
      await listening.close()
      opened.value.close()
    }
  })
})
