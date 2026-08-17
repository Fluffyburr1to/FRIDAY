import { z } from 'zod'

/**
 * What the FRIDAY runtime is doing.
 *
 * ★ These describe **her process, not the machine.** Chapter 29's system-health
 * group is FRIDAY-scoped — `friday_cpu_percent`, `friday_memory_bytes`,
 * `friday_uptime_seconds`, `friday_disk_free_bytes` — and it defines no
 * host-CPU or host-memory metric at all. A host figure rendered under one of
 * these labels is the substitution ADR-0042 exists to prevent.
 *
 * ── Why a reading can be absent ──────────────────────────────────────────────
 *
 * A vital is either measured or absent, and absent carries a reason. Reporting
 * `0` for something nobody measured is the option that looks best and is a lie,
 * because it renders in the same typeface as the values that were real.
 *
 * Reference: docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
 */

export const VITAL_IDS = ['cpu', 'memory', 'disk', 'uptime', 'temperature', 'network'] as const

const VitalIdSchema = z.enum(VITAL_IDS)

/** Which vital a reading is about. */
export type VitalId = z.infer<typeof VitalIdSchema>

const VitalStateSchema = z.enum(['healthy', 'warning', 'critical'])

/**
 * How the measuring package judges a value.
 *
 * A judgement, not a fact — computed in `diagnostics` and merely rendered by
 * the HUD, so that a surface cannot hold an opinion the rest of FRIDAY cannot
 * see. There is deliberately no `unrated` member; see `MeasuredReadingSchema`.
 */
export type VitalState = z.infer<typeof VitalStateSchema>

const MeasuredReadingSchema = z.object({
  status: z.literal('measured'),
  value: z.number().finite(),

  /**
   * ★ Optional, and that is the model rather than laziness.
   *
   * Uptime is measured, real, and has no duration at which it becomes a
   * problem — so it carries a value and no verdict. An earlier draft added a
   * fourth `unrated` state for this; that was wrong, because "no rating" is the
   * *absence* of a state, and an enum member forces every `switch` over
   * `VitalState` to handle a value that is not one.
   *
   * Omitted means no verdict was formed. It does not mean healthy.
   */
  state: VitalStateSchema.optional(),

  /** The context a bare number loses — "of 10 cores", "12% of 500 GB". */
  qualifier: z.string().min(1).max(64).optional(),
})

/**
 * A value that could not be read, and why.
 *
 * Both fields are required and neither may be empty. An absence with no reason
 * is indistinguishable from a bug, and the owner would be right to read it so.
 */
const AbsentReadingSchema = z.object({
  status: z.literal('absent'),

  /** Plain language, for the owner. */
  reason: z.string().min(1).max(256),

  /** What would make it available — a milestone, a permission, a mechanism. */
  needs: z.string().min(1).max(256),
})

const VitalSchema = z.object({
  id: VitalIdSchema,

  /** As the owner would say it. Rendered directly; never derived from `id`. */
  label: z.string().min(1).max(32),

  /** Empty for dimensionless values. */
  unit: z.enum(['%', 'MB', 'h', 'm', 's', '']),
  reading: z.discriminatedUnion('status', [MeasuredReadingSchema, AbsentReadingSchema]),
})

/** One row of the vitals panel. */
export type Vital = z.infer<typeof VitalSchema>

export const RuntimeVitalsSchema = z.object({
  /**
   * Epoch milliseconds, matching every other timestamp in the system.
   *
   * Required, and for Article II rather than tidiness: a number on an
   * always-open screen with no measurement time cannot be told apart from one
   * that stopped updating an hour ago.
   */
  measuredAt: z.int().nonnegative(),

  /**
   * The window the rate-based vitals were averaged over.
   *
   * CPU is a rate, so a reading without its interval is uninterpretable — 40%
   * over 80 ms and 40% over ten seconds are different claims.
   */
  sampleIntervalMs: z.int().nonnegative(),

  vitals: z.array(VitalSchema),
})

/** Everything the vitals panel renders, in one reading of the FRIDAY process. */
export type RuntimeVitals = z.infer<typeof RuntimeVitalsSchema>
