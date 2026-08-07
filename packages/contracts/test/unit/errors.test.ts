import { ERROR_CODES, FridayErrorSchema, fridayError } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('fridayError', () => {
  it('builds a minimal error from a code and a message', () => {
    const error = fridayError({ code: 'NOT_FOUND', message: 'No such plan.' })

    expect(error).toEqual({ code: 'NOT_FOUND', message: 'No such plan.' })
    expect(FridayErrorSchema.safeParse(error).success).toBe(true)
  })

  it('omits optional fields rather than setting them to undefined', () => {
    // exactOptionalPropertyTypes is on, and an explicit `undefined` would also
    // serialise into the event log as a null. Absent means absent.
    const error = fridayError({ code: 'TIMEOUT', message: 'Timed out.' })

    expect(Object.hasOwn(error, 'correlationId')).toBe(false)
    expect(Object.hasOwn(error, 'detail')).toBe(false)
    expect(Object.hasOwn(error, 'cause')).toBe(false)
  })

  it('carries the correlation ID and structured detail when given', () => {
    const error = fridayError({
      code: 'STORAGE_WRITE_FAILED',
      message: 'Could not write the event.',
      correlationId: 'corr-1',
      detail: { table: 'events' },
    })

    expect(error.correlationId).toBe('corr-1')
    expect(error.detail).toEqual({ table: 'events' })
  })

  it('renders a thrown Error as name and message, without the stack', () => {
    const error = fridayError({
      code: 'STORAGE_UNAVAILABLE',
      message: 'The database would not open.',
      cause: new TypeError('bad path'),
    })

    expect(error.cause).toBe('TypeError: bad path')
    // Stacks belong in the system log, where redaction sees them.
    expect(error.cause).not.toContain('at ')
  })

  it('renders a thrown string unchanged', () => {
    const error = fridayError({ code: 'TIMEOUT', message: 'Timed out.', cause: 'ETIMEDOUT' })

    expect(error.cause).toBe('ETIMEDOUT')
  })

  it('renders a thrown non-Error, non-string value without throwing itself', () => {
    const error = fridayError({ code: 'TIMEOUT', message: 'Timed out.', cause: { odd: true } })

    expect(error.cause).toBe('[object Object]')
  })

  it('rejects an empty message', () => {
    expect(FridayErrorSchema.safeParse({ code: 'NOT_FOUND', message: '' }).success).toBe(false)
  })

  it('rejects a code outside the closed set', () => {
    expect(FridayErrorSchema.safeParse({ code: 'MADE_UP', message: 'x' }).success).toBe(false)
  })

  it('has no duplicate codes', () => {
    expect(new Set(ERROR_CODES).size).toBe(ERROR_CODES.length)
  })
})
