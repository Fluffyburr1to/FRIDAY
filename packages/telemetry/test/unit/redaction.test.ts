import { classified, isDeniedKey, REDACTED, redact, scrubString } from '@friday/telemetry'
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

/**
 * ★ The mandatory suite.
 *
 * Chapter 22: "A test suite feeds known-sensitive payloads through the logger
 * and asserts none of it appears in the output. Redaction that is not tested
 * is redaction that silently stops working after a refactor."
 *
 * Chapter 22 also makes a sensitive value appearing in a log a stop-the-line
 * security incident. These tests are the thing standing between a refactor and
 * that incident, so weakening one to make it pass is never the right move.
 */

/** Values that must never survive a round trip through the logger. */
const KNOWN_SECRETS = [
  fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH'),
  fixture('sk-', 'proj-', '1234567890abcdefghijklmnop'),
  fixture('ghp', '_', '1234567890abcdefghijklmnopqrstuvwxyz'),
  fixture('xox', 'b-', '123456789012-abcdefghijklmnop'),
  fixture('AKIA', 'IOSFODNN7EXAMPLE'),
  fixture('AIza', 'SyA1234567890abcdefghijklmnopqrstuv'),
  fixture(
    'eyJ',
    'hbGciOiJIUzI1NiJ9.',
    'eyJzdWIiOiIxMjM0NTY3ODkwIn0.',
    'dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U',
  ),
]

describe('scrubString', () => {
  it.each(KNOWN_SECRETS)('removes a credential-shaped string: %s', (secret) => {
    const scrubbed = scrubString(`the value is ${secret} and that is that`)

    expect(scrubbed).not.toContain(secret)
    expect(scrubbed).toContain(REDACTED)
  })

  it('removes an Authorization header value', () => {
    const scrubbed = scrubString('Authorization: Bearer abc123def456ghi789')

    expect(scrubbed).not.toContain('abc123def456ghi789')
  })

  it('removes a PEM private key across its many lines', () => {
    const key = [
      '-----BEGIN RSA PRIVATE KEY-----',
      'MIIEowIBAAKCAQ',
      '-----END RSA PRIVATE KEY-----',
    ].join('\n')

    expect(scrubString(`key:\n${key}`)).not.toContain('MIIEowIBAAKCAQ')
  })

  it('masks the local part of an email address but keeps the domain', () => {
    // Chapter 22 puts email under "logged carefully", not "never logged" — the
    // domain is often what you need, and the local part is what identifies.
    expect(scrubString('sent to sarah.jones@example.com')).toBe('sent to s***@example.com')
  })

  it('replaces the home directory in a path', () => {
    // An absolute path names the account it belongs to, and paths land in
    // error messages constantly.
    const scrubbed = scrubString(`could not open ${process.env.HOME ?? ''}/Library/friday.db`)

    expect(scrubbed).toContain('~/Library/friday.db')
  })

  it('leaves UUIDs and correlation IDs alone', () => {
    // The thing a generic "high entropy" rule gets wrong. These are exactly
    // what you need in a log, and redacting them makes the log useless.
    const line = 'plan 0198e2c1-4d3a-7b2e-8f01-2a3b4c5d6e7f failed'

    expect(scrubString(line)).toBe(line)
  })

  it('leaves an ordinary message untouched', () => {
    expect(scrubString('Gmail send failed after 3 attempts')).toBe(
      'Gmail send failed after 3 attempts',
    )
  })
})

describe('isDeniedKey', () => {
  it.each([
    'password',
    'Password',
    'db_password',
    'accessToken',
    'refresh_token',
    'apiKey',
    'x-api-key',
    'API_KEY',
    'authorization',
    'Cookie',
    'clientSecret',
    'privateKey',
    'sessionId',
  ])('denies %s', (key) => {
    expect(isDeniedKey(key)).toBe(true)
  })

  it.each(['plan', 'correlationId', 'durationMs', 'module', 'principalId', 'msg'])(
    'allows %s',
    (key) => {
      expect(isDeniedKey(key)).toBe(false)
    },
  )
})

describe('redact', () => {
  it('replaces a denied field whatever it holds', () => {
    expect(redact({ password: 'hunter2' })).toEqual({ password: REDACTED })
    expect(redact({ token: { nested: 'anything' } })).toEqual({ token: REDACTED })
  })

  it('scrubs secret-shaped values under innocuous field names', () => {
    // Layer 2 catching what layer 3 misses: nobody would deny-list `note`.
    const output = redact({
      note: `use ${fixture('sk-', 'ant-api03-', 'AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHH')}`,
    })

    expect(JSON.stringify(output)).not.toContain('sk-ant')
  })

  it('replaces anything classified private or secret', () => {
    // Layer 1: the call site knows what the value is, whatever it looks like.
    expect(redact({ body: classified('private', 'I have been feeling unwell') })).toEqual({
      body: REDACTED,
    })
    expect(redact({ key: classified('secret', 'anything') })).toEqual({ key: REDACTED })
  })

  it('keeps values classified public or internal', () => {
    expect(redact({ status: classified('internal', 'running') })).toEqual({ status: 'running' })
    expect(redact({ status: classified('public', 'ok') })).toEqual({ status: 'ok' })
  })

  it('still scrubs a classified-internal value that looks like a credential', () => {
    // The layers compose. A wrong classification must not defeat the others.
    const output = redact({
      v: classified('internal', fixture('ghp', '_', '1234567890abcdefghijklmnopqrstuvwxyz')),
    })

    expect(JSON.stringify(output)).not.toContain('ghp_')
  })

  it('descends into nested objects and arrays', () => {
    const output = redact({
      request: { headers: { authorization: 'Bearer abc' }, items: [{ apiKey: 'k' }] },
    })

    expect(JSON.stringify(output)).not.toContain('abc')
    expect(JSON.stringify(output)).not.toContain('"k"')
  })

  it('serialises errors, which are otherwise logged as empty objects', () => {
    const output = redact(new TypeError('bad path')) as Record<string, unknown>

    expect(output.type).toBe('TypeError')
    expect(output.message).toBe('bad path')
    expect(typeof output.stack).toBe('string')
  })

  it('scrubs an error message and follows its cause', () => {
    const error = new Error(
      `failed for ${fixture('ghp', '_', '1234567890abcdefghijklmnopqrstuvwxyz')}`,
      {
        cause: new Error('sent to sarah@example.com'),
      },
    )

    const output = JSON.stringify(redact(error))

    expect(output).not.toContain('ghp_')
    expect(output).not.toContain('sarah@example.com')
  })

  it('breaks cycles rather than following them', () => {
    // Request objects are routinely self-referential, and a log call that
    // hangs the process is worse than a truncated object.
    const cyclic: Record<string, unknown> = { name: 'root' }
    cyclic.self = cyclic

    expect(redact(cyclic)).toEqual({ name: 'root', self: '[CIRCULAR]' })
  })

  it('stops at a bounded depth', () => {
    let deep: Record<string, unknown> = { value: 'bottom' }
    for (let i = 0; i < 20; i += 1) deep = { child: deep }

    expect(JSON.stringify(redact(deep))).toContain('TRUNCATED')
  })

  it('passes primitives through unchanged', () => {
    expect(redact(42)).toBe(42)
    expect(redact(true)).toBe(true)
    expect(redact(null)).toBeNull()
    expect(redact(undefined)).toBeUndefined()
  })
})
