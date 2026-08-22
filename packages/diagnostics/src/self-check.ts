import type { FridayError, HealthReport, HealthStatus, Result } from '@friday/contracts'

/**
 * Self-checks — the problems that do not announce themselves.
 *
 * ★ [Chapter 23](../../../docs/01-bible/23-diagnostics-system.md) names the
 * audit-chain check as the most important thing in this file, and gives the
 * reason plainly: **if FRIDAY's audit trail can be silently modified, every
 * guarantee in the Bible is void.** A trail that is merely present is not a
 * trail that is trustworthy; verifying it is what makes the difference.
 *
 * Two rules from that chapter shape the whole design here:
 *
 * ★ **A check that cannot be run reports `unknown`, never `healthy`.**
 * Assuming health from silence is how outages go unnoticed. A check that
 * throws, times out, or finds nothing to look at has not established that
 * anything is fine.
 *
 * ★ **Checks are cheap and have no side effects.** A check that costs money —
 * a model call — or writes data is a check that becomes a problem at scale.
 * Nothing here invokes a model, and nothing here writes.
 *
 * Reference: docs/01-bible/23-diagnostics-system.md
 */

/** One thing worth verifying, and how to verify it. */
export interface SelfCheck {
  /** Stable, kebab-case, and quoted whenever a result is explained. */
  readonly id: string

  /** What this establishes, in the owner's language. */
  readonly description: string

  /**
   * Runs the check.
   *
   * Returning a failed `Result` means *the check could not be run* — which is
   * `unknown`, not `unhealthy`. A check that ran and found a problem returns
   * `ok` with a bad status. The distinction is the whole point: "I looked and
   * it is broken" and "I could not look" are different, and only the first is
   * evidence.
   */
  run(): Promise<
    Result<{ status: HealthStatus; detail: string; metrics?: Record<string, number> }, FridayError>
  >
}

export interface SelfCheckOutcome {
  readonly report: HealthReport

  /** ★ True when the check itself failed, rather than finding a problem. */
  readonly couldNotRun: boolean
}

export interface RunSelfChecksOptions {
  readonly checks: readonly SelfCheck[]

  /** Injected so a test drives the clock rather than sleeping. */
  readonly now?: () => number
}

/**
 * Runs every check and reports what each one found.
 *
 * ★ One check failing never stops the others. A self-check run that abandoned
 * itself on the first problem would hide every problem after it, and the
 * whole point is to find the ones nobody is looking for.
 *
 * @param options - The checks to run, and optionally a clock.
 * @returns One outcome per check, in the order given.
 */
export async function runSelfChecks(options: RunSelfChecksOptions): Promise<SelfCheckOutcome[]> {
  const now = options.now ?? Date.now
  const outcomes: SelfCheckOutcome[] = []

  for (const check of options.checks) {
    const startedAt = now()

    // ★ A check that throws is a check that did not run. Wrapped in try/catch
    // rather than `.catch()` on purpose: a check that throws SYNCHRONOUSLY
    // never returns a promise to attach a handler to, so `.catch()` would let
    // the exception escape and take every remaining check down with it — the
    // exact failure this whole function is arranged to prevent.
    const result = await runSafely(check)

    const checkedAt = now()
    const latencyMs = Math.max(0, checkedAt - startedAt)

    if (!result.ok) {
      outcomes.push({
        couldNotRun: true,
        report: {
          component: check.id,
          // ★ `unknown`, not `unhealthy`. Nothing has been established.
          status: 'unknown',
          detail: `FRIDAY could not run this check: ${result.error.message}`,
          checkedAt,
          latencyMs,
          metrics: {},
        },
      })

      continue
    }

    outcomes.push({
      couldNotRun: false,
      report: {
        component: check.id,
        status: result.value.status,
        detail: result.value.detail,
        checkedAt,
        latencyMs,
        metrics: result.value.metrics ?? {},
      },
    })
  }

  return outcomes
}

/**
 * Calls a check, turning any throw — sync or async — into a failed result.
 *
 * @param check - The check to run.
 * @returns Its result, or a failure describing what it threw.
 */
async function runSafely(check: SelfCheck): Promise<Awaited<ReturnType<SelfCheck['run']>>> {
  try {
    return await check.run()
  } catch (cause) {
    return {
      ok: false,
      error: {
        code: 'SUBSCRIBER_FAILED',
        message: cause instanceof Error ? cause.message : String(cause),
      } as FridayError,
    }
  }
}

/**
 * The audit-chain check — the one Chapter 23 calls most important.
 *
 * ★ Built as a factory over an injected verifier rather than reaching for
 * storage, because `packages/diagnostics` does not own the database and
 * nothing outside `packages/storage` may touch it.
 *
 * @param verify - Runs the chain verification and says whether it held.
 * @returns The check.
 */
export function auditChainCheck(
  verify: () => Promise<Result<{ intact: boolean; checked: number }, FridayError>>,
): SelfCheck {
  return {
    id: 'audit-chain',
    description: 'The record of everything FRIDAY has done has not been altered.',

    async run() {
      const verified = await verify()
      if (!verified.ok) return verified

      const { intact, checked } = verified.value

      return {
        ok: true,
        value: {
          // ★ A broken chain is `unhealthy`, not `degraded`. There is no
          // partial version of "the audit trail can be trusted".
          status: intact ? ('healthy' as const) : ('unhealthy' as const),
          detail: intact
            ? `The record is intact. ${checked} events checked.`
            : `The record has been altered. ${checked} events checked, and the chain does not hold. ` +
              'Nothing FRIDAY says about the past can be trusted until this is explained.',
          metrics: { eventsChecked: checked },
        },
      }
    },
  }
}
