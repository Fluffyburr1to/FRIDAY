import type { FridayEvent } from '@friday/contracts'

/**
 * Who is listening, and on which lane.
 *
 * Nothing in FRIDAY calls anything else directly. Components announce what
 * they did, and whoever cares listens — which is what makes them replaceable
 * independently, and what makes adding a department next year require no
 * change to anything that already exists.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

/**
 * A subscriber whose work is part of the truth.
 *
 * Runs in the SAME transaction as the event write. If it throws, the
 * transaction rolls back and the event is not recorded at all.
 *
 * Reserved for the audit record, projections, and the plan engine — the things
 * where "the event happened but the state did not change" would be a lie. A
 * department or a notification does NOT belong here: a slow one would block
 * every write in the system.
 *
 * Sync handlers are synchronous by type, not by convention. A promise cannot
 * be awaited inside a SQLite transaction, and a handler that returned one
 * would have its failure silently escape the rollback.
 */
export interface SyncSubscriber {
  /** Stable and unique. Appears in logs and in `friday status`. */
  readonly id: string

  /** An event type, or a pattern such as `approval.*` or `*`. */
  readonly pattern: string

  handle(event: FridayEvent): void
}

/**
 * A subscriber that reacts after the fact.
 *
 * Gets its own queue, its own retries, and its own checkpoint. A failing one
 * accumulates a backlog and eventually dead-letters; it cannot block the
 * publisher or any other subscriber.
 *
 * ★ Must be idempotent. After a crash it may see an event it already handled,
 * because it resumes from its last acknowledged sequence number. Chapter 10
 * accepts this deliberately: exactly-once delivery is impossible to guarantee
 * and expensive to approximate, and at-least-once with idempotent handlers is
 * the honest alternative.
 */
export interface AsyncSubscriber {
  readonly id: string
  readonly pattern: string

  handle(event: FridayEvent): Promise<void>
}

/** Removes a subscription. Returned by both `subscribe` methods. */
export type Unsubscribe = () => void

/**
 * Tests an event type against a subscription pattern.
 *
 * Kept here rather than imported from `contracts` so the bus has one place
 * that decides who hears what — the routing rule and the schema rule are
 * different concerns that happen to share a syntax.
 *
 * @param pattern - `*`, an exact type, or one with `*` as a segment.
 * @param type - The event type being dispatched.
 * @returns True when this subscriber should be notified.
 */
export function matches(pattern: string, type: string): boolean {
  if (pattern === '*' || pattern === type) return true

  const patternSegments = pattern.split('.')
  const typeSegments = type.split('.')
  if (patternSegments.length !== typeSegments.length) return false

  return patternSegments.every(
    (segment, index) => segment === '*' || segment === typeSegments[index],
  )
}
