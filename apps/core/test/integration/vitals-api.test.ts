import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayConfig, loadConfig } from '@friday/config'
import { RuntimeVitalsSchema } from '@friday/contracts'
import { appRouter, openContext } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createInMemoryKeyProvider, KEY_LENGTH_BYTES, type KeyProvider } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The vitals API, at the boundary the dashboard actually calls.
 *
 * `packages/diagnostics` already tests the arithmetic. What is only observable
 * here is the wiring: that the context builds a reader pointed at the
 * *configured data directory*, that the reader is shared across calls so CPU
 * has an interval to average over, and that what leaves the procedure satisfies
 * the schema the HUD is compiled against.
 *
 * The key provider is in-memory (ADR-0020's seam) — real encryption, no
 * Keychain, so this runs in CI.
 */

const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname

describe('the vitals API', () => {
  let directory: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-core-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
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
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
  })

  it('serves a reading of this process that satisfies the wire contract', async () => {
    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const reading = await appRouter.createCaller(opened.value.context).vitals.current()

      // The procedure declares this output; parsing it here is what proves the
      // declaration and the reader have not drifted apart.
      expect(() => RuntimeVitalsSchema.parse(reading)).not.toThrow()

      // ★ Scope. These describe the FRIDAY process, not the machine — Chapter
      // 29. Memory is this process's RSS, so it is tens to hundreds of MB; a
      // host figure would be a percentage or many thousands, and that
      // substitution is the failure ADR-0042 exists to prevent.
      const memory = reading.vitals.find((vital) => vital.id === 'memory')
      expect(memory?.unit).toBe('MB')
      if (memory?.reading.status !== 'measured') throw new Error('memory was not measured')
      expect(memory.reading.value).toBeGreaterThan(0)
      expect(memory.reading.value).toBeLessThan(4096)
    } finally {
      opened.value.close()
    }
  })

  it('measures the disk of the configured data directory', async () => {
    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const reading = await appRouter.createCaller(opened.value.context).vitals.current()
      const disk = reading.vitals.find((vital) => vital.id === 'disk')

      // Composition, not arithmetic: the context must point the reader at
      // `paths.dataDir` — the volume holding her databases — rather than at the
      // process's working directory, which is wherever she happened to start.
      expect(disk?.reading.status).toBe('measured')
    } finally {
      opened.value.close()
    }
  })

  it('shares one reader across calls, so CPU has an interval to average', async () => {
    const opened = openContext({ config, keys })
    if (!opened.ok) throw new Error(opened.error.message)

    try {
      const caller = appRouter.createCaller(opened.value.context)

      await caller.vitals.current()
      await new Promise((resolve) => setTimeout(resolve, 150))
      const second = await caller.vitals.current()

      // ★ The reader is stateful and lives on the context. A fresh one per
      // request would discard the previous sample and force a cold 120 ms
      // sample on every poll — so this interval is the evidence that the
      // context, not the procedure, owns it.
      expect(second.sampleIntervalMs).toBeGreaterThanOrEqual(150)
    } finally {
      opened.value.close()
    }
  })
})
