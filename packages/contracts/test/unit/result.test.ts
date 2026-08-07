import { err, isErr, isOk, ok, unwrapOr } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * `Result` is the error-handling convention every package in FRIDAY follows,
 * so these tests are less about the eight lines of implementation and more
 * about pinning the shape down. If the discriminant ever stops being `.ok`,
 * every `if (result.ok)` in the codebase silently inverts.
 */
describe('Result', () => {
  it('wraps a value as a success', () => {
    const result = ok(42)

    expect(result.ok).toBe(true)
    expect(result.value).toBe(42)
  })

  it('wraps an error as a failure', () => {
    const result = err('boom')

    expect(result.ok).toBe(false)
    expect(result.error).toBe('boom')
  })

  it('narrows through isOk', () => {
    const result = ok('yes')

    expect(isOk(result)).toBe(true)
    expect(isErr(result)).toBe(false)
    if (isOk(result)) expect(result.value).toBe('yes')
  })

  it('narrows through isErr', () => {
    const result = err(new Error('no'))

    expect(isErr(result)).toBe(true)
    expect(isOk(result)).toBe(false)
    if (isErr(result)) expect(result.error.message).toBe('no')
  })

  it('returns the value from unwrapOr on success', () => {
    expect(unwrapOr(ok(7), 0)).toBe(7)
  })

  it('returns the fallback from unwrapOr on failure', () => {
    expect(unwrapOr(err('nope'), 0)).toBe(0)
  })

  it('preserves falsy success values rather than treating them as failure', () => {
    // The bug this pins down: `result.value || fallback` would return the
    // fallback for a legitimate 0, empty string, or false.
    expect(unwrapOr(ok(0), 99)).toBe(0)
    expect(unwrapOr(ok(''), 'fallback')).toBe('')
    expect(unwrapOr(ok(false), true)).toBe(false)
  })
})
