import { composeExplanation, storedExplanationIsCurrent } from '@friday/chief-of-staff'
import type { FridayEvent, Plan } from '@friday/contracts'
import { uuidv7 } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Composing what FRIDAY did, from what she recorded.
 *
 * ★ The property under test is not "an explanation was produced" — it is that
 * **every claim traces to a recorded event**, which is what M5's done-when
 * asks for. An explanation nobody can check is a story, and Principle 7 asks
 * for the other thing.
 */

const CORRELATION = uuidv7()

function aPlan(overrides: Partial<Plan> = {}): Plan {
  return {
    id: uuidv7(),
    principalId: 'usr_owner',
    utterance: 'make sure my records are intact',
    intent: {
      kind: 'operations.self-check',
      confidence: 0.9,
      entities: {},
      ambiguities: [],
    },
    rationale: 'One check, against the whole log.',
    explanation: null,
    status: 'completed',
    correlationId: CORRELATION,
    createdAt: 1,
    updatedAt: 2,
    completedAt: 2,
    budgetTokens: null,
    budgetCents: null,
    budgetDeadlineMs: null,
    spentTokens: 0,
    spentCents: 0,
    ...overrides,
  }
}

let seq = 0

function anEvent(overrides: Partial<FridayEvent> = {}): FridayEvent {
  seq += 1

  return {
    id: uuidv7(),
    seq,
    type: 'guardian.decided',
    actor: { type: 'agent', id: 'agent:operations/self-check' },
    principalId: 'usr_owner',
    correlationId: CORRELATION,
    payload: { decision: 'allow', action: 'diagnostics.self-check.run' },
    payloadVersion: 1,
    sensitivity: 'internal',
    occurredAt: 1_700_000_000_000 + seq,
    recordedAt: 1_700_000_000_000 + seq,
    integrityHash: 'x'.repeat(64),
    ...overrides,
  } as FridayEvent
}

describe('composing a plan explanation', () => {
  it('★ traces every line back to an event', () => {
    // ★ The invariant M5's done-when rests on: "every claim traceable to an
    // event". There is no way to add a sentence without naming the recorded
    // fact behind it.
    const events = [anEvent(), anEvent({ type: 'approval.granted' })]

    const composed = composeExplanation({ plan: aPlan(), events })

    expect(composed.ok).toBe(true)
    if (!composed.ok) return

    expect(composed.value.detail.lines.length).toBeGreaterThan(0)
    for (const line of composed.value.detail.lines) {
      expect(line.eventId).toBeTruthy()
      expect(events.some((event) => event.id === line.eventId)).toBe(true)
    }
  })

  it('★ quotes the owner’s own words, not the parsed reading of them', () => {
    // ★ ADR-0045 §1 keeps both precisely so an explanation can say "you asked
    // me to X" using HIS sentence rather than a model's restatement.
    const plan = aPlan({
      utterance: 'sort out the thing with my logs',
      intent: {
        kind: 'operations.self-check',
        confidence: 0.4,
        entities: { guess: 'log integrity' },
        ambiguities: [],
      },
    })

    const composed = composeExplanation({ plan, events: [anEvent()] })

    expect(composed.ok && composed.value.asked).toBe('sort out the thing with my logs')
  })

  it('carries the rationale written at planning time', () => {
    const composed = composeExplanation({
      plan: aPlan({ rationale: 'One check, because you asked about all of them.' }),
      events: [anEvent()],
    })

    expect(composed.ok && composed.value.rationale).toBe(
      'One check, because you asked about all of them.',
    )
  })

  it('★ refuses when there is no record, rather than saying nothing happened', () => {
    // ★ "FRIDAY did nothing" and "FRIDAY cannot find what she did" are
    // different statements, and only the second is true here. A plan with no
    // events is an integrity problem, not a quiet result.
    const composed = composeExplanation({ plan: aPlan(), events: [] })

    expect(composed.ok).toBe(false)
    if (!composed.ok) {
      expect(composed.error.message).toContain('not the same as it having done nothing')
    }
  })

  it('★ never puts another plan’s events into this plan’s account', () => {
    // ★ `buildCausalChain` takes whatever it is handed and does NOT filter by
    // correlation id — verified, not assumed. So the filter in
    // `composeExplanation` is load-bearing: without it, another plan's
    // approval appears as a line in this plan's explanation, which is a claim
    // about work this plan did not do.
    //
    // The event type matters to this test. `approval.granted` is a headline,
    // so it WOULD appear; a type that is filtered out by depth anyway would
    // make this pass whether or not the filter existed.
    const mine = anEvent({ type: 'approval.granted' })
    const theirs = anEvent({ type: 'approval.granted', correlationId: uuidv7() })

    const composed = composeExplanation({ plan: aPlan(), events: [mine, theirs] })

    expect(composed.ok).toBe(true)
    if (!composed.ok) return

    const cited = composed.value.detail.lines.map((line) => line.eventId)

    expect(cited).toContain(mine.id)
    expect(cited).not.toContain(theirs.id)
  })

  it('reports what it left out rather than omitting it silently', () => {
    // "Is this the whole story?" has to have an answer.
    const composed = composeExplanation({
      plan: aPlan(),
      events: [anEvent()],
      depth: 'summary',
    })

    expect(composed.ok && composed.value.detail.omitted).toBeDefined()
  })
})

describe('the stored explanation is a cache', () => {
  it('★ says so when the stored text no longer matches the events', () => {
    // ★ ADR-0045 §2: if the stored text and the events disagree, the events
    // are right. This is how a reader finds out — and the answer is always to
    // recompute, never to trust the string.
    const events = [anEvent()]
    const stale = aPlan({ explanation: 'something that was never true' })

    const current = storedExplanationIsCurrent(stale, events)

    expect(current.ok && current.value).toBe(false)
  })

  it('agrees when the stored text is a fresh composition', () => {
    const events = [anEvent()]
    const composed = composeExplanation({ plan: aPlan(), events })

    expect(composed.ok).toBe(true)
    if (!composed.ok) return

    const stored = aPlan({ explanation: composed.value.headline })

    expect(storedExplanationIsCurrent(stored, events)).toEqual({ ok: true, value: true })
  })

  it('is recomputable — the same events always give the same answer', () => {
    // Deterministic, because an explanation that varied between readings would
    // not be checkable against anything.
    const events = [anEvent(), anEvent({ type: 'approval.granted' })]
    const plan = aPlan()

    const first = composeExplanation({ plan, events })
    const second = composeExplanation({ plan, events })

    expect(first.ok && second.ok && first.value.detail.lines.map((l) => l.text)).toEqual(
      second.ok ? second.value.detail.lines.map((l) => l.text) : undefined,
    )
  })
})
