import {
  COARSE_DECIMALS,
  coarsen,
  type Location,
  LocationSchema,
  locationCategory,
  precisionReason,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/** Somewhere with enough decimals to identify a doorstep. */
const EXACT = { latitude: 55.953_252_1, longitude: -3.188_267_4 }

describe('coarsening', () => {
  it('rounds to about a kilometre', () => {
    // ★ Two decimals because the forecast models run at 1–11 km. A finer
    // coordinate names the same grid cell and buys nothing.
    expect(coarsen(EXACT.latitude, EXACT.longitude)).toEqual({
      precision: 'coarse',
      latitude: 55.95,
      longitude: -3.19,
    })
  })

  it('does not displace the point', () => {
    // ADR-0051 §3. Jitter would invent a location, and a forecast for
    // somewhere the owner is not is a wrong answer delivered confidently.
    const first = coarsen(EXACT.latitude, EXACT.longitude)
    const second = coarsen(EXACT.latitude, EXACT.longitude)

    expect(first).toEqual(second)
    expect(Math.abs((first as { latitude: number }).latitude - EXACT.latitude)).toBeLessThan(0.01)
  })

  it('handles the edges of the world', () => {
    for (const [lat, lon] of [
      [90, 180],
      [-90, -180],
      [0, 0],
    ] as const) {
      expect(LocationSchema.safeParse(coarsen(lat, lon)).success).toBe(true)
    }
  })

  it('produces something the schema accepts', () => {
    expect(LocationSchema.safeParse(coarsen(EXACT.latitude, EXACT.longitude)).success).toBe(true)
  })
})

describe('a coarse location cannot be a precise one wearing a label', () => {
  it('refuses coordinates finer than the label claims', () => {
    // ★ The check that makes the label true. Without it a caller could mark a
    // house-level coordinate `coarse`, and it would be recorded, audited, and
    // sent as though it were a neighbourhood.
    const mislabelled = {
      precision: 'coarse',
      latitude: EXACT.latitude,
      longitude: EXACT.longitude,
    }

    expect(LocationSchema.safeParse(mislabelled).success).toBe(false)
  })

  it('refuses when only one coordinate is too fine', () => {
    for (const bad of [
      { latitude: 55.953_252, longitude: -3.19 },
      { latitude: 55.95, longitude: -3.188_267 },
    ]) {
      expect(LocationSchema.safeParse({ precision: 'coarse', ...bad }).success).toBe(false)
    }
  })

  it('accepts coordinates that are genuinely at the grid', () => {
    expect(
      LocationSchema.safeParse({ precision: 'coarse', latitude: 55.95, longitude: -3.19 }).success,
    ).toBe(true)
  })

  it('accepts a whole number of degrees', () => {
    expect(
      LocationSchema.safeParse({ precision: 'coarse', latitude: 56, longitude: -3 }).success,
    ).toBe(true)
  })
})

describe('precision has to be justified', () => {
  it('refuses a precise location with no reason', () => {
    // ★ A value rather than a flag, and required rather than optional: a
    // precise disclosure without a stated reason cannot be constructed.
    expect(LocationSchema.safeParse({ precision: 'precise', ...EXACT }).success).toBe(false)
  })

  it('refuses an empty reason', () => {
    expect(
      LocationSchema.safeParse({ precision: 'precise', ...EXACT, justification: '' }).success,
    ).toBe(false)
  })

  it('accepts a precise location that says why', () => {
    const parsed = LocationSchema.safeParse({
      precision: 'precise',
      ...EXACT,
      justification: 'You asked what the weather is at the summit, not where you live.',
    })

    expect(parsed.success).toBe(true)
  })

  it('keeps full precision when it is justified', () => {
    // Justified precision is not then quietly rounded — that would answer a
    // different question than the one the reason described.
    const parsed = LocationSchema.parse({
      precision: 'precise',
      ...EXACT,
      justification: 'A specific summit.',
    })

    expect(parsed).toMatchObject({ latitude: EXACT.latitude })
  })

  it('reports the reason, and reports none for anything coarser', () => {
    const precise = LocationSchema.parse({
      precision: 'precise',
      ...EXACT,
      justification: 'A specific summit.',
    })

    expect(precisionReason(precise)).toBe('A specific summit.')
    expect(precisionReason(coarsen(EXACT.latitude, EXACT.longitude))).toBeNull()
    expect(precisionReason({ precision: 'named-place', place: 'Edinburgh' })).toBeNull()
  })
})

describe('a named place', () => {
  it('accepts one the owner chose', () => {
    expect(LocationSchema.safeParse({ precision: 'named-place', place: 'Edinburgh' }).success).toBe(
      true,
    )
  })

  it('refuses an empty one', () => {
    expect(LocationSchema.safeParse({ precision: 'named-place', place: '' }).success).toBe(false)
  })

  it('carries no coordinates at all', () => {
    const parsed = LocationSchema.parse({ precision: 'named-place', place: 'Edinburgh' })

    expect(Object.keys(parsed)).toEqual(['precision', 'place'])
  })
})

describe('the privacy dashboard can tell them apart', () => {
  it('gives each level its own category', () => {
    // ★ One category for both would make "roughly where I live, daily" and
    // "exactly where I was on Tuesday" the same answer.
    const precise: Location = {
      precision: 'precise',
      ...EXACT,
      justification: 'A specific summit.',
    }

    expect(locationCategory(coarsen(EXACT.latitude, EXACT.longitude))).toBe('coarse_location')
    expect(locationCategory(precise)).toBe('precise_location')
    expect(locationCategory({ precision: 'named-place', place: 'Edinburgh' })).toBe('named_place')
  })

  it('never returns the same category for two different levels', () => {
    const categories = [
      locationCategory(coarsen(0, 0)),
      locationCategory({ precision: 'precise', ...EXACT, justification: 'why' }),
      locationCategory({ precision: 'named-place', place: 'Edinburgh' }),
    ]

    expect(new Set(categories).size).toBe(3)
  })
})

describe('the world has edges', () => {
  it('refuses coordinates outside it', () => {
    for (const bad of [
      { latitude: 91, longitude: 0 },
      { latitude: -91, longitude: 0 },
      { latitude: 0, longitude: 181 },
      { latitude: 0, longitude: -181 },
    ]) {
      expect(LocationSchema.safeParse({ precision: 'coarse', ...bad }).success).toBe(false)
    }
  })

  it('agrees with the constant it documents', () => {
    expect(COARSE_DECIMALS).toBe(2)
  })
})
