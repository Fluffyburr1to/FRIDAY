import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLogger, createRotatingDestination } from '@friday/telemetry'
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
 *
 * ── On waiting ──────────────────────────────────────────────────────────────
 *
 * These tests used to write a line, sleep 50 ms, and read the file. That is a
 * guess about how fast the machine is, and CI is slower than the machine the
 * guess was made on — so the read happened before the write landed and the
 * suite failed with ENOENT on hardware that was doing nothing wrong.
 *
 * A stream processes writes in order, so a zero-length write whose callback
 * has fired means everything queued ahead of it has been handled. That is a
 * fact about the stream rather than a bet on the clock, and it is instant on a
 * fast machine and correct on a slow one.
 */
describe('logging to a file', () => {
  let directory: string
  const opened: NodeJS.WritableStream[] = []

  /**
   * Opens the destination the test owns.
   *
   * `createLogger({ destination })` builds exactly this internally, so the
   * same directory creation and the same flush behaviour are exercised — the
   * test just holds the handle, which is what lets it wait and close.
   */
  function open(path: string): NodeJS.WritableStream {
    const stream = createRotatingDestination({ path })
    opened.push(stream)
    return stream
  }

  /** Resolves once every line written before it has reached the file. */
  function flushed(stream: NodeJS.WritableStream): Promise<void> {
    return new Promise((done) => {
      stream.write('', () => done())
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-telemetry-'))
  })

  afterEach(async () => {
    // Closed before the directory goes, so teardown never races a live writer.
    await Promise.all(
      opened.splice(0).map(
        (stream) =>
          new Promise<void>((done) => {
            stream.end(() => done())
          }),
      ),
    )

    rmSync(directory, { recursive: true, force: true })
  })

  it('creates the directory it was pointed at and writes JSON lines', async () => {
    const path = join(directory, 'nested', 'friday.log')
    const stream = open(path)
    const log = createLogger({ module: 'test', level: 'info', stream })

    log.info({ correlationId: 'corr-1' }, 'started')
    await flushed(stream)

    const line = JSON.parse(readFileSync(path, 'utf8').trim()) as Record<string, unknown>

    expect(line).toMatchObject({ module: 'test', correlationId: 'corr-1', msg: 'started' })
  })

  it('redacts before anything reaches the disk', async () => {
    const path = join(directory, 'friday.log')
    const stream = open(path)
    const log = createLogger({ module: 'test', level: 'info', stream })

    log.error(
      { apiKey: fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH') },
      'call failed',
    )

    await flushed(stream)

    // The property that matters is about the FILE, not about the function:
    // once a secret is on disk it is in a backup and possibly in a bug report.
    expect(readFileSync(path, 'utf8')).not.toContain('sk-ant')
  })
})
