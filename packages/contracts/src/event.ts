import { z } from 'zod'
import { ActorSchema, SubjectSchema } from './actor.js'
import { CausationIdSchema, CorrelationIdSchema, EventIdSchema, PrincipalIdSchema } from './ids.js'
import { SensitivitySchema } from './sensitivity.js'

/**
 * The event envelope — the single most load-bearing shape in FRIDAY.
 *
 * The event log is simultaneously the message bus and the audit trail. That is
 * why the audit trail cannot fall out of sync with reality: writing the event
 * *is* how the action happens. Every field below exists because something in
 * the founding documents needs it, and the four that carry the most weight are
 * called out where they are declared.
 *
 * Reference: docs/01-bible/10-event-bus.md · Chapter 09
 */

/**
 * `<domain>.<subject>.<verb-past>` — lowercase, dot-separated, past tense.
 *
 * Chapter 10 says "three segments, always" and then gives `plan.created`,
 * `approval.granted`, and `model.invoked` as canonical examples, which have
 * two. The pattern is read here as domain and subject fusing when they are the
 * same noun, so **two or three segments are accepted**. Enforcing exactly
 * three would reject the Bible's own examples. Wildcards (`approval.*`) work
 * either way, which is what the segment rule was protecting.
 *
 * Past tense is not machine-checked — English is too irregular for a regex to
 * tell `sent` from `send` — so it stays a review rule. What IS enforced is
 * that a type is a well-formed, lowercase, dotted name, because a typo in an
 * event type is a subscriber that silently never fires.
 *
 * Underscores are permitted inside a segment for the same reason two segments
 * are: Chapter 19 names `approval.auto_granted` as the event the dashboard
 * shows when a standing grant is applied, and a rule that rejects the Bible's
 * own event names would be enforcing a convention nobody agreed to.
 */
export const EVENT_TYPE_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,2}$/

export const EventTypeSchema = z
  .string()
  .min(3)
  .max(128)
  .regex(EVENT_TYPE_PATTERN, 'event types are two or three lowercase dot-separated segments')

/** A registered event type, e.g. `plan.step.completed`. */
export type EventType = z.infer<typeof EventTypeSchema>

/**
 * A subscription pattern: an event type, or one with `*` as its final segment.
 *
 * `approval.*` matches `approval.granted` and `approval.requested`. `*` alone
 * matches everything, which is what the dashboard's live view subscribes to.
 */
export const EVENT_PATTERN_REGEX = /^(?:\*|[a-z][a-z0-9_]*(?:\.(?:[a-z][a-z0-9_]*|\*)){0,2})$/

export const EventPatternSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(EVENT_PATTERN_REGEX, 'patterns are an event type, or one ending in *')

/** What a subscriber asks to hear about. */
export type EventPattern = z.infer<typeof EventPatternSchema>

/** Unix milliseconds. Stored as an integer so ordering never depends on a parser. */
const TimestampSchema = z.int().nonnegative()

/**
 * What a publisher provides. The kernel supplies everything else.
 *
 * A publisher never chooses `seq`, `recordedAt`, or `integrityHash` — those
 * are assigned inside the append transaction, which is the only place they can
 * be assigned correctly.
 */
export const NewEventSchema = z.object({
  type: EventTypeSchema,

  /** When it actually happened. Differs from `recordedAt` on replay and import. */
  occurredAt: TimestampSchema.optional(),

  actor: ActorSchema,

  /** ★ The multi-user seam. Every event names whose data it concerns. */
  principalId: PrincipalIdSchema,

  subject: SubjectSchema.optional(),

  /**
   * ★ The event that directly caused this one. Together with `correlationId`
   * this forms the causal tree the Audit package walks to answer "why?" — from
   * recorded fact rather than from a model's recollection of its own
   * reasoning, which is fluent and frequently false.
   */
  causationId: CausationIdSchema.optional(),

  /** ★ The root request this event belongs to. Groups a whole operation. */
  correlationId: CorrelationIdSchema.optional(),

  /** Links to the OpenTelemetry trace, when one is active. */
  traceId: z.string().min(1).max(64).optional(),

  /** Validated against the versioned schema registered for `type`. */
  payload: z.record(z.string(), z.unknown()),

  /**
   * The payload schema version. Old events keep their original shape forever;
   * a reader converts them with an upcaster at read time. Omitted means 1.
   *
   * Deliberately `.optional()` rather than `.default(1)`: a Zod default makes
   * the parsed type and the authored type differ, and two subtly different
   * `NewEvent` types is exactly the kind of thing that costs an afternoon.
   */
  payloadVersion: z.int().positive().optional(),

  /** ★ Drives redaction, encryption, and cloud eligibility. Never optional. */
  sensitivity: SensitivitySchema,
})

/** An event as handed to `publish`, before the kernel assigns its position. */
export type NewEvent = z.infer<typeof NewEventSchema>

export const EventSchema = NewEventSchema.extend({
  /**
   * ★ Monotonic and gapless. THE ordering authority — not the timestamp, which
   * can go backwards when the clock is adjusted, and not the ID.
   */
  seq: z.int().positive(),

  id: EventIdSchema,

  occurredAt: TimestampSchema,

  /** When we wrote it. Equals `occurredAt` except on replay and import. */
  recordedAt: TimestampSchema,

  payloadVersion: z.int().positive(),

  /**
   * ★ SHA-256 over this event's canonical form plus the previous event's hash.
   * Altering or deleting a historical event breaks every hash after it.
   *
   * This is not protection against an attacker with write access — they could
   * recompute the chain. It reliably detects corruption, accidental
   * modification, and buggy code writing where it should not, and for an audit
   * trail the Constitution depends on, "we would know if it changed" is a
   * meaningful property.
   */
  integrityHash: z.string().regex(/^[0-9a-f]{64}$/, 'integrity hashes are lowercase SHA-256 hex'),
})

/** A recorded event, as it exists in the log. */
export type FridayEvent = z.infer<typeof EventSchema>

/**
 * Tests an event type against a subscription pattern.
 *
 * @param pattern - A pattern such as `approval.*`, `plan.step.completed`, or `*`.
 * @param type - The event type to test.
 * @returns True when a subscriber registered for `pattern` should be notified.
 */
export function matchesPattern(pattern: string, type: string): boolean {
  if (pattern === '*') return true
  if (pattern === type) return true

  const patternSegments = pattern.split('.')
  const typeSegments = type.split('.')
  if (patternSegments.length !== typeSegments.length) return false

  return patternSegments.every(
    (segment, index) => segment === '*' || segment === typeSegments[index],
  )
}
