import { buildCausalChain, type CausalExplanation, explain, unsupportedClaims } from '@friday/audit'
import {
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  ok,
  type Plan,
  type Result,
} from '@friday/contracts'

/**
 * Composing what FRIDAY did, from what she recorded.
 *
 * ★ **Deterministic, and derived rather than remembered.** Chapter 12 makes
 * reporting the fifth responsibility and marks it deterministic for a reason:
 * an explanation assembled by asking a model what it thinks it did is a
 * plausible story, and Principle 7 asks for the other thing. This reads the
 * event log and nothing else.
 *
 * ★ **It composes; it does not phrase.** `packages/audit` already guarantees
 * the property that matters — every line carries the id of the event it came
 * from, and `unsupportedClaims` can check an explanation says nothing the
 * record does not support. Re-implementing that here would create a second
 * explanation path with weaker guarantees, which is exactly the shape of
 * mistake the Bible keeps warning about. This adds the plan's frame around it.
 *
 * ★ **The stored `explanation` is a cache of this derivation, never a source.**
 * [ADR-0045](../../../docs/adr/0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md)
 * §2: if the stored text and the events ever disagree, the events are right.
 * That is why this can always be recomputed, and why nothing reads the stored
 * string to decide anything.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md
 */

export interface PlanExplanation {
  /** One sentence, for a glance. */
  readonly headline: string

  /** The whole account, every line traceable to a recorded event. */
  readonly detail: CausalExplanation

  /**
   * What the owner actually asked for, in his own words.
   *
   * ★ Quoted from the plan's `utterance`, never from the parsed intent.
   * ADR-0045 §1 keeps both precisely so an explanation can say *"you asked me
   * to X"* using his sentence rather than a model's restatement of it.
   */
  readonly asked: string

  /** Why FRIDAY broke the work up this way, written at planning time. */
  readonly rationale: string
}

export interface ComposeOptions {
  readonly plan: Plan

  /** Every event recorded under this plan's correlation id. */
  readonly events: readonly FridayEvent[]

  /** How much to say. Defaults to the middle. */
  readonly depth?: 'summary' | 'standard' | 'full'

  /** Descriptions for event types nobody has phrased specifically. */
  readonly describe?: (eventType: string) => string | undefined
}

/**
 * Builds the explanation of one plan.
 *
 * @param options - The plan, its events, and how much detail to include.
 * @returns The explanation, or a refusal when it could not be made honestly.
 */
export function composeExplanation(options: ComposeOptions): Result<PlanExplanation, FridayError> {
  const { plan, events } = options

  const mine = events.filter((event) => event.correlationId === plan.correlationId)

  if (mine.length === 0) {
    // ★ Refused rather than answered with an empty account. "FRIDAY did
    // nothing" and "FRIDAY cannot find what she did" are different statements,
    // and only one of them is true here — a plan with no events is a plan
    // whose record is missing, which is a integrity problem rather than a
    // quiet result.
    return err(
      fridayError({
        code: 'NOT_FOUND',
        message:
          'FRIDAY has no record of this plan doing anything, so she will not describe it. ' +
          'That is not the same as it having done nothing.',
        detail: { plan: plan.id, correlationId: plan.correlationId },
      }),
    )
  }

  const chain = buildCausalChain(plan.correlationId, mine)

  const detail = explain(chain, {
    depth: options.depth ?? 'standard',
    ...(options.describe === undefined ? {} : { describe: options.describe }),
  })

  // ★ The check that keeps this honest, run rather than assumed. It exists in
  // `packages/audit` for anything that composes explanations from more than
  // one source — and this composes from two, the log and the plan record.
  const unsupported = unsupportedClaims(detail, chain)

  if (unsupported.length > 0) {
    return err(
      fridayError({
        code: 'VALIDATION_FAILED',
        message:
          'FRIDAY assembled an explanation that says more than her record supports, so she ' +
          'discarded it rather than telling you something she cannot show.',
        detail: { plan: plan.id, unsupported },
      }),
    )
  }

  return ok({
    headline: detail.headline,
    detail,
    asked: plan.utterance,
    rationale: plan.rationale,
  })
}

/**
 * Whether a stored explanation still matches what the events say.
 *
 * ★ The stored string is a cache. This is how a reader checks it has not gone
 * stale — and the answer to a disagreement is always to recompute, never to
 * trust the stored text.
 *
 * @param plan - The plan, carrying its stored explanation.
 * @param events - The events to recompute from.
 * @returns True when the stored text matches a fresh composition.
 */
export function storedExplanationIsCurrent(
  plan: Plan,
  events: readonly FridayEvent[],
): Result<boolean, FridayError> {
  const fresh = composeExplanation({ plan, events })
  if (!fresh.ok) return fresh

  return ok(plan.explanation === fresh.value.headline)
}
