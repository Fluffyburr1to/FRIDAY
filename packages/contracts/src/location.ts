import { z } from 'zod'

/**
 * How precisely FRIDAY is willing to say where the owner is.
 *
 * [ADR-0051](../../../docs/adr/0051-the-least-precise-location-that-answers-the-question.md):
 * the least precise representation that answers the request, and a written
 * reason before anything more.
 *
 * ★ **The rule is in the type, not in a caller's discipline.** A `coarse`
 * location carrying unrounded coordinates fails validation, and a `precise`
 * one without a stated reason cannot be constructed at all. So the only way to
 * obtain a coarse location is `coarsen`, and the only way to obtain a precise
 * one is to have written down why.
 *
 * Reference: Constitution Article IV · Chapter 14 · ADR-0051
 */

export const LOCATION_PRECISIONS = ['named-place', 'coarse', 'precise'] as const
export const LocationPrecisionSchema = z.enum(LOCATION_PRECISIONS)
export type LocationPrecision = z.infer<typeof LocationPrecisionSchema>

/**
 * Two decimals — about 1.1 km.
 *
 * ★ Chosen because weather models run at 1–11 km, so a finer coordinate names
 * the same grid cell and buys nothing. Below roughly a kilometre, precision is
 * not a trade-off: it is disclosure with no answer bought.
 */
export const COARSE_DECIMALS = 2

const LatitudeSchema = z.number().min(-90).max(90)
const LongitudeSchema = z.number().min(-180).max(180)

/** True when a coordinate carries no more precision than `coarse` permits. */
function isRounded(value: number): boolean {
  return Math.abs(value - Number(value.toFixed(COARSE_DECIMALS))) < Number.EPSILON
}

export const LocationSchema = z.discriminatedUnion('precision', [
  z.object({
    precision: z.literal('named-place'),

    /** A place the owner named. Never one FRIDAY inferred for them. */
    place: z.string().min(1).max(128),
  }),

  z
    .object({
      precision: z.literal('coarse'),
      latitude: LatitudeSchema,
      longitude: LongitudeSchema,
    })
    .refine(
      (location) => isRounded(location.latitude) && isRounded(location.longitude),
      // ★ Without this a caller could label a house-level coordinate `coarse`
      // and it would be recorded, audited, and sent as though it were a
      // neighbourhood. The label has to be true or the value cannot exist.
      { message: 'a coarse location must already be rounded — build it with coarsen()' },
    ),

  z.object({
    precision: z.literal('precise'),
    latitude: LatitudeSchema,
    longitude: LongitudeSchema,

    /**
     * ★ Why this request needs more than a neighbourhood.
     *
     * A value rather than a flag, and required rather than optional, so a
     * precise disclosure without a stated reason cannot be constructed. The
     * same mechanism as `scopeJustification` on a connector manifest, for the
     * same reason: if you cannot write the sentence, you do not need the
     * precision.
     */
    justification: z.string().min(1).max(512),
  }),
])

/** Where the owner is, said as coarsely as the question allows. */
export type Location = z.infer<typeof LocationSchema>

/**
 * Rounds a coordinate down to the coarse grid.
 *
 * ★ Plain arithmetic: no offset, no jitter, no snapping to a populated place.
 * ADR-0051 §3 rejects those deliberately — displacing the point would invent a
 * location, and an answer for somewhere the owner is not is a wrong answer
 * delivered confidently. Rounding lands in the model's own grid cell, which is
 * the cell the true point is in.
 *
 * @param latitude - Degrees north, -90 to 90.
 * @param longitude - Degrees east, -180 to 180.
 * @returns A coarse location, about a kilometre across.
 */
export function coarsen(latitude: number, longitude: number): Location {
  return {
    precision: 'coarse',
    latitude: Number(latitude.toFixed(COARSE_DECIMALS)),
    longitude: Number(longitude.toFixed(COARSE_DECIMALS)),
  }
}

/**
 * Which data category this disclosure belongs to.
 *
 * ★ Coarse and precise are separate categories so the privacy dashboard can
 * tell *"roughly where I live, daily"* from *"exactly where I was on
 * Tuesday."* One category for both would make the honest answer unavailable.
 *
 * @param location - What is about to be sent.
 * @returns The declared data category it falls under.
 */
export function locationCategory(location: Location): string {
  if (location.precision === 'precise') return 'precise_location'
  if (location.precision === 'coarse') return 'coarse_location'
  return 'named_place'
}

/**
 * The reason a precise disclosure was permitted, when there is one.
 *
 * @param location - The location being sent.
 * @returns The written justification, or `null` for anything coarser.
 */
export function precisionReason(location: Location): string | null {
  return location.precision === 'precise' ? location.justification : null
}
