import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { run } from '@friday/cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The CLI, end to end.
 *
 * `run` takes its arguments and streams explicitly so these tests exercise the
 * real commands against a real database without spawning a process. What is
 * NOT covered here is the entry point's signal handling, which is four lines
 * and cannot be tested without a process.
 */

interface Capture {
  stdout: Writable
  stderr: Writable
  out: () => string
  errors: () => string
}

function capture(): Capture {
  const outChunks: string[] = []
  const errChunks: string[] = []

  const sink = (into: string[]) =>
    new Writable({
      write(chunk: Buffer, _encoding, callback) {
        into.push(chunk.toString())
        callback()
      },
    })

  return {
    stdout: sink(outChunks),
    stderr: sink(errChunks),
    out: () => outChunks.join(''),
    errors: () => errChunks.join(''),
  }
}

describe('the friday CLI', () => {
  let directory: string
  let previousDataDir: string | undefined

  async function friday(...argv: string[]): Promise<{ code: number } & Capture> {
    const streams = capture()
    const code = await run({ argv, stdout: streams.stdout, stderr: streams.stderr })

    return { code, ...streams }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-cli-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    rmSync(directory, { recursive: true, force: true })
  })

  it('prints usage and exits 2 with no command', async () => {
    // A distinct exit code from a real problem, so a typo in a script is not
    // read as a fault in FRIDAY.
    const result = await friday()

    expect(result.code).toBe(2)
    expect(result.errors()).toContain('friday status')
  })

  it('rejects an unknown command without pretending to run it', async () => {
    const result = await friday('summon')

    expect(result.code).toBe(2)
    expect(result.errors()).toContain('Unknown command')
  })

  it('says FRIDAY has not run yet, rather than reporting a database error', async () => {
    const result = await friday('status')

    expect(result.code).toBe(0)
    expect(result.out()).toContain('has not run yet')
  })

  it('records an event, then shows it in the tail', async () => {
    // ★ The milestone, in three lines. Not impressive, and real.
    const emitted = await friday('events', 'emit', '--note', 'from the other terminal')
    expect(emitted.code).toBe(0)
    expect(emitted.out()).toContain('Recorded event 1')

    const tailed = await friday('events', 'tail', '--once')

    expect(tailed.code).toBe(0)
    expect(tailed.out()).toContain('test.event.emitted')
  })

  it('reports the log in status once it exists', async () => {
    await friday('events', 'emit')

    const result = await friday('status')

    expect(result.code).toBe(0)
    expect(result.out()).toContain('1 events')
    expect(result.out()).toContain('intact')
  })

  it('verifies a clean chain and exits 0', async () => {
    for (let i = 0; i < 3; i += 1) await friday('events', 'emit', '--note', `event ${i}`)

    const result = await friday('verify')

    expect(result.code).toBe(0)
    expect(result.out()).toContain('The record is intact')
    expect(result.out()).toContain('3 events checked')
  })

  it('emits machine-readable output with --json', async () => {
    // The JSON form is what the recovery runbooks parse, so it is not allowed
    // to carry the human prose alongside it.
    await friday('events', 'emit')
    const result = await friday('verify', '--json')

    const parsed = JSON.parse(result.out().trim()) as Record<string, unknown>

    expect(parsed.intact).toBe(true)
    expect(result.out()).not.toContain('The record is intact')
  })

  it('shows only recent events by default', async () => {
    // Someone running `events tail` wants to see what is happening now, not
    // four months of history.
    for (let i = 0; i < 10; i += 1) await friday('events', 'emit', '--note', `event ${i}`)

    const result = await friday('events', 'tail', '--once', '-n', '3')

    expect(
      result
        .out()
        .split('\n')
        .filter((line) => line.includes('test.event')).length,
    ).toBe(3)
  })

  it('starts the tail where it is told to', async () => {
    for (let i = 0; i < 5; i += 1) await friday('events', 'emit', '--note', `event ${i}`)

    const result = await friday('events', 'tail', '--once', '--since', '4')

    expect(result.out()).toContain('     5')
    expect(result.out()).not.toContain('     4')
  })

  it('reports a usage error for a non-numeric --since', async () => {
    // Falling back silently would print the whole log instead of the tail,
    // which looks like a different bug entirely.
    const result = await friday('events', 'tail', '--once', '--since', 'yesterday')

    expect(result.code).toBe(2)
    expect(result.errors()).toContain('need a number')
  })

  it('explains an invalid configuration instead of failing mysteriously', async () => {
    process.env.FRIDAY_PORT = '80'

    const result = await friday('status')

    expect(result.code).toBe(1)
    expect(result.errors()).toContain('server.port')

    delete process.env.FRIDAY_PORT
  })
})
