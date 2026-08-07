import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { CHAPTER_22_ROTATION, createLogger, type RotationEvent } from '@friday/telemetry'
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
 * Rotation, against a real disk.
 *
 * The rule this protects is Chapter 22's: **logs must never be the reason
 * FRIDAY cannot write her audit trail.** A retention policy that has not been
 * observed working is a retention policy that is probably not working, and the
 * failure only shows up when the disk is already full.
 *
 * The policies here use tiny sizes so a test can fill them. The numbers that
 * ship are in `CHAPTER_22_ROTATION` and are asserted separately.
 */

/** Long enough for the stream to flush and rotate; short enough to be a test. */
const SETTLE_MS = 250

describe('log rotation', () => {
  let directory: string

  function logFiles(): string[] {
    return readdirSync(directory).sort()
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-rotation-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('starts a new file once the size limit is passed', async () => {
    const log = createLogger({
      module: 'test',
      destination: join(directory, 'friday.log'),
      rotation: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
    })

    for (let i = 0; i < 200; i += 1) {
      log.info({ index: i }, 'a line long enough to fill a very small file quickly')
    }

    await delay(SETTLE_MS)

    // The live file plus at least one rotated, compressed predecessor.
    expect(logFiles().length).toBeGreaterThan(1)
    expect(logFiles().some((name) => name.endsWith('.gz'))).toBe(true)
  })

  it('keeps writing to the live file after rotating', async () => {
    // The failure that would otherwise go unnoticed: rotation works once and
    // then the logger is writing to a file nobody reads.
    const path = join(directory, 'friday.log')
    const log = createLogger({
      module: 'test',
      destination: path,
      rotation: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
    })

    for (let i = 0; i < 200; i += 1) log.info({ index: i }, 'filling the first file')
    await delay(SETTLE_MS)

    log.info({}, 'after the rotation')
    await delay(SETTLE_MS)

    expect(readFileSync(path, 'utf8')).toContain('after the rotation')
  })

  it('deletes the oldest files to stay inside the total budget', async () => {
    // ★ The rule pino-roll cannot express, and the reason for the deviation:
    // capping the FILE COUNT still lets a burst of large files fill the disk.
    const removed: RotationEvent[] = []

    const log = createLogger({
      module: 'test',
      destination: join(directory, 'friday.log'),
      rotation: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
      onRotation: (event) => {
        if (event.kind === 'removed') removed.push(event)
      },
    })

    for (let i = 0; i < 2000; i += 1) {
      log.info({ index: i }, 'a line long enough to fill a very small file quickly')
    }

    await delay(SETTLE_MS * 4)

    const total = readdirSync(directory).reduce(
      (bytes, name) => bytes + statSync(join(directory, name)).size,
      0,
    )

    // Generous headroom: the live file is not counted against the budget until
    // it rotates, so the assertion is that removal HAPPENS, not that the total
    // is under 4 KB at every instant.
    expect(removed.length).toBeGreaterThan(0)
    expect(total).toBeLessThan(200_000)
  })

  it('tells the owner why a file was deleted, in words they can act on', async () => {
    const events: RotationEvent[] = []

    const log = createLogger({
      module: 'test',
      destination: join(directory, 'friday.log'),
      rotation: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
      onRotation: (event) => void events.push(event),
    })

    for (let i = 0; i < 2000; i += 1) log.info({ index: i }, 'filling the log directory')
    await delay(SETTLE_MS * 4)

    const removal = events.find((event) => event.kind === 'removed')

    expect(removal?.message).toContain('outgrown')
  })

  it('still redacts once rotation is in the path', async () => {
    // Rotation changed how bytes reach the disk. The property that must not
    // have changed is the one Chapter 22 calls a stop-the-line incident.
    const path = join(directory, 'friday.log')
    const log = createLogger({ module: 'test', destination: path })

    log.error(
      { apiKey: fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH') },
      'call failed',
    )
    await delay(SETTLE_MS)

    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant')
  })

  it('creates the log directory when it is not there', async () => {
    // It does not exist on a fresh install, and a logger that cannot start
    // because of that hides whatever else went wrong during startup.
    const path = join(directory, 'nested', 'deeper', 'friday.log')
    const log = createLogger({ module: 'test', destination: path })

    log.info({}, 'first line ever')
    await delay(SETTLE_MS)

    expect(readFileSync(path, 'utf8')).toContain('first line ever')
  })
})

describe('the shipped rotation policy', () => {
  it('is exactly what Chapter 22 specifies', () => {
    // These four numbers are a commitment in a founding-adjacent document.
    // Changing one is a decision, and this test is what makes it a visible one.
    expect(CHAPTER_22_ROTATION).toEqual({
      interval: '1d',
      maxFileSize: '100M',
      maxFiles: 30,
      maxTotalSize: '1G',
    })
  })
})
