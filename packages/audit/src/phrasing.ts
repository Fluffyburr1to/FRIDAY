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

  'plan.created': {
    significance: 'headline',
    phrase: (event) => {
      const steps = event.payload.stepCount
      if (typeof steps !== 'number') return undefined

      const made = `FRIDAY worked out how to do this, in ${steps} step${steps === 1 ? '' : 's'}.`
      const reason = event.payload.approvalReason

      // The plan stopped before starting, and why is on this same event.
      if (reason === 'over_cost_threshold') {
        return `${made} This would cost enough that she showed you the plan first.`
      }

      if (reason === 'high_risk_step') {
        return `${made} Part of it is consequential, so she showed you the plan first.`
      }

      return made
    },
  },

  'plan.suspended': {
    significance: 'headline',
    phrase: () => 'FRIDAY stopped partway through, waiting on you.',
  },

  // ★ Says what was approved, and — just as deliberately — what was not. The
  // owner reading this back should not come away thinking they signed off on
  // the individual actions, because they did not: every step still asked.
  //
  // Where the plan came FROM is what distinguishes the two cases, and both are
  // this one event because both are the same move: the plan is going again.
  'plan.resumed': {
    significance: 'headline',
    phrase: (event) =>
      event.payload.from === 'awaiting_plan_approval'
        ? 'You approved the shape of the plan. Each step still asked on its own.'
        : 'You answered, so the plan carried on.',
  },

  'plan.completed': {
    significance: 'headline',
    phrase: (event) => {
      const skipped = event.payload.stepsSkipped

      return typeof skipped === 'number' && skipped > 0
        ? `The plan finished, with ${skipped} step${skipped === 1 ? '' : 's'} passed over.`
        : 'The plan finished.'
    },
  },

  'plan.failed': {
    significance: 'headline',
    phrase: (event) => {
      const because = text(event, 'because')
      return because === undefined ? undefined : `The plan stopped: ${because}`
    },
  },

  'plan.cancelled': {
    significance: 'headline',
    phrase: (event) => {
      const because = text(event, 'because')
      return because === undefined ? undefined : `The plan was called off: ${because}`
    },
  },

  'plan.step.started': {
    significance: 'spine',
    phrase: (event) => describeStep(event, (what) => `FRIDAY started: ${what}`),
  },

  'plan.step.completed': {
    significance: 'spine',
    phrase: (event) => describeStep(event, (what) => `Done: ${what}`),
  },

  'plan.step.suspended': {
    significance: 'headline',
    phrase: (event) => describeStep(event, (what) => `FRIDAY stopped to ask you about: ${what}`),
  },

  'plan.step.resumed': {
    significance: 'spine',
    phrase: (event) =>
      describeStep(
        event,
        (what) => `You answered, so FRIDAY tried again — and asked again: ${what}`,
      ),
  },

  'plan.step.retried': {
    significance: 'detail',
    phrase: (event) => {
      const attempt = event.payload.attempt
      if (typeof attempt !== 'number') return undefined

      return describeStep(event, (what) => `Trying again (attempt ${attempt}): ${what}`)
    },
  },

  'plan.step.failed': {
    significance: 'spine',
    phrase: (event) => {
      const because = text(event, 'because')
      return because === undefined ? undefined : `A step did not work: ${because}`
    },
  },

  'plan.step.skipped': {
    significance: 'spine',
    phrase: (event) =>
      describeStep(event, (what) => `Passed over, and the plan carried on: ${what}`),
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

/**
 * Describes a step by the description recorded WITH IT.
 *
 * ★ Not by looking the step up somewhere. The description on the event is the
 * one that was true when the step ran; a plan edited afterwards would make a
 * lookup describe work that never happened in those words.
 */
function describeStep(event: FridayEvent, sentence: (what: string) => string): string | undefined {
  const what = text(event, 'description')
  return what === undefined ? undefined : sentence(what)
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
