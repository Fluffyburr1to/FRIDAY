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

  'approvals.heading': 'Needs you',
  'approvals.risk': 'Risk',
  'approvals.reversible': 'Reversible',
  'approvals.leaves': 'Data leaves this Mac',
  'approvals.yes': 'Yes',
  'approvals.no': 'No',
  'approvals.approve': 'Approve',
  'approvals.decline': 'Decline',

  /**
   * Said out loud rather than left as a greyed-out control. The owner should
   * never have to guess whether FRIDAY is stuck or the button is deliberate.
   */
  'approvals.needsStepUp':
    'This one needs you to prove it is you. A browser on this Mac can tell FRIDAY the ' +
    'request came from your computer, not that you are sitting at it — so it waits for the ' +
    'Mac app, which can ask for Touch ID.',

  // ── Plans ─────────────────────────────────────────────────────────────────

  'plans.heading': 'What she is doing',
  'plans.connecting': 'Connecting to FRIDAY…',

  /**
   * Deliberately not "no plans". A plan list that cannot be read must never
   * look like an idle assistant — the same rule the event log follows.
   */
  'plans.unreachable': 'Cannot reach FRIDAY.',
  'plans.empty': 'She has not been asked to do anything yet.',

  'plans.stepsDone': '{done} of {total} done',

  /**
   * ★ Sentences, not the enum. The two waiting states are worded differently
   * on purpose: "she wants you to see the plan" and "she is partway through
   * and stuck" are different situations, and collapsing them would hide which
   * one the owner is being asked about.
   */
  'plans.status.draft': 'Not started',
  'plans.status.awaitingPlan': 'Waiting for you to see the plan',
  'plans.status.running': 'Working',
  'plans.status.awaitingStep': 'Stopped, waiting on you',
  'plans.status.completed': 'Done',
  'plans.status.failed': 'Stopped without finishing',
  'plans.status.cancelled': 'Called off',

  'plans.step.pending': 'To do',
  'plans.step.running': 'Doing',
  'plans.step.awaiting': 'Waiting on you',
  'plans.step.completed': 'Done',
  'plans.step.failed': 'Did not work',
  'plans.step.skipped': 'Passed over',

  'plans.why.heading': 'Why she did it',
  'plans.why.loading': 'Reading her record…',

  /**
   * ★ "Is this the whole story?" must have an answer on the screen. An
   * explanation that quietly omitted part of what happened would be the exact
   * failure the audit package exists to prevent, and it would be invisible.
   */
  'plans.why.omitted': '{count} more recorded, not shown at this level of detail.',

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

  // ── The HUD ───────────────────────────────────────────────────────────────

  'vitals.title': 'System vitals',

  /**
   * ★ The scope line, and it is load-bearing rather than decorative.
   *
   * Chapter 29's metrics are FRIDAY-scoped. A row labelled MEMORY showing
   * 90 MB, on a panel the owner reads as his Mac's vitals, is the same
   * substitution ADR-0042 forbids — just in the other direction.
   */
  'vitals.scope': 'The FRIDAY runtime, not this Mac',
  'vitals.unavailable': 'UNAVAILABLE',

  /**
   * Said about the connection, never about FRIDAY.
   *
   * A reachable socket is not a working assistant. Whether she is *well* needs
   * Chapter 23's health aggregation, which nothing implements yet.
   */
  'link.online': 'LINK ONLINE',
  'link.offline': 'LINK OFFLINE',
  'link.connecting': 'CONNECTING',

  /** Short form for a panel heading. The sentence form is `events.stale`. */
  'link.stale': 'stale',
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
