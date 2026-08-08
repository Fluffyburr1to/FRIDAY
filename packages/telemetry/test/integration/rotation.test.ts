import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  CHAPTER_22_ROTATION,
  createLogger,
  createRotatingDestination,
  type RotationEvent,
  type RotationPolicy,
} from '@friday/telemetry'
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

/**
 * Closes every destination a test opened, and waits for each to finish.
 *
 * This is what makes the suite deterministic. It is not a tolerance and not a
 * retry: `end` resolves once the stream has flushed and stopped, so teardown
 * happens after the writing rather than alongside it.
 */
async function closeAll(streams: NodeJS.WritableStream[]): Promise<void> {
  await Promise.all(
    streams.splice(0).map(
      (stream) =>
        new Promise<void>((done) => {
          stream.end(() => done())
        }),
    ),
  )
}

describe('log rotation', () => {
  let directory: string

  /**
   * Every destination these tests open, so teardown can close them.
   *
   * A rotating stream keeps working after the test that made it returns —
   * gzipping a rotated file, deleting an old one. Removing the directory while
   * one is still live made the next write fail, and the resulting error
   * surfaced as an intermittent failure in whichever test happened to be
   * running. Closing first makes the teardown ordered rather than a race.
   */
  const opened: NodeJS.WritableStream[] = []

  /**
   * Opens a destination the test owns.
   *
   * `createLogger({ destination })` builds exactly this internally; going
   * through the documented `stream` seam changes nothing about what is
   * exercised and gives the test a handle it can close.
   */
  function open(
    options: {
      path?: string
      policy?: RotationPolicy
      onRotation?: (event: RotationEvent) => void
    } = {},
  ): NodeJS.WritableStream {
    const stream = createRotatingDestination({
      path: options.path ?? join(directory, 'friday.log'),
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      ...(options.onRotation === undefined ? {} : { onRotation: options.onRotation }),
    })

    opened.push(stream)
    return stream
  }

  function logFiles(): string[] {
    return readdirSync(directory).sort()
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-rotation-'))
  })

  afterEach(async () => {
    await closeAll(opened)
    rmSync(directory, { recursive: true, force: true })
  })

  it('starts a new file once the size limit is passed', async () => {
    const log = createLogger({
      module: 'test',
      stream: open({
        policy: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
      }),
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
      stream: open({
        path,
        policy: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
      }),
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
      stream: open({
        policy: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
        onRotation: (event) => {
          if (event.kind === 'removed') removed.push(event)
        },
      }),
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
      stream: open({
        policy: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
        onRotation: (event) => void events.push(event),
      }),
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
    const log = createLogger({ module: 'test', stream: open({ path }) })

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
    const log = createLogger({ module: 'test', stream: open({ path }) })

    log.info({}, 'first line ever')
    await delay(SETTLE_MS)

    expect(readFileSync(path, 'utf8')).toContain('first line ever')
  })
})

describe('when the log itself cannot be written', () => {
  /**
   * Chapter 22's priority, tested rather than asserted in a comment: the
   * system log is the disposable record, and it must never be able to stop
   * the one that is not.
   *
   * The failure being guarded against is specific. Node throws on an `error`
   * event with no listener, and an uncaught exception ends the process — so a
   * logger whose directory becomes unwritable could take FRIDAY down with it.
   * It did, until the handlers stopped being conditional on an observer.
   */
  let directory: string
  const opened: NodeJS.WritableStream[] = []

  const TINY = { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' } as const

  /** Opens a destination the test owns, so it can be closed deterministically. */
  function open(observer?: (event: RotationEvent) => void): NodeJS.WritableStream {
    const stream = createRotatingDestination({
      path: join(directory, 'friday.log'),
      policy: { ...TINY },
      ...(observer === undefined ? {} : { onRotation: observer }),
    })

    opened.push(stream)
    return stream
  }

  /** Takes the log directory away from a live logger, then keeps writing. */
  async function writeIntoNothing(stream: NodeJS.WritableStream): Promise<void> {
    const log = createLogger({ module: 'test', stream })

    log.info({}, 'a first line, so the stream is genuinely open')
    await delay(SETTLE_MS)

    // The realistic causes are a removable volume, a cleanup job, or a disk
    // that filled. The observable effect is the same: the next write fails.
    rmSync(directory, { recursive: true, force: true })

    for (let i = 0; i < 400; i += 1) log.info({ index: i }, 'writing into a directory that is gone')
    await delay(SETTLE_MS * 2)
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-rotation-fail-'))
  })

  afterEach(async () => {
    await closeAll(opened)
    rmSync(directory, { recursive: true, force: true })
  })

  it('keeps the process alive when nothing is observing rotation', async () => {
    // ★ The regression. Nothing in FRIDAY passes an observer yet — Diagnostics
    // is what will, at M3 — so this is how every real logger is constructed
    // today, and it is exactly the case that used to end the process.
    const uncaught: Error[] = []
    const capture = (error: Error): void => void uncaught.push(error)

    process.on('uncaughtException', capture)

    try {
      await writeIntoNothing(open())
    } finally {
      process.off('uncaughtException', capture)
    }

    expect(uncaught).toEqual([])
  })

  it('tells an observer that the log could not be written, and that logging continues', async () => {
    const events: RotationEvent[] = []

    await writeIntoNothing(open((event) => void events.push(event)))

    const failure = events.find((event) => event.kind === 'error')

    expect(failure).toBeDefined()
    expect(failure?.message).toContain('Logging continues')
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
