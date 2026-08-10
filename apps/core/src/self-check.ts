import type { ApprovalExplanation, AuthorizingClerk } from '@friday/clerk'
import {
  err,
  type FridayError,
  fridayError,
  type GuardianDecision,
  ok,
  type Result,
  uuidv7,
} from '@friday/contracts'
import type { ChainVerification } from '@friday/storage'
import type { EventReader } from './context.js'

/**
 * FRIDAY checking her own audit trail, with the Guardian's permission.
 *
 * README rule 1 says startup validates database integrity. This is that check,
 * and it is the first thing in FRIDAY that asks the Guardian a question in
 * production rather than in a test.
 *
 * ★ The order is the point: **decide, record, then act.** The chain is not
 * verified until the Guardian has said it may be and that answer is durably in
 * the log. Running the check first and asking afterwards would make the
 * authorization a formality, which is the failure mode Chapter 17 exists to
 * prevent — and doing it in this order once, on FRIDAY's own housekeeping, is
 * what makes the same shape cheap for everything that authorizes later.
 *
 * The actor is a `schedule` rather than the owner or the system, because that
 * is what this is: a job running on FRIDAY's own standing, covered by the
 * shipped `schedules-may-run-diagnostics` rule. A `schedule` presents no
 * capability and needs none, so this path never touches the capability
 * counter — see ADR-0034 for why that matters right now.
 *
 * Reference: docs/adr/0031 · docs/adr/0033 · docs/01-bible/17-authentication-authorization.md
 */

/** Who is asking. Stable, because it is quoted in every decision it causes. */
const ACTOR = { type: 'schedule', id: 'schedule:integrity-check' } as const

/** Three segments, matching the shipped `diagnostics.*.run` rule. */
const ACTION = 'diagnostics.integrity.run'

/** The event log itself. Nothing else is read and nothing is written. */
const RESOURCE = 'events:log'

/** What happened when FRIDAY tried to check herself. */
export interface SelfCheckOutcome {
  /** What the Guardian said. Recorded as `guardian.decided` either way. */
  readonly decision: GuardianDecision

  /**
   * The chain verification, when the Guardian permitted it.
   *
   * Absent when the answer was anything but `allow` — the check did not run,
   * so there is no result, and reporting one would be a claim about a
   * verification that never happened.
   */
  readonly verification?: ChainVerification

  /**
   * What ties this run's events together.
   *
   * One startup check is one operation, and `buildCausalChain` needs a
   * correlation to gather it by. Without one the decision would be a root with
   * nothing to reconstruct it from — recorded, but not reconstructable.
   */
  readonly correlationId: string
}

/**
 * Asks whether the integrity check may run, records the answer, then runs it.
 *
 * A refusal is **not** an error. The rules are the owner's, and a rule set that
 * does not permit this check is one they are entitled to write; FRIDAY
 * respecting it is correct behaviour rather than a fault. The caller reports
 * that the check was skipped and carries on. What is fatal is being unable to
 * ask (the log or the Guardian's stores are unreachable) or asking, being
 * allowed, and finding the chain broken.
 *
 * @param input - The authorizing clerk and the log to verify.
 * @returns What was decided, and what the verification found if it ran.
 */
export async function runStartupSelfCheck(input: {
  authorizing: AuthorizingClerk
  events: EventReader
  principalId: string

  /** Supplied by a test that needs a known value; generated otherwise. */
  correlationId?: string | undefined
}): Promise<Result<SelfCheckOutcome, FridayError>> {
  const { authorizing, events, principalId } = input
  const correlationId = input.correlationId ?? uuidv7()

  const authorized = await authorizing.authorize({
    request: {
      actor: ACTOR,
      principalId,
      action: ACTION,
      resource: RESOURCE,
      correlationId,
    },
    explain: EXPLANATION,
  })

  // An infrastructure failure, not a refusal. Nothing was decided and nothing
  // was recorded, so there is no answer to act on. ADR-0027.
  if (!authorized.ok) return err(authorized.error)

  const { decision } = authorized.value

  if (decision.decision !== 'allow') return ok({ decision, correlationId })

  const verification = events.verifyChain()
  if (!verification.ok) return err(verification.error)

  return ok({ decision, verification: verification.value, correlationId })
}

/**
 * Turns a completed self-check into the reason to stop, if there is one.
 *
 * Split from the check so that "what happened" and "is that fatal" are two
 * readable questions. A broken chain is fatal: Chapter 34 treats a log that
 * fails verification as the one condition FRIDAY must not run through, because
 * every explanation she gives afterwards would be assembled from records she
 * cannot vouch for.
 *
 * @param outcome - What the self-check found.
 * @returns The failure to report and exit on, or null to continue.
 */
export function fatalProblem(outcome: SelfCheckOutcome): FridayError | null {
  const { verification } = outcome

  if (verification === undefined || verification.intact) return null

  return fridayError({
    code: 'CHAIN_BROKEN',
    message:
      'FRIDAY’s audit trail does not verify, so she stopped rather than starting. ' +
      `Everything she told you afterwards would be assembled from records she cannot ` +
      `stand behind. ${verification.reason ?? ''}`.trim(),
    detail: {
      brokenAtSeq: verification.brokenAtSeq,
      eventsChecked: verification.eventsChecked,
      sequenceIntact: verification.sequenceIntact,
      contentIntact: verification.contentIntact,
    },
  })
}

/**
 * What the owner would be told, if this ever needed asking about.
 *
 * Under the shipped rules it never does — `schedules-may-run-diagnostics`
 * allows it outright. It is written truthfully anyway rather than stubbed,
 * because the clerk raises a real approval from it the moment a rule changes,
 * and Chapter 19's bar is that FRIDAY cannot ask about something she cannot
 * explain.
 */
const EXPLANATION: ApprovalExplanation = {
  title: 'Check that the audit trail has not been tampered with',
  explanation: {
    what:
      'Recompute the hash chain over every event in the log and confirm each entry still ' +
      'matches the one before it.',
    why:
      'Run at startup so that anything FRIDAY tells you afterwards comes from records she ' +
      'has just verified rather than ones she is assuming are intact.',
    confidence: 1,
    risks: [
      'Reads the whole log, which takes longer as it grows.',
      'Reports a problem it cannot repair — restoring from a backup is yours to decide.',
    ],
    alternatives: [
      'Verify on a schedule instead of at startup, which leaves a window after a restart.',
      'Verify only the most recent segment, which is faster and would miss older tampering.',
    ],
  },
  preview: { kind: 'none', content: '' },
  impact: {
    reversible: true,
    dataLeavesDevice: false,
    dataCategories: [],
    estimatedCostCents: null,
  },
}
