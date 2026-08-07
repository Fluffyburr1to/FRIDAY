import {
  isAtLeastAsSensitiveAs,
  mayLeaveTheMachine,
  requiresFieldEncryption,
  SENSITIVITY_LEVELS,
  type Sensitivity,
  SensitivitySchema,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('sensitivity', () => {
  it('accepts every declared level and nothing else', () => {
    for (const level of SENSITIVITY_LEVELS) {
      expect(SensitivitySchema.safeParse(level).success).toBe(true)
    }
    expect(SensitivitySchema.safeParse('confidential').success).toBe(false)
  })

  it('orders the levels public < internal < private < secret', () => {
    expect(isAtLeastAsSensitiveAs('secret', 'private')).toBe(true)
    expect(isAtLeastAsSensitiveAs('private', 'internal')).toBe(true)
    expect(isAtLeastAsSensitiveAs('internal', 'public')).toBe(true)
    expect(isAtLeastAsSensitiveAs('public', 'internal')).toBe(false)
  })

  it('treats a level as at least as sensitive as itself', () => {
    for (const level of SENSITIVITY_LEVELS) {
      expect(isAtLeastAsSensitiveAs(level, level)).toBe(true)
    }
  })

  it('encrypts private fields and only private fields', () => {
    // `secret` is NOT encrypted here because it never reaches the database at
    // all — it lives in the Keychain. Storage rejects it rather than
    // encrypting it, which is the behaviour this asserts.
    expect(requiresFieldEncryption('private')).toBe(true)
    expect(requiresFieldEncryption('secret')).toBe(false)
    expect(requiresFieldEncryption('internal')).toBe(false)
    expect(requiresFieldEncryption('public')).toBe(false)
  })

  it('lets nothing above internal leave the machine', () => {
    // Article IV, expressed as a function. A change here is a change to the
    // privacy guarantee, not a refactor.
    expect(mayLeaveTheMachine('public')).toBe(true)
    expect(mayLeaveTheMachine('internal')).toBe(true)
    expect(mayLeaveTheMachine('private')).toBe(false)
    expect(mayLeaveTheMachine('secret')).toBe(false)
  })

  it('has an ordering that covers every declared level', () => {
    // Guards against a level being added to the enum without being ranked,
    // which would make comparisons involving it silently wrong.
    const ranked = SENSITIVITY_LEVELS.filter((level: Sensitivity) =>
      isAtLeastAsSensitiveAs(level, 'public'),
    )

    expect(ranked).toEqual([...SENSITIVITY_LEVELS])
  })
})
