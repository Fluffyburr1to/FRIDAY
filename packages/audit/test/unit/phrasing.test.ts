import { PHRASED_TYPES, phrasingFor, SIGNIFICANCE, significanceOf } from '@friday/audit'
import type { FridayEvent } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Every phrasing, exercised with and without the payload it reads.
 *
 * The second half is the point. A phraser that assumes a field is present will
 * produce `undefined` in a sentence when it is not, and the first person to
 * see that is the owner. Falling back to nothing is correct — the explanation
 * counts it as undescribable rather than printing a broken line.
 */

function event(type: string, payload: Record<string, unknown>): FridayEvent {
  return {
    seq: 1,
    id: '01930000-0000-7000-8000-000000000001',
    type,
    occurredAt: 1_700_000_000_000,
    recordedAt: 1_700_000_000_000,
    actor: { type: 'agent', id: 'agent:communications/send' },
    principalId: 'usr_tyler',
    payload,
    payloadVersion: 1,
    sensitivity: 'internal',
    integrityHash: 'a'.repeat(64),
  }
}

/** A payload rich enough for any phraser to read what it needs. */
const FULL = {
  summary: 'Sending a message needs your approval.',
  title: 'Send a follow-up email to Sarah Chen',
  respondedVia: 'desktop',
  reason: 'Wrong Sarah.',
  grantReason: 'Labelling my own inbox is fine.',
  action: 'connector.gmail.message.send',
  uses: 4,

  // Plan transitions.
  stepCount: 3,
  stepsCompleted: 2,
  stepsSkipped: 1,
  approvalReason: 'high_risk_step',
  from: 'awaiting_plan_approval',
  to: 'running',
  because: 'the connector never answered',
  description: 'Send a follow-up email to Sarah Chen',
  attempt: 2,
}

describe('every phrasing', () => {
  it('produces a sentence when the payload has what it reads', () => {
    for (const type of PHRASED_TYPES) {
      const phrased = phrasingFor(type)?.phrase(event(type, FULL))

      expect(phrased, `${type} produced nothing from a full payload`).toBeDefined()
      expect(phrased).not.toContain('undefined')
      expect(phrased?.length ?? 0).toBeGreaterThan(10)
    }
  })

  it('produces nothing rather than a broken sentence when the payload is empty', () => {
    // ★ `undefined` appearing in a sentence in front of the owner is the
    // failure being prevented. Returning nothing lets the explanation count
    // the event as undescribable, which is honest.
    for (const type of PHRASED_TYPES) {
      const phrased = phrasingFor(type)?.phrase(event(type, {}))

      expect(phrased ?? '', `${type} rendered a placeholder`).not.toContain('undefined')
      expect(phrased ?? '', `${type} rendered an empty fragment`).not.toMatch(/:\s*$/)
    }
  })

  it('ignores a payload field that is not the type it expects', () => {
    // Payloads are validated on the way in, but this package reads events that
    // may have been written years ago under an older schema version. The wrong
    // value here is an object, which is wrong for every phraser — some read a
    // string and one reads a number, so a single wrong scalar would not test
    // them all.
    const wrong = Object.fromEntries(Object.keys(FULL).map((key) => [key, { nope: true }]))

    for (const type of PHRASED_TYPES) {
      const phrased = phrasingFor(type)?.phrase(event(type, wrong))

      expect(phrased ?? '', `${type} trusted a payload of the wrong shape`).not.toContain('object')
      expect(phrased ?? '', `${type} trusted a payload of the wrong shape`).not.toContain('nope')
    }
  })

  it('declares a significance the explanation layer understands', () => {
    for (const type of PHRASED_TYPES) {
      expect(SIGNIFICANCE).toContain(significanceOf(type))
    }
  })

  it('has no phrasing for a type nobody wrote one for', () => {
    expect(phrasingFor('nobody.wrote.this')).toBeUndefined()
  })
})

describe('how an answer arrived', () => {
  it('is named when it was recorded, and left out when it was not', () => {
    const withSurface = phrasingFor('approval.granted')?.phrase(
      event('approval.granted', { respondedVia: 'mobile' }),
    )
    const without = phrasingFor('approval.granted')?.phrase(event('approval.granted', {}))

    expect(withSurface).toBe('You approved it on the mobile.')
    expect(without).toBe('You approved it.')
  })
})

describe('a lapsed standing permission', () => {
  it('reports how often it was used, which is what a renewal decision needs', () => {
    const once = phrasingFor('grant.expired')?.phrase(event('grant.expired', { uses: 1 }))
    const many = phrasingFor('grant.expired')?.phrase(event('grant.expired', { uses: 23 }))

    expect(once).toContain('1 time.')
    expect(many).toContain('23 times.')
  })
})
