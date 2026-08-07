import {
  GRANT_MAX_LIFETIME_MS,
  isGrantableRiskClass,
  isGrantLive,
  RISK_CLASSES,
  type StandingGrant,
  StandingGrantSchema,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const DAY_MS = 24 * 60 * 60 * 1000
const CREATED_AT = 1_000_000

function validGrant(overrides: Partial<StandingGrant> = {}): unknown {
  return {
    id: uuidv7(),
    principalId: 'usr_tyler',
    actionPattern: 'calendar.event.create',
    resourcePattern: 'calendar:personal/*',
    riskClass: 'medium',
    negative: false,
    constraints: {
      maxAmountCents: null,
      maxPerDay: 5,
      timeWindow: null,
      requiresDryRunMatch: false,
    },
    reason: 'You approved eight of these last month.',
    createdAt: CREATED_AT,
    expiresAt: CREATED_AT + 30 * DAY_MS,
    maxUses: null,
    uses: 0,
    revokedAt: null,
    ...overrides,
  }
}

describe('mandatory expiry', () => {
  it('accepts a grant that ends', () => {
    expect(StandingGrantSchema.safeParse(validGrant()).success).toBe(true)
  })

  it('refuses a grant that ends before it began', () => {
    for (const expiresAt of [CREATED_AT, CREATED_AT - 1]) {
      expect(StandingGrantSchema.safeParse(validGrant({ expiresAt })).success).toBe(false)
    }
  })

  it('caps a medium grant at ninety days and a high grant at thirty', () => {
    const medium = validGrant({ riskClass: 'medium', expiresAt: CREATED_AT + 91 * DAY_MS })
    const high = validGrant({ riskClass: 'high', expiresAt: CREATED_AT + 31 * DAY_MS })

    expect(StandingGrantSchema.safeParse(medium).success).toBe(false)
    expect(StandingGrantSchema.safeParse(high).success).toBe(false)

    expect(
      StandingGrantSchema.safeParse(
        validGrant({ riskClass: 'medium', expiresAt: CREATED_AT + 90 * DAY_MS }),
      ).success,
    ).toBe(true)
    expect(
      StandingGrantSchema.safeParse(
        validGrant({ riskClass: 'high', expiresAt: CREATED_AT + 30 * DAY_MS }),
      ).success,
    ).toBe(true)
  })
})

describe('what may never be granted in advance', () => {
  it('refuses a critical grant outright', () => {
    // Chapter 19's first absolute rule. If any single grant could authorise
    // moving money unattended, Article III's protection for finances would be
    // theoretical.
    expect(StandingGrantSchema.safeParse(validGrant({ riskClass: 'critical' })).success).toBe(false)
  })

  it('refuses a self_modification grant outright', () => {
    // Stricter than Chapter 19's table, which is silent on this class. A
    // standing grant here would mean FRIDAY merging her own changes without
    // being asked, which ADR-0014 forbids.
    expect(
      StandingGrantSchema.safeParse(validGrant({ riskClass: 'self_modification' })).success,
    ).toBe(false)
  })

  it('refuses a grant covering low actions, which never need one', () => {
    expect(StandingGrantSchema.safeParse(validGrant({ riskClass: 'low' })).success).toBe(false)
  })

  it('agrees with the lifetime table about what is grantable', () => {
    for (const riskClass of RISK_CLASSES) {
      expect(isGrantableRiskClass(riskClass)).toBe(GRANT_MAX_LIFETIME_MS[riskClass] !== null)
    }

    expect(RISK_CLASSES.filter(isGrantableRiskClass)).toEqual(['medium', 'high'])
  })
})

describe('no double wildcard', () => {
  it('refuses * for both action and resource', () => {
    const parsed = StandingGrantSchema.safeParse(
      validGrant({ actionPattern: '*', resourcePattern: '*' }),
    )

    expect(parsed.success).toBe(false)
  })

  it('accepts a wildcard on one side only', () => {
    expect(
      StandingGrantSchema.safeParse(
        validGrant({ actionPattern: '*', resourcePattern: 'memory:**' }),
      ).success,
    ).toBe(true)
  })
})

describe('negative grants', () => {
  it('may be unbounded, because refusing everything is a coherent boundary', () => {
    const parsed = StandingGrantSchema.safeParse(
      validGrant({
        negative: true,
        actionPattern: '*',
        resourcePattern: '*',
        reason: 'Never act without asking me first.',
      }),
    )

    expect(parsed.success).toBe(true)
  })

  it('may cover a class no positive grant could', () => {
    const parsed = StandingGrantSchema.safeParse(
      validGrant({
        negative: true,
        riskClass: 'critical',
        reason: 'Never move money, ever.',
        expiresAt: CREATED_AT + 365 * DAY_MS,
      }),
    )

    expect(parsed.success).toBe(true)
  })

  it('still has to end', () => {
    expect(
      StandingGrantSchema.safeParse(validGrant({ negative: true, expiresAt: CREATED_AT })).success,
    ).toBe(false)
  })
})

describe('use counting', () => {
  it('refuses a record claiming more uses than it permits', () => {
    expect(StandingGrantSchema.safeParse(validGrant({ maxUses: 3, uses: 4 })).success).toBe(false)
    expect(StandingGrantSchema.safeParse(validGrant({ maxUses: 3, uses: 3 })).success).toBe(true)
  })
})

describe('constraints', () => {
  it('accepts a well-formed time window and rejects a malformed one', () => {
    const window = (timeWindow: string): unknown =>
      validGrant({
        constraints: {
          maxAmountCents: null,
          maxPerDay: null,
          timeWindow,
          requiresDryRunMatch: false,
        },
      })

    expect(StandingGrantSchema.safeParse(window('09:00-17:30')).success).toBe(true)
    expect(StandingGrantSchema.safeParse(window('9:00-17:30')).success).toBe(false)
    expect(StandingGrantSchema.safeParse(window('24:00-17:30')).success).toBe(false)
    expect(StandingGrantSchema.safeParse(window('09:00')).success).toBe(false)
  })
})

describe('liveness', () => {
  const base = { expiresAt: 2_000, revokedAt: null, uses: 0, maxUses: 3 }

  it('is live before expiry', () => {
    expect(isGrantLive(base, 1_999)).toBe(true)
  })

  it('is dead at and after expiry', () => {
    expect(isGrantLive(base, 2_000)).toBe(false)
  })

  it('is dead once revoked', () => {
    expect(isGrantLive({ ...base, revokedAt: 1_500 }, 1_000)).toBe(false)
  })

  it('is dead once spent', () => {
    expect(isGrantLive({ ...base, uses: 3 }, 1_000)).toBe(false)
    expect(isGrantLive({ ...base, uses: 2 }, 1_000)).toBe(true)
  })

  it('ignores the use ceiling when there is none', () => {
    expect(isGrantLive({ ...base, maxUses: null, uses: 999 }, 1_000)).toBe(true)
  })
})
