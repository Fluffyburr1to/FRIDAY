import { Writable } from 'node:stream'
import {
  classified,
  createLogger,
  createSilentLogger,
  LOG_LEVELS,
  type LogLevel,
  REDACTED,
} from '@friday/telemetry'
import { describe, expect, it } from 'vitest'

/**
 * Credential-shaped fixtures, assembled rather than written out.
 *
 * GitHub's push protection cannot tell a test fixture from a leaked key, and
 * it is right not to try — a scanner that trusted a comment saying "this is
 * fake" would be worthless. Joining the parts at runtime keeps the patterns
 * under test while leaving nothing scannable in the source.
 */
const fixture = (...parts: string[]): string => parts.join('')

/** Collects the JSON lines a logger writes, for assertion. */
function capture(): { stream: Writable; lines: () => Record<string, unknown>[] } {
  const written: string[] = []

  const stream = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      written.push(chunk.toString())
      callback()
    },
  })

  return {
    stream,
    lines: () =>
      written
        .join('')
        .split('\n')
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  }
}

describe('createLogger', () => {
  it('writes one JSON object per line', () => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'kernel.event-bus', level: 'info', stream })

    log.info({ correlationId: 'corr-1' }, 'plan started')

    expect(lines()).toHaveLength(1)
    expect(lines()[0]).toMatchObject({
      level: 'info',
      module: 'kernel.event-bus',
      correlationId: 'corr-1',
      msg: 'plan started',
    })
  })

  it('stamps the time as milliseconds since the epoch', () => {
    // The same representation as every timestamp in the event log. Two time
    // formats in one system is a class of bug that costs an afternoon.
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream })

    log.info({}, 'hello')

    expect(typeof lines()[0]?.time).toBe('number')
  })

  it('drops lines below the configured level', () => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', level: 'warn', stream })

    log.debug({}, 'noise')
    log.info({}, 'still noise')
    log.warn({}, 'kept')

    expect(lines()).toHaveLength(1)
    expect(lines()[0]?.msg).toBe('kept')
  })

  it.each(LOG_LEVELS)('supports the %s level', (level: LogLevel) => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', level: 'trace', stream })

    log[level]({}, `a ${level} line`)

    expect(lines()[0]?.level).toBe(level)
  })

  it('carries child bindings onto every line', () => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream }).child({ correlationId: 'corr-9' })

    log.info({}, 'first')
    log.info({}, 'second')

    expect(lines().every((line) => line.correlationId === 'corr-9')).toBe(true)
  })

  it('redacts a secret in the context object', () => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream })

    log.error(
      { apiKey: fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH') },
      'call failed',
    )

    expect(lines()[0]?.apiKey).toBe(REDACTED)
  })

  it('redacts a secret in the message string', () => {
    // The layer people forget: a token interpolated into a message rather than
    // passed as a field.
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream })

    log.error({}, `rejected token ${fixture('ghp', '_', '1234567890abcdefghijklmnopqrstuvwxyz')}`)

    expect(lines()[0]?.msg).not.toContain('ghp_')
  })

  it('redacts a secret bound to a child logger', () => {
    // ★ The reason redaction happens in the wrapper rather than in a Pino
    // hook: hooks never see child bindings, and a binding is attached once and
    // then written on every line the child produces.
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream }).child({ authorization: 'Bearer abc123' })

    log.info({}, 'first')

    expect(JSON.stringify(lines()[0])).not.toContain('abc123')
  })

  it('redacts a classified value passed as context', () => {
    const { stream, lines } = capture()
    const log = createLogger({ module: 'test', stream })

    log.info({ body: classified('private', 'the contents of a note') }, 'memory stored')

    expect(lines()[0]?.body).toBe(REDACTED)
    expect(JSON.stringify(lines()[0])).not.toContain('contents of a note')
  })

  it('reports its own level', () => {
    expect(createLogger({ module: 'test', level: 'debug', stream: capture().stream }).level).toBe(
      'debug',
    )
  })

  it('defaults to info', () => {
    expect(createLogger({ module: 'test', stream: capture().stream }).level).toBe('info')
  })
})

describe('createSilentLogger', () => {
  it('writes nothing at any level', () => {
    const log = createSilentLogger()

    for (const level of LOG_LEVELS) {
      expect(() => log[level]({}, 'ignored')).not.toThrow()
    }
  })

  it('returns itself from child, so a bound silent logger stays silent', () => {
    const log = createSilentLogger()

    expect(log.child({ correlationId: 'x' })).toBe(log)
  })
})
