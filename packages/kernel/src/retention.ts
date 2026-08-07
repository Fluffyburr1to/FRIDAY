import type { FridayEvent } from '@friday/contracts'
import { z } from 'zod'

/**
 * What may be compacted, and what may never be.
 *
 * Chapter 10 lists the classes compaction must never touch: any approval, any
 * Guardian decision, any connector call that sent data outside the machine,
 * any model invocation, any self-modification event, **and any event in the
 * causation chain of one of those.**
 *
 * That last clause is the one that does the work, and it is why this file
 * computes protection over the causal graph rather than by matching type names
 * one at a time. An approval on its own is not an audit trail. The approval
 * plus what led to it, and what followed from it, is.
 *
 * ★ Nothing here removes or rewrites an event. This decides *eligibility* and
 * nothing else, so that the rules can be read, tested, and argued with
 * independently of the machinery that acts on them. Given what compaction
 * does, those two things should not be the same file.
 *
 * Reference: docs/01-bible/10-event-bus.md · ADR-0024 · ADR-0028
 */

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Event type patterns that may never be compacted, whatever the policy says.
 *
 * Not configurable, deliberately. A retention policy the owner can edit is
 * correct for *tuning* what is kept; it is not the right place for the list of
 * things that make the audit trail an audit trail. If these were policy, a
 * single edit could quietly make the record of every approval disposable.
 */
export const PROTECTED_PATTERNS: readonly string[] = [
  'approval.*',
  'grant.*',
  'guardian.*',
  'capability.*',
  'connector.*',
  'model.*',
  'engineering.*',
  'credential.*',
]

/** The tiers Chapter 10 defines. */
export const TIERS = ['hot', 'warm', 'cold'] as const

export type Tier = (typeof TIERS)[number]

export const RetentionPolicySchema = z
  .object({
    /** Days an event stays fully indexed and untouched. Chapter 10 says 90. */
    hotDays: z.int().positive().max(3650),

    /** Days before an event becomes eligible to leave for the archive. */
    warmDays: z.int().positive().max(36_500),

    /**
     * Event types that may be collapsed into hourly summaries once warm.
     *
     * An explicit list rather than a rule, because "high-frequency, low-value"
     * is a judgement and it should be the owner's, made once, in writing —
     * not a heuristic that quietly reclassifies something the day its volume
     * changes.
     */
    collapsible: z.array(z.string().min(1).max(128)).max(64),

    /**
     * Payload bytes above which a warm event's body may be dropped, keeping a
     * reference. Null means never drop a body.
     */
    dropBodiesOverBytes: z.int().positive().nullable(),
  })
  .superRefine((policy, ctx) => {
    if (policy.warmDays <= policy.hotDays) {
      ctx.addIssue({
        code: 'custom',
        path: ['warmDays'],
        message: 'the warm tier has to start after the hot tier ends',
      })
    }

    for (const [index, pattern] of policy.collapsible.entries()) {
      if (matchesAny(pattern, PROTECTED_PATTERNS)) {
        ctx.addIssue({
          code: 'custom',
          path: ['collapsible', index],
          message: `"${pattern}" names events that may never be compacted`,
        })
      }
    }
  })

/** How long things are kept, and what may be thinned. */
export type RetentionPolicy = z.infer<typeof RetentionPolicySchema>

/**
 * Chapter 10's defaults: 90 days hot, two years warm.
 *
 * `collapsible` is empty. Nothing is thinned until the owner says which types
 * are noise, because FRIDAY is the wrong judge of what is worth keeping about
 * her own behaviour.
 */
export const DEFAULT_RETENTION: RetentionPolicy = {
  hotDays: 90,
  warmDays: 730,
  collapsible: [],
  dropBodiesOverBytes: null,
}

/** Whether a type is covered by a pattern with a trailing `*`. */
function matches(pattern: string, type: string): boolean {
  if (pattern === type) return true
  if (!pattern.endsWith('*')) return false

  return type.startsWith(pattern.slice(0, -1))
}

function matchesAny(type: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => matches(pattern, type))
}

/**
 * Whether an event's own type puts it beyond compaction.
 *
 * Does not consider the causal graph — `protectedEventIds` does that, and it
 * is the one to use when deciding what may actually be touched.
 *
 * @param type - The event type.
 * @returns True when the type is one Chapter 10 protects.
 */
export function isProtectedType(type: string): boolean {
  return matchesAny(type, PROTECTED_PATTERNS)
}

/**
 * Every event that may never be compacted, including by association.
 *
 * Protection spreads along causation links in **both** directions. Chapter 10
 * says "any event in the causation chain of one of those", which most
 * naturally means what led to it; what *followed* from it is included as well,
 * on the grounds that an approval whose consequences were thinned away is an
 * approval whose meaning cannot be reconstructed.
 *
 * That is the over-broad reading, and it is chosen deliberately: the cost of
 * protecting too much is disk, and the cost of protecting too little is a hole
 * in the record of a decision the Constitution depends on.
 *
 * @param events - Every event under consideration, in any order.
 * @returns The ids that must be left alone.
 */
export function protectedEventIds(events: readonly FridayEvent[]): ReadonlySet<string> {
  const byId = new Map(events.map((event) => [event.id, event]))

  const children = new Map<string, string[]>()
  for (const event of events) {
    if (event.causationId === undefined) continue

    const siblings = children.get(event.causationId)
    if (siblings === undefined) children.set(event.causationId, [event.id])
    else siblings.push(event.id)
  }

  const protectedIds = new Set<string>()
  const pending = events.filter((event) => isProtectedType(event.type)).map((event) => event.id)

  // Breadth-first with a seen-set, so a damaged log containing a causation
  // cycle terminates instead of spinning.
  while (pending.length > 0) {
    const id = pending.pop()
    if (id === undefined || protectedIds.has(id)) continue

    protectedIds.add(id)

    const event = byId.get(id)
    if (event?.causationId !== undefined) pending.push(event.causationId)

    for (const child of children.get(id) ?? []) pending.push(child)
  }

  return protectedIds
}

/** Which tier an event falls in, by age alone. */
export function tierOf(event: FridayEvent, policy: RetentionPolicy, now: number): Tier {
  const age = now - event.occurredAt

  if (age < policy.hotDays * DAY_MS) return 'hot'
  if (age < policy.warmDays * DAY_MS) return 'warm'

  return 'cold'
}

/** What compaction is permitted to do to one event. */
export interface CompactionPlan {
  readonly eventId: string
  readonly seq: number
  readonly tier: Tier

  /** Collapse into an hourly summary with its neighbours of the same type. */
  readonly collapse: boolean

  /** Drop the payload body, keeping a tombstone and the digest. */
  readonly dropBody: boolean
}

/**
 * Decides what may be done to each event, and refuses to touch the rest.
 *
 * @param input - The events, the policy, and the current time.
 * @returns A plan per event that may be touched. Events absent from the result
 *   are ones nothing may do anything to.
 */
export function planCompaction(input: {
  events: readonly FridayEvent[]
  policy: RetentionPolicy
  now: number
}): readonly CompactionPlan[] {
  const untouchable = protectedEventIds(input.events)
  const plans: CompactionPlan[] = []

  for (const event of input.events) {
    // ★ The check that matters. Nothing below runs for a protected event.
    if (untouchable.has(event.id)) continue

    const tier = tierOf(event, input.policy, input.now)
    if (tier === 'hot') continue

    const collapse = matchesAny(event.type, input.policy.collapsible)
    const dropBody =
      input.policy.dropBodiesOverBytes !== null &&
      JSON.stringify(event.payload).length > input.policy.dropBodiesOverBytes

    if (!collapse && !dropBody) continue

    plans.push({ eventId: event.id, seq: event.seq, tier, collapse, dropBody })
  }

  return plans
}
