import { z } from 'zod'

/**
 * The uniform health interface every component implements.
 *
 * ★ **`unknown` is honest, and it is the reason this enum has four members
 * rather than three.** [Chapter 23](../../../docs/01-bible/23-diagnostics-system.md):
 * a component that has not reported recently is `unknown`, **not** `healthy`.
 * Assuming health from silence is how outages go unnoticed — the dashboard
 * shows green, nobody looks, and the thing that stopped reporting is the thing
 * that broke.
 *
 * Reference: docs/01-bible/23-diagnostics-system.md
 */

export const HEALTH_STATUSES = ['healthy', 'degraded', 'unhealthy', 'unknown'] as const

export const HealthStatusSchema = z.enum(HEALTH_STATUSES)
export type HealthStatus = z.infer<typeof HealthStatusSchema>

export const HealthReportSchema = z.object({
  /** Which component this is about. */
  component: z.string().min(1).max(128),

  status: HealthStatusSchema,

  /** Plain language, for someone who does not read code. */
  detail: z.string().min(1).max(512),

  checkedAt: z.int().nonnegative(),

  /** How long the check itself took. A slow check is itself a signal. */
  latencyMs: z.int().nonnegative(),

  /** Numbers worth showing. Never the reason for the status on their own. */
  metrics: z.record(z.string(), z.number()),
})

/** What one component says about itself. */
export type HealthReport = z.infer<typeof HealthReportSchema>

/**
 * Ordered worst-first, so aggregating is taking a maximum.
 *
 * ★ `unknown` ranks **above** `healthy` and below `degraded`. Not knowing is
 * worse than being fine and better than being broken, and putting it anywhere
 * else makes a silent component either invisible or an emergency.
 */
const SEVERITY: Readonly<Record<HealthStatus, number>> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  unhealthy: 3,
}

/**
 * The status of the whole from the status of the parts.
 *
 * @param reports - What each component said.
 * @returns The worst status present, or `unknown` when nothing reported.
 */
export function aggregateHealth(reports: readonly HealthReport[]): HealthStatus {
  if (reports.length === 0) return 'unknown'

  let worst: HealthStatus = 'healthy'

  for (const report of reports) {
    if (SEVERITY[report.status] > SEVERITY[worst]) worst = report.status
  }

  return worst
}

/**
 * Whether a report is too old to still be believed.
 *
 * ★ The mechanism behind "silence is not health". A caller passes the age it
 * is willing to accept; anything older becomes `unknown` regardless of what it
 * last said.
 *
 * @param report - The last thing a component said.
 * @param now - The current time.
 * @param maxAgeMs - How old a report may be and still count.
 * @returns The report, or the same report as `unknown` when it has gone stale.
 */
export function freshOrUnknown(report: HealthReport, now: number, maxAgeMs: number): HealthReport {
  if (now - report.checkedAt <= maxAgeMs) return report

  return {
    ...report,
    status: 'unknown',
    detail: `${report.component} has not reported since it last said: ${report.detail}`,
  }
}
