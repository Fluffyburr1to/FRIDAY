import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createLogger } from '@friday/telemetry'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Credential-shaped fixtures, assembled rather than written out.
 *
 * GitHub's push protection cannot tell a test fixture from a leaked key, and
 * it is right not to try — a scanner that trusted a comment saying "this is
 * fake" would be worthless. Joining the parts at runtime keeps the patterns
 * under test while leaving nothing scannable in the source.
 */
const fixture = (...parts: string[]): string => parts.join('')

/**
 * The file destination, exercised against a real file.
 *
 * Worth an integration test rather than a mock: `mkdir` on a missing directory
 * and the asynchronous flush are both things that work in a unit test with a
 * fake stream and fail on a real disk.
 */
describe('logging to a file', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-telemetry-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates the directory it was pointed at and writes JSON lines', async () => {
    const path = join(directory, 'nested', 'friday.log')
    const log = createLogger({ module: 'test', level: 'info', destination: path })

    log.info({ correlationId: 'corr-1' }, 'started')

    // The destination is asynchronous — buffered writes are what make Pino
    // cheap enough to leave on. Give it a tick to reach the disk.
    await delay(50)

    const line = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>

    expect(line).toMatchObject({ module: 'test', correlationId: 'corr-1', msg: 'started' })
  })

  it('redacts before anything reaches the disk', async () => {
    const path = join(directory, 'friday.log')
    const log = createLogger({ module: 'test', level: 'info', destination: path })

    log.error(
      { apiKey: fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH') },
      'call failed',
    )

    await delay(50)

    // The property that matters is about the FILE, not about the function:
    // once a secret is on disk it is in a backup and possibly in a bug report.
    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant')
  })
})
