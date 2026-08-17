import { z } from 'zod'

/**
 * Intent — what FRIDAY understood the owner to be asking for.
 *
 * ★ This is an *interpretation*, and the shape exists to keep it labelled as
 * one. The owner's actual words live beside it on the plan, in `utterance`,
 * and they are never overwritten by this: an explanation that says "you asked
 * me to X" has to be able to quote him rather than quote a model's restatement
 * of him (ADR-0045 §1).
 *
 * Only the Chief of Staff produces one, from a single bounded model call with
 * no tools (Chapter 12, responsibility 1). Nothing else may write one, and
 * nothing derived from it may widen what it says.
 *
 * ★ `ambiguities` is the load-bearing field, and it is the one most likely to
 * be dropped as ceremony by someone in a hurry. Chapter 12's ambiguity ladder
 * ends in *ask the owner*, and a parser that resolved everything it saw is
 * indistinguishable from a parser that guessed — unless the things it declined
 * to resolve are recorded as data. Silence is not evidence of clarity.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md ·
 *            docs/adr/0045-the-plan-record-is-completed-to-chapter-12-before-the-engine-is-built.md
 */

/**
 * Something the parser would not decide on its own.
 *
 * Chapter 12: *"never guess on a consequential step."* A low-risk step may
 * proceed on a stated assumption; anything `high` or above blocks and asks.
 * Either way the question is written down here first, so the explanation can
 * say what was assumed and the approval screen can say what was unresolved.
 */
export const AmbiguitySchema = z.object({
  /** What is unresolved, as a dotted path into `entities`, e.g. `recipient`. */
  field: z.string().min(1).max(128),

  /** The question to put to the owner, in his language, not the parser's. */
  question: z.string().min(1).max(512),

  /**
   * What it could have meant, best first. May be empty.
   *
   * Empty means *nothing plausible was found*, which is a different and more
   * honest answer than a single low-confidence guess. It is not padded.
   */
  candidates: z.array(z.string().min(1).max(256)).max(16),
})

/** One thing the parser declined to decide. */
export type Ambiguity = z.infer<typeof AmbiguitySchema>

export const IntentSchema = z.object({
  /**
   * The kind of thing being asked for, e.g. `diagnostics.self-check`.
   *
   * ★ Not a capability id, and not a department. Routing from intent to
   * capability is deterministic code that runs *after* this
   * ([ADR-0040](../../../docs/adr/0040-a-capability-is-a-department-inside-the-guardian-boundary.md) §3).
   * If a model could name the capability directly it would be choosing the
   * tool, which is the design Chapter 12 rejects — the audit answer to "why
   * did FRIDAY do that?" must not be "the model picked it".
   */
  kind: z.string().min(1).max(128),

  /**
   * How sure the parser was, 0 to 1.
   *
   * Advisory, and deliberately not wired to anything that decides. It informs
   * what the owner is shown; it may never lower an approval requirement,
   * because a confident parse of a manipulated instruction is exactly the case
   * that would exploit it.
   */
  confidence: z.number().min(0).max(1),

  /**
   * What the request resolved to — the subjects, targets, and qualifiers.
   *
   * Open-ended on purpose. Every consumer validates the slice it needs at its
   * own boundary; a closed shape here would have to be widened by every new
   * capability, and widening a shared schema per feature is how it becomes
   * meaningless.
   */
  entities: z.record(z.string(), z.unknown()),

  /** What the parser would not decide. Empty means it found nothing unclear. */
  ambiguities: z.array(AmbiguitySchema).max(32),
})

/** FRIDAY's structured reading of what was asked. */
export type Intent = z.infer<typeof IntentSchema>

/**
 * Whether an intent left anything unresolved.
 *
 * @param intent - The parsed intent.
 * @returns True when at least one ambiguity was recorded.
 */
export function hasAmbiguities(intent: Intent): boolean {
  return intent.ambiguities.length > 0
}
