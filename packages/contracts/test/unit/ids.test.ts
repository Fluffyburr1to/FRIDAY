import { PrincipalIdSchema, timestampFromUuidv7, UuidSchema, uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('uuidv7', () => {
  it('produces a canonical, well-formed UUID', () => {
    const id = uuidv7()

    expect(UuidSchema.safeParse(id).success).toBe(true)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it('sets version 7 and the RFC variant bits', () => {
    const hex = uuidv7().replaceAll('-', '')

    expect(hex[12]).toBe('7')
    expect(['8', '9', 'a', 'b']).toContain(hex[16])
  })

  it('embeds the timestamp so IDs from different milliseconds sort by time', () => {
    const earlier = uuidv7(1_700_000_000_000)
    const later = uuidv7(1_700_000_001_000)

    expect(earlier < later).toBe(true)
  })

  it('round-trips the timestamp', () => {
    const now = 1_754_467_200_000

    expect(timestampFromUuidv7(uuidv7(now))).toBe(now)
  })

  it('is unique across a burst within one millisecond', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidv7(1_700_000_000_000)))

    expect(ids.size).toBe(1000)
  })

  it('handles the boundaries of the 48-bit timestamp range', () => {
    expect(timestampFromUuidv7(uuidv7(0))).toBe(0)
    expect(timestampFromUuidv7(uuidv7(2 ** 48 - 1))).toBe(2 ** 48 - 1)
  })

  it('throws on a timestamp the format cannot represent', () => {
    // A programmer error, so it throws rather than returning a Result.
    expect(() => uuidv7(-1)).toThrow(RangeError)
    expect(() => uuidv7(2 ** 48)).toThrow(RangeError)
    expect(() => uuidv7(1.5)).toThrow(RangeError)
  })
})

describe('timestampFromUuidv7', () => {
  it('returns undefined for a string that is not a UUID', () => {
    expect(timestampFromUuidv7('not-a-uuid')).toBeUndefined()
  })

  it('returns undefined for a UUID of another version', () => {
    // A v4 UUID: well-formed, but its high bits are random, not a timestamp.
    expect(timestampFromUuidv7('9f1c4b2e-1a3d-4c5e-8f9a-0b1c2d3e4f50')).toBeUndefined()
  })
})

describe('PrincipalIdSchema', () => {
  it('accepts an ordinary principal ID', () => {
    expect(PrincipalIdSchema.safeParse('usr_tyler').success).toBe(true)
  })

  it('rejects an empty principal ID', () => {
    // An empty principal is a row that belongs to nobody, which would sit
    // outside every isolation filter in the system.
    expect(PrincipalIdSchema.safeParse('').success).toBe(false)
  })

  it('rejects an over-long principal ID', () => {
    expect(PrincipalIdSchema.safeParse('u'.repeat(129)).success).toBe(false)
  })
})
