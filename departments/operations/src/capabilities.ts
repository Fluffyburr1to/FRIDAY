import type { FridayError, HealthStatus, Result } from '@friday/contracts'
import { aggregateHealth } from '@friday/contracts'
import { auditChainCheck, runSelfChecks, type SelfCheck } from '@friday/diagnostics'

/**
 * What Operations can be asked to do.
 *
 * ★ Every capability here is a **pure description of work plus a call to
 * something injected**. None of them reaches for storage, a policy, or a
 * clock of its own. That is what keeps a department replaceable, and it is
 * what makes it impossible for one to quietly acquire authority: there is
 * nothing here to authorise with.
 *
 * Reference: docs/01-bible/13-department-architecture.md
 */

// ── run-self-check ──────────────────────────────────────────────────────────

export interface SelfCheckRequest {
  /** Which checks to run. Empty means every one the department knows. */
  readonly only?: readonly string[]
}

export interface SelfCheckResult {
  readonly status: HealthStatus
  readonly checks: readonly {
    readonly id: string
    readonly status: HealthStatus
    readonly detail: string
  }[]

  /** ★ How many checks could not be run. Never folded into the status. */
  readonly couldNotRun: number
}

export interface SelfCheckDeps {
  /** Verifies the audit chain. Injected: this package does not own the log. */
  readonly verifyChain: () => Promise<Result<{ intact: boolean; checked: number }, FridayError>>

  /** Anything else worth checking. */
  readonly extra?: readonly SelfCheck[]

  readonly now?: () => number
}

/**
 * Runs FRIDAY's self-checks and reports what they found.
 *
 * ★ Returns `ok` even when checks fail or could not run, and that is
 * deliberate: **a self-check that finds a problem has succeeded.** Reporting a
 * broken audit chain as an error would make "the check ran and found
 * something" indistinguishable from "the check could not run", which is the
 * exact confusion Chapter 23 spends its health section preventing.
 *
 * @param request - Which checks to run.
 * @param deps - How to verify things this department does not own.
 * @returns What each check found, and how many could not be run at all.
 */
export async function runSelfCheck(
  request: SelfCheckRequest,
  deps: SelfCheckDeps,
): Promise<Result<SelfCheckResult, FridayError>> {
  const all: SelfCheck[] = [auditChainCheck(deps.verifyChain), ...(deps.extra ?? [])]

  const wanted =
    request.only === undefined || request.only.length === 0
      ? all
      : all.filter((check) => request.only?.includes(check.id))

  const outcomes = await runSelfChecks({
    checks: wanted,
    ...(deps.now === undefined ? {} : { now: deps.now }),
  })

  return {
    ok: true,
    value: {
      status: aggregateHealth(outcomes.map((outcome) => outcome.report)),
      checks: outcomes.map((outcome) => ({
        id: outcome.report.component,
        status: outcome.report.status,
        detail: outcome.report.detail,
      })),
      couldNotRun: outcomes.filter((outcome) => outcome.couldNotRun).length,
    },
  }
}

// ── compact-event-log ───────────────────────────────────────────────────────

export interface CompactRequest {
  /** Events older than this are candidates. Nothing newer is touched. */
  readonly olderThanMs: number
}

export interface CompactResult {
  readonly compacted: number
  readonly archivedTo: string
}

export interface CompactDeps {
  /**
   * Does the compaction. Injected, and the injection is the boundary: this
   * department describes the work and never performs it against the database.
   */
  readonly compact: (
    olderThanMs: number,
  ) => Promise<Result<{ compacted: number; archivedTo: string }, FridayError>>
}

/**
 * Compacts the event log.
 *
 * ★ **This is the capability that must always ask.** It rewrites the record of
 * everything FRIDAY has done — the record the owner would use to check up on
 * her — so the shipped rule classifies it `high` and gives it **no
 * standing-grant exemption**. There is no permission he can leave in place
 * that stops him being asked.
 *
 * ★ Nothing in this function enforces that. The Guardian does, when the step
 * runs. A capability that checked its own permission would be a second
 * authority, and this one would be the worst possible place to start: the one
 * that edits the audit trail.
 *
 * @param request - How far back to compact.
 * @param deps - How to actually do it.
 * @returns What was compacted and where it went.
 */
export function compactEventLog(
  request: CompactRequest,
  deps: CompactDeps,
): Promise<Result<CompactResult, FridayError>> {
  return deps.compact(request.olderThanMs)
}
