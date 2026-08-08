import {
  type Capability,
  CapabilitySchema,
  CapabilityTokenSchema,
  isCapabilityLive,
  MAX_CAPABILITY_LIFETIME_MS,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const SIGNATURE = 'a'.repeat(43)

function validCapability(overrides: Partial<Capability> = {}): unknown {
  return {
    id: uuidv7(),
    principalId: 'usr_tyler',
    issuedTo: { type: 'agent', id: 'agent:communications/draft-email' },
    planId: null,
    planStepId: null,
    action: 'memory.read',
    resource: 'memory:contacts/sarah-chen',
    constraints: { maxCalls: 5, maxAmountCents: null },
    issuedAt: 1_000,
    expiresAt: 1_000 + 60_000,
    uses: 0,
    revokedAt: null,
    revokedReason: null,
    ...overrides,
  }
}

describe('the token value', () => {
  it('accepts a well-formed token', () => {
    expect(CapabilityTokenSchema.safeParse(`fct_v1.${uuidv7()}.${SIGNATURE}`).success).toBe(true)
  })

  it('rejects anything that is not one', () => {
    for (const bad of [
      `fct_v2.${uuidv7()}.${SIGNATURE}`, // wrong version
      `${uuidv7()}.${SIGNATURE}`, // no prefix
      `fct_v1.${uuidv7()}`, // no signature
      `fct_v1.not-a-uuid.${SIGNATURE}`,
      `fct_v1.${uuidv7()}.${'a'.repeat(42)}`, // truncated signature
      `fct_v1.${uuidv7()}.${'a'.repeat(44)}`, // over-long signature
      `fct_v1.${uuidv7()}.${'a'.repeat(42)}+`, // base64, not base64url
      '',
    ]) {
      expect(CapabilityTokenSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('rejects an uppercase identifier, so one token has one spelling', () => {
    expect(
      CapabilityTokenSchema.safeParse(`fct_v1.${uuidv7().toUpperCase()}.${SIGNATURE}`).success,
    ).toBe(false)
  })
})

describe('the stored record', () => {
  it('accepts a well-formed capability', () => {
    expect(CapabilitySchema.safeParse(validCapability()).success).toBe(true)
  })

  it('requires an expiry after issuance', () => {
    for (const expiresAt of [1_000, 500]) {
      expect(CapabilitySchema.safeParse(validCapability({ expiresAt })).success).toBe(false)
    }
  })

  it('caps a capability at fifteen minutes', () => {
    // "Minutes, not hours." A capability that outlives its step is ambient
    // authority wearing a ticket.
    const tooLong = validCapability({ expiresAt: 1_000 + MAX_CAPABILITY_LIFETIME_MS + 1 })
    const atTheCap = validCapability({ expiresAt: 1_000 + MAX_CAPABILITY_LIFETIME_MS })

    expect(CapabilitySchema.safeParse(tooLong).success).toBe(false)
    expect(CapabilitySchema.safeParse(atTheCap).success).toBe(true)
  })

  it('refuses a revocation reason without a revocation', () => {
    const parsed = CapabilitySchema.safeParse(
      validCapability({ revokedAt: null, revokedReason: 'the owner cancelled the plan' }),
    )

    expect(parsed.success).toBe(false)
  })

  it('accepts a revocation with its reason', () => {
    const parsed = CapabilitySchema.safeParse(
      validCapability({ revokedAt: 1_500, revokedReason: 'the owner cancelled the plan' }),
    )

    expect(parsed.success).toBe(true)
  })

  it('refuses a record claiming more uses than it permits', () => {
    expect(
      CapabilitySchema.safeParse(
        validCapability({ constraints: { maxCalls: 2, maxAmountCents: null }, uses: 3 }),
      ).success,
    ).toBe(false)
  })

  it('accepts an uncounted capability with any number of uses', () => {
    expect(
      CapabilitySchema.safeParse(
        validCapability({ constraints: { maxCalls: null, maxAmountCents: null }, uses: 99 }),
      ).success,
    ).toBe(true)
  })

  it('refuses a wildcard in place of a concrete action or resource', () => {
    // The single most important assertion in this file. A wildcard capability
    // would restore the ambient authority ADR-0006 exists to remove.
    expect(CapabilitySchema.safeParse(validCapability({ action: '*' })).success).toBe(false)
    expect(
      CapabilitySchema.safeParse(validCapability({ resource: 'memory:contacts/*' })).success,
    ).toBe(false)
  })
})

describe('liveness', () => {
  const base = {
    expiresAt: 2_000,
    revokedAt: null,
    uses: 0,
    constraints: { maxCalls: 5, maxAmountCents: null },
  }

  it('is live before expiry', () => {
    expect(isCapabilityLive(base, 1_999)).toBe(true)
  })

  it('is dead at and after expiry', () => {
    expect(isCapabilityLive(base, 2_000)).toBe(false)
    expect(isCapabilityLive(base, 2_001)).toBe(false)
  })

  it('is dead once revoked, regardless of the clock', () => {
    expect(isCapabilityLive({ ...base, revokedAt: 1_500 }, 1_000)).toBe(false)
  })

  it('is dead once its call budget is spent', () => {
    expect(isCapabilityLive({ ...base, uses: 5 }, 1_000)).toBe(false)
    expect(isCapabilityLive({ ...base, uses: 4 }, 1_000)).toBe(true)
  })

  it('ignores the call budget when there is none', () => {
    const uncounted = { ...base, constraints: { maxCalls: null, maxAmountCents: null }, uses: 99 }

    expect(isCapabilityLive(uncounted, 1_000)).toBe(true)
  })
})
