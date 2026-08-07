import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { run } from '@friday/cli'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * What the CLI does when the record is not intact, and when it is not there.
 *
 * These are the paths that matter most and are exercised least — nobody runs
 * `friday verify` expecting a failure, which is exactly why the failure path
 * has to be tested rather than trusted.
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

describe('when the record has been broken', () => {
  let directory: string
  let previousDataDir: string | undefined

  async function friday(...argv: string[]): Promise<{ code: number } & Capture> {
    const streams = capture()
    const code = await run({ argv, stdout: streams.stdout, stderr: streams.stderr })

    return { code, ...streams }
  }

  /**
   * Corrupts one stored payload by patching the file's bytes.
   *
   * Deliberately NOT done by opening the database and running an UPDATE: this
   * app may not import a SQLite driver — the boundary rule that keeps every
   * query inside `packages/storage` applies to its tests too — and a raw byte
   * edit is a closer simulation of what the chain actually defends against.
   * Disk corruption, a bad backup restore, and a buggy tool writing where it
   * should not all look exactly like this.
   *
   * The replacement is the same length as the original, so SQLite's page
   * layout is untouched and the row still reads back cleanly. Only the hash
   * disagrees — which is the whole point.
   */
  function corrupt(): void {
    const target = Buffer.from('{"note":"two"}')
    const replacement = Buffer.from('{"note":"XXX"}')

    // WAL mode means the row may still be in the write-ahead log rather than
    // the main file, depending on whether a checkpoint has happened.
    for (const name of ['events.db', 'events.db-wal']) {
      const path = join(directory, name)
      if (!existsSync(path)) continue

      const bytes = readFileSync(path)
      const at = bytes.indexOf(target)
      if (at < 0) continue

      replacement.copy(bytes, at)
      writeFileSync(path, bytes)
    }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-cli-broken-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    rmSync(directory, { recursive: true, force: true })
  })

  it('says so plainly, and exits non-zero', async () => {
    // Exiting non-zero is what lets a nightly check be a cron line rather than
    // something a person has to read every morning.
    for (const note of ['one', 'two', 'three']) await friday('events', 'emit', '--note', note)
    corrupt()

    const result = await friday('verify')

    expect(result.code).toBe(1)
    expect(result.errors()).toContain('THE RECORD HAS BEEN BROKEN')
    expect(result.errors()).toContain('event 2 does not match the content that was recorded')
    expect(result.errors()).toContain('Everything up to event 1 still verifies')

    // Since ADR-0028 the message also says WHICH guarantee failed, because
    // that changes what the owner is looking at. Editing bytes on disk leaves
    // the sequence provably untouched and the content provably altered — the
    // distinction that makes deliberate removal tellable apart from damage.
    expect(result.errors()).toContain('The sequence is intact')
  })

  it('tells the owner not to let new events bury it', async () => {
    for (const note of ['one', 'two']) await friday('events', 'emit', '--note', note)
    corrupt()

    expect((await friday('verify')).errors()).toContain('Restore from a backup')
  })

  it('reports the break in JSON too', async () => {
    for (const note of ['one', 'two']) await friday('events', 'emit', '--note', note)
    corrupt()

    const result = await friday('verify', '--json')
    const parsed = JSON.parse(result.out().trim()) as Record<string, unknown>

    expect(parsed.intact).toBe(false)
    expect(parsed.brokenAtSeq).toBe(2)
  })

  it('flags it in status without reading the whole log', async () => {
    for (const note of ['one', 'two']) await friday('events', 'emit', '--note', note)
    corrupt()

    const result = await friday('status')

    expect(result.code).toBe(1)
    expect(result.out()).toContain('BROKEN')
  })

  it('can verify only the part after the break', async () => {
    // Useful in exactly one situation, and it is a real one: you know when the
    // damage happened and want to know whether anything since is trustworthy.
    for (const note of ['one', 'two', 'three']) await friday('events', 'emit', '--note', note)
    corrupt()

    const result = await friday('verify', '--from', '3')

    expect(result.code).toBe(0)
    expect(result.out()).toContain('intact')
  })

  it('rejects a non-numeric --from', async () => {
    const result = await friday('verify', '--from', 'the-beginning')

    expect(result.code).toBe(2)
    expect(result.errors()).toContain('sequence number')
  })
})

describe('before FRIDAY has ever run', () => {
  let directory: string
  let previousDataDir: string | undefined

  async function friday(...argv: string[]): Promise<{ code: number } & Capture> {
    const streams = capture()
    const code = await run({ argv, stdout: streams.stdout, stderr: streams.stderr })

    return { code, ...streams }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-cli-empty-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
  })

  afterEach(() => {
    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    rmSync(directory, { recursive: true, force: true })
  })

  it('verify says there is nothing to check, and does not call that a failure', async () => {
    const result = await friday('verify')

    expect(result.code).toBe(0)
    expect(result.out()).toContain('has not run yet')
  })

  it('tail explains how to create the log rather than reporting an error', async () => {
    const result = await friday('events', 'tail', '--once')

    expect(result.code).toBe(1)
    expect(result.errors()).toContain('friday events emit')
  })

  it('shows usage for an unknown events subcommand', async () => {
    const result = await friday('events', 'summon')

    expect(result.code).toBe(2)
    expect(result.errors()).toContain('Unknown command: friday events summon')
  })

  it('shows usage for --help and exits 0', async () => {
    const result = await friday('status', '--help')

    expect(result.code).toBe(0)
    expect(result.errors()).toContain('friday verify')
  })

  it('follows the log until it is stopped', async () => {
    // The default mode, and the one the milestone is demonstrated with. Tested
    // with an abort signal because that is exactly what Ctrl-C does.
    await friday('events', 'emit', '--note', 'first')

    const controller = new AbortController()
    const streams = capture()

    const tailing = run({
      argv: ['events', 'tail'],
      stdout: streams.stdout,
      stderr: streams.stderr,
      signal: controller.signal,
    })

    // Give the first poll time to run, then publish into the live tail.
    await new Promise((resolve) => setTimeout(resolve, 50))
    await friday('events', 'emit', '--note', 'while watching')
    await new Promise((resolve) => setTimeout(resolve, 600))

    controller.abort()

    expect(await tailing).toBe(0)
    expect(streams.out()).toContain('Ctrl-C to stop')
    expect(
      streams
        .out()
        .split('\n')
        .filter((l) => l.includes('test.event')).length,
    ).toBe(2)
  })
})
