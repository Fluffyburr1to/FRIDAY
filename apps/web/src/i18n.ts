/**
 * Every user-facing string, in one place.
 *
 * `apps/web/README.md` rule 5 requires this from the first screen. English is
 * the only locale and there is no plan for a second one — the point is that
 * retrofitting i18n into a codebase with strings hardcoded across a hundred
 * components is weeks of tedious work, and doing it correctly from the start
 * costs almost nothing. Principle 6, applied to a decision made once.
 *
 * Reference: docs/01-bible/06-frontend-architecture.md
 */

const en = {
  'app.title': 'FRIDAY',

  'events.heading': 'Event log',
  'events.connecting': 'Connecting to FRIDAY…',
  'events.empty': 'Nothing has been recorded yet.',

  /**
   * Deliberately not "no events". The dashboard must never present an
   * unreadable log as a quiet one — see apps/core/README.md rule 6.
   */
  'events.unreachable': 'Cannot reach FRIDAY.',
  'events.stale': 'Showing the last data received. It may no longer be current.',

  'events.column.seq': '#',
  'events.column.time': 'Time',
  'events.column.type': 'Event',
  'events.column.actor': 'Actor',
} as const

/** A key into the message table. Unknown keys are a compile error. */
export type MessageKey = keyof typeof en

/**
 * Looks up a user-facing string.
 *
 * @param key - The message key.
 * @returns The string for the active locale.
 */
export function t(key: MessageKey): string {
  return en[key]
}
