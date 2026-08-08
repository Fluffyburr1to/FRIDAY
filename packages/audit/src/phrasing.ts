import type { FridayEvent } from '@friday/contracts'

/**
 * Turning a recorded event into a sentence.
 *
 * ★ The rule this file exists to keep: **every sentence is derived from fields
 * that were recorded at the time.** Nothing here infers, summarises across
 * events, or asks a model what it was thinking. A phraser gets one event and
 * may read only that event.
 *
 * A model may later be used to make an explanation read more naturally, but
 * only over these sentences — and the generator validates that no unsupported
 * one survives. That is the difference between an explanation and a story.
 *
 * Reference: packages/audit/README.md · docs/01-bible/10-event-bus.md
 */

/**
 * How much an event matters to someone asking what happened.
 *
 * Drives which events appear at which depth. Declared per type rather than
 * inferred from the name, so that adding a chatty new event type cannot
 * quietly flood the standard explanation.
 */
export const SIGNIFICANCE = ['headline', 'spine', 'detail'] as const

export type Significance = (typeof SIGNIFICANCE)[number]

/** How one event type is described, and how much it matters. */
export interface Phrasing {
  readonly significance: Significance

  /**
   * One sentence, for the owner.
   *
   * @param event - The event being described.
   * @returns The sentence, or undefined to fall back to the type's registered
   *   description — which is what happens for any type nobody has phrased.
   */
  phrase(event: FridayEvent): string | undefined
}

/** Reads a string from a payload without trusting it to be one. */
function text(event: FridayEvent, key: string): string | undefined {
  const value = event.payload[key]
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

const PHRASINGS: Readonly<Record<string, Phrasing>> = {
  'guardian.decided': {
    significance: 'headline',

    // The Guardian already composed a sentence at decision time, from the
    // rules the owner wrote. Re-describing it here would be a second account
    // of the same thing, and the two would drift.
    phrase: (event) => text(event, 'summary'),
  },

  'approval.requested': {
    significance: 'headline',
    phrase: (event) => {
      const title = text(event, 'title')
      return title === undefined ? undefined : `FRIDAY asked you: ${title}`
    },
  },

  'approval.granted': {
    significance: 'headline',
    phrase: (event) => `You approved it${viaSuffix(event)}.`,
  },

  'approval.declined': {
    significance: 'headline',
    phrase: (event) => {
      const reason = text(event, 'reason')

      // The owner's own words are quoted as their own sentence rather than
      // spliced into this one — they already end how they end, and gluing a
      // clause onto them produces the stray punctuation nobody notices until
      // it is in front of the owner.
      const said = reason === undefined ? '' : ` Your reason: ${reason}`
      return `You declined it${viaSuffix(event)}.${said}`
    },
  },

  'approval.expired': {
    significance: 'headline',
    phrase: () => 'Nobody answered in time, so FRIDAY did not act.',
  },

  'approval.auto_granted': {
    significance: 'headline',
    phrase: (event) => {
      const reason = text(event, 'grantReason')
      return reason === undefined
        ? undefined
        : `You allowed this in advance, so FRIDAY did not ask: ${reason}`
    },
  },

  'capability.issued': {
    significance: 'spine',
    phrase: (event) => {
      const action = text(event, 'action')
      return action === undefined
        ? undefined
        : `FRIDAY issued a permission slip for one thing: ${action}.`
    },
  },

  'capability.used': {
    significance: 'detail',
    phrase: (event) => {
      const action = text(event, 'action')
      return action === undefined ? undefined : `A permission slip was spent on ${action}.`
    },
  },

  'capability.revoked': {
    significance: 'spine',
    phrase: (event) => {
      const reason = text(event, 'reason')
      return reason === undefined ? undefined : `A permission was withdrawn: ${reason}`
    },
  },

  'grant.created': {
    significance: 'headline',
    phrase: (event) => {
      const reason = text(event, 'reason')
      return reason === undefined
        ? undefined
        : `You gave FRIDAY standing permission, with an end date: ${reason}`
    },
  },

  'grant.revoked': {
    significance: 'headline',
    phrase: () => 'You withdrew a standing permission.',
  },

  'grant.expired': {
    significance: 'spine',
    phrase: (event) => {
      const uses = event.payload.uses
      return typeof uses === 'number'
        ? `A standing permission reached its end date, after being used ${uses} time${uses === 1 ? '' : 's'}.`
        : undefined
    },
  },

  'system.started': { significance: 'detail', phrase: () => 'FRIDAY started up.' },
  'system.stopped': { significance: 'detail', phrase: () => 'FRIDAY shut down.' },

  'system.degraded': {
    significance: 'spine',
    phrase: (event) => {
      const reason = text(event, 'reason')
      return reason === undefined ? undefined : `Part of FRIDAY stopped working: ${reason}`
    },
  },
}

/** How an approval was answered, when it was. */
function viaSuffix(event: FridayEvent): string {
  const via = text(event, 'respondedVia')
  return via === undefined ? '' : ` on the ${via}`
}

/**
 * The phrasing for an event type, if there is one.
 *
 * @param type - The event type.
 * @returns Its phrasing, or undefined when nobody has written one.
 */
export function phrasingFor(type: string): Phrasing | undefined {
  return PHRASINGS[type]
}

/**
 * How much an event type matters.
 *
 * Unphrased types are `detail`: an event nobody has described cannot be
 * important enough to lead with, and treating it as such would put a raw type
 * name in front of the owner.
 *
 * @param type - The event type.
 * @returns Its significance.
 */
export function significanceOf(type: string): Significance {
  return PHRASINGS[type]?.significance ?? 'detail'
}

/** Every event type this package can describe. For the coverage test. */
export const PHRASED_TYPES: readonly string[] = Object.keys(PHRASINGS)
