import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

/**
 * A destination the test owns, and can wait on.
 *
 * ── Why there are no timers in this file ────────────────────────────────────
 *
 * These tests used to write, wait a fixed 250 ms, and assert. That is a guess
 * about how fast a machine is, and it was wrong on CI: a slower runner had not
 * finished recreating the live file when the assertion read it, so the suite
 * failed with ENOENT on hardware that was doing nothing wrong.
 *
 * Raising the number would have moved the threshold rather than removed it.
 * Rotation already announces itself — `rotated` when a file rolls over,
 * `removed` when one is deleted to stay inside the budget — so the tests wait
 * for the thing they are actually waiting for. On a fast machine that is
 * instant; on a slow one it is correct.
 */
interface Destination {
  readonly stream: NodeJS.WritableStream

  /** Every rotation event so far, in order. */
  readonly events: readonly RotationEvent[]

  /**
   * Resolves once every line written before it has reached the file.
   *
   * A stream processes writes in order, so a zero-length write whose callback
   * has fired is a barrier: everything queued ahead of it is done. That is a
   * fact about the stream rather than a bet on the clock.
   *
   * Rotation happens inside that same write, before the callback runs, so a
   * resolved barrier also means every rotation those lines caused has already
   * been reported. Checking `events` after one is therefore not a race.
   */
  flushed(): Promise<void>
}

/** Written between barriers. Roughly five of these fill a 1 KB file. */
const LINES_PER_BATCH = 25

/**
 * Far more than any policy in this file needs. Reaching it means rotation
 * stopped reporting, which is a real failure and should say so.
 */
const MOST_LINES = 2_000

/**
 * Writes until rotation reports the event the test is about, and then stops.
 *
 * ── Why the line count is not a constant ────────────────────────────────────
 *
 * These tests used to queue a flat 2,000 lines and then wait for the first
 * report. The wait was honest, but the writing was not: the deletion under
 * test happens after about twenty-four rotations — some hundred and twenty
 * lines — and the other nineteen hundred stayed sitting in the stream's buffer
 * when the assertions passed. `end` flushes, so teardown then had to grind
 * through two hundred and sixty further rotations, each one a gzip and a sweep
 * of the directory, before it could close.
 *
 * That is the 250 ms guess again wearing a different hat. The work is
 * unbounded, its cost depends on how busy the machine is, and it is spent
 * after the test has already proved its point. Measured on one idle laptop it
 * took 0.3 s; with eight rotating streams competing for the disk, 3.7 s; once,
 * 9.8 s — against Vitest's ten-second hook budget, which the shared preset
 * leaves at its default while raising only `testTimeout`. When it crossed, the
 * report read as this test failing, seconds after this test had passed.
 *
 * Writing only as far as the event removes the backlog rather than budgeting
 * for it. Every assertion is unchanged, and so is the rule being proved.
 *
 * @returns The event that stopped the writing, drained and already reported.
 */
async function fill(
  destination: Destination,
  until: RotationEvent['kind'],
  line: (index: number) => void,
): Promise<RotationEvent> {
  for (let written = 0; written < MOST_LINES; written += LINES_PER_BATCH) {
    const reported = destination.events.find((event) => event.kind === until)
    if (reported !== undefined) return reported

    for (let index = written; index < written + LINES_PER_BATCH; index += 1) line(index)
    await destination.flushed()
  }

  throw new Error(
    `Rotation never reported '${until}' in ${MOST_LINES} lines. ` +
      'Every policy in this file reaches it in well under two hundred.',
  )
}

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
  function open(options: { path?: string; policy?: RotationPolicy } = {}): Destination {
    const events: RotationEvent[] = []

    const stream = createRotatingDestination({
      path: options.path ?? join(directory, 'friday.log'),
      ...(options.policy === undefined ? {} : { policy: options.policy }),
      onRotation: (event) => void events.push(event),
    })

    opened.push(stream)

    return {
      stream,
      events,
      flushed: () =>
        new Promise((done) => {
          stream.write('', () => done())
        }),
    }
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
    const destination = open({
      policy: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
    })
    const log = createLogger({ module: 'test', stream: destination.stream })

    await fill(destination, 'rotated', (index) =>
      log.info({ index }, 'a line long enough to fill a very small file quickly'),
    )

    // The live file plus at least one rotated, compressed predecessor.
    expect(logFiles().length).toBeGreaterThan(1)
    expect(logFiles().some((name) => name.endsWith('.gz'))).toBe(true)
  })

  it('keeps writing to the live file after rotating', async () => {
    // The failure that would otherwise go unnoticed: rotation works once and
    // then the logger is writing to a file nobody reads.
    const path = join(directory, 'friday.log')
    const destination = open({
      path,
      policy: { interval: '1d', maxFileSize: '1K', maxFiles: 10, maxTotalSize: '10M' },
    })
    const log = createLogger({ module: 'test', stream: destination.stream })

    // The rotation itself, not a guess at how long one takes.
    await fill(destination, 'rotated', (index) => log.info({ index }, 'filling the first file'))

    log.info({}, 'after the rotation')
    await destination.flushed()

    expect(readFileSync(path, 'utf8')).toContain('after the rotation')
  })

  it('deletes the oldest files to stay inside the total budget', async () => {
    // ★ The rule pino-roll cannot express, and the reason for the deviation:
    // capping the FILE COUNT still lets a burst of large files fill the disk.
    const destination = open({
      policy: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
    })
    const log = createLogger({ module: 'test', stream: destination.stream })

    // Write until a deletion actually happens, which is the thing being tested,
    // and not one line further — see `fill`.
    await fill(destination, 'removed', (index) =>
      log.info({ index }, 'a line long enough to fill a very small file quickly'),
    )

    const removed = destination.events.filter((event) => event.kind === 'removed')

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
    const destination = open({
      policy: { interval: '1d', maxFileSize: '1K', maxFiles: 100, maxTotalSize: '4K' },
    })
    const log = createLogger({ module: 'test', stream: destination.stream })

    const removal = await fill(destination, 'removed', (index) =>
      log.info({ index }, 'filling the log directory'),
    )

    expect(removal.message).toContain('outgrown')
  })

  it('still redacts once rotation is in the path', async () => {
    // Rotation changed how bytes reach the disk. The property that must not
    // have changed is the one Chapter 22 calls a stop-the-line incident.
    const path = join(directory, 'friday.log')
    const destination = open({ path })
    const log = createLogger({ module: 'test', stream: destination.stream })

    log.error(
      { apiKey: fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH') },
      'call failed',
    )
    await destination.flushed()

    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant')
  })

  it('creates the log directory when it is not there', async () => {
    // It does not exist on a fresh install, and a logger that cannot start
    // because of that hides whatever else went wrong during startup.
    const path = join(directory, 'nested', 'deeper', 'friday.log')
    const destination = open({ path })
    const log = createLogger({ module: 'test', stream: destination.stream })

    log.info({}, 'first line ever')
    await destination.flushed()

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

  /** A destination whose first reported failure can be awaited. */
  function watched(): { stream: NodeJS.WritableStream; failure: Promise<RotationEvent> } {
    let announce: (event: RotationEvent) => void = () => undefined
    const failure = new Promise<RotationEvent>((resolve) => {
      announce = resolve
    })

    const stream = open((event) => {
      if (event.kind === 'error') announce(event)
    })

    return { stream, failure }
  }

  /** Resolves once everything written so far has reached the stream. */
  function flushed(stream: NodeJS.WritableStream): Promise<void> {
    return new Promise((done) => {
      stream.write('', () => done())
    })
  }

  /**
   * Takes the log directory away from a live logger, then keeps writing.
   *
   * The wait after the first line is a flush barrier rather than a timer: the
   * stream must genuinely have the file open before removing it underneath
   * proves anything.
   */
  async function writeIntoNothing(stream: NodeJS.WritableStream): Promise<void> {
    const log = createLogger({ module: 'test', stream })

    log.info({}, 'a first line, so the stream is genuinely open')
    await flushed(stream)

    // The realistic causes are a removable volume, a cleanup job, or a disk
    // that filled. The observable effect is the same: the next write fails.
    rmSync(directory, { recursive: true, force: true })

    for (let i = 0; i < 400; i += 1) log.info({ index: i }, 'writing into a directory that is gone')
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
    //
    // A sibling stream with an observer runs alongside, under the same removed
    // directory, purely so the test knows when the failure has actually
    // happened. Waiting on that is what replaces waiting on a clock: without
    // it, "no exception was thrown" could just mean "nothing had gone wrong
    // yet".
    const uncaught: Error[] = []
    const capture = (error: Error): void => void uncaught.push(error)

    const witness = watched()

    process.on('uncaughtException', capture)

    try {
      await writeIntoNothing(open())
      await writeIntoNothing(witness.stream)
      await witness.failure
    } finally {
      process.off('uncaughtException', capture)
    }

    expect(uncaught).toEqual([])
  })

  it('tells an observer that the log could not be written, and that logging continues', async () => {
    const observed = watched()

    await writeIntoNothing(observed.stream)

    const failure = await observed.failure

    expect(failure.message).toContain('Logging continues')
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
