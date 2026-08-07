import {
  ActorSchema,
  EventPatternSchema,
  EventSchema,
  EventTypeSchema,
  matchesPattern,
  NewEventSchema,
  SubjectSchema,
  SYSTEM_ACTOR,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const HASH = 'a'.repeat(64)

function aNewEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'test.event.emitted',
    actor: SYSTEM_ACTOR,
    principalId: 'usr_tyler',
    payload: { note: 'hello' },
    sensitivity: 'internal',
    ...overrides,
  }
}

describe('EventTypeSchema', () => {
  it('accepts two- and three-segment names', () => {
    // Chapter 10 says "three segments, always" and then uses `plan.created` as
    // an example. Both are accepted; see the note on EVENT_TYPE_PATTERN.
    for (const type of ['plan.created', 'plan.step.completed', 'connector.call.failed']) {
      expect(EventTypeSchema.safeParse(type).success).toBe(true)
    }
  })

  it('rejects single-segment, four-segment, and non-lowercase names', () => {
    for (const type of ['created', 'a.b.c.d', 'Plan.created', 'plan..created', 'plan.']) {
      expect(EventTypeSchema.safeParse(type).success).toBe(false)
    }
  })

  it('rejects a command-shaped name in the only way a regex can', () => {
    // Past tense is a review rule, not a machine rule — English is too
    // irregular. What IS caught is the camelCase a command name arrives in.
    expect(EventTypeSchema.safeParse('sendEmail').success).toBe(false)
  })
})

describe('matchesPattern', () => {
  it('matches everything with a bare star', () => {
    expect(matchesPattern('*', 'plan.step.completed')).toBe(true)
  })

  it('matches an exact type', () => {
    expect(matchesPattern('plan.created', 'plan.created')).toBe(true)
    expect(matchesPattern('plan.created', 'plan.completed')).toBe(false)
  })

  it('matches a trailing wildcard within the same segment count', () => {
    expect(matchesPattern('approval.*', 'approval.granted')).toBe(true)
    expect(matchesPattern('plan.step.*', 'plan.step.completed')).toBe(true)
  })

  it('does not let a wildcard cross a segment boundary', () => {
    // `approval.*` must not match `approval.request.expired`. A pattern that
    // silently widened would wake subscribers for events they never asked for.
    expect(matchesPattern('approval.*', 'approval.request.expired')).toBe(false)
    expect(matchesPattern('plan.step.*', 'plan.created')).toBe(false)
  })

  it('accepts a wildcard in a leading segment', () => {
    expect(matchesPattern('*.step.completed', 'plan.step.completed')).toBe(true)
  })

  it('agrees with the schema about which patterns are well-formed', () => {
    expect(EventPatternSchema.safeParse('approval.*').success).toBe(true)
    expect(EventPatternSchema.safeParse('*').success).toBe(true)
    expect(EventPatternSchema.safeParse('a.b.c.d').success).toBe(false)
  })
})

describe('NewEventSchema', () => {
  it('accepts the minimum a publisher must provide', () => {
    expect(NewEventSchema.safeParse(aNewEvent()).success).toBe(true)
  })

  it('requires a sensitivity', () => {
    // Never optional: this one field drives encryption, redaction, and cloud
    // eligibility. A missing classification is a value stored in the clear.
    const { sensitivity: _dropped, ...withoutSensitivity } = aNewEvent()

    expect(NewEventSchema.safeParse(withoutSensitivity).success).toBe(false)
  })

  it('requires a principal', () => {
    const { principalId: _dropped, ...withoutPrincipal } = aNewEvent()

    expect(NewEventSchema.safeParse(withoutPrincipal).success).toBe(false)
  })

  it('rejects a causation ID that is not a UUID', () => {
    expect(NewEventSchema.safeParse(aNewEvent({ causationId: 'previous' })).success).toBe(false)
  })

  it('does not require a payload version', () => {
    const parsed = NewEventSchema.safeParse(aNewEvent())

    expect(parsed.success && parsed.data.payloadVersion).toBeUndefined()
  })
})

describe('EventSchema', () => {
  function aRecordedEvent(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      ...aNewEvent(),
      seq: 1,
      id: uuidv7(),
      occurredAt: 1_754_467_200_000,
      recordedAt: 1_754_467_200_001,
      payloadVersion: 1,
      integrityHash: HASH,
      ...overrides,
    }
  }

  it('accepts a fully recorded event', () => {
    expect(EventSchema.safeParse(aRecordedEvent()).success).toBe(true)
  })

  it('requires a positive sequence number', () => {
    // Sequence numbers start at 1 and are the ordering authority. A zero or a
    // negative would mean an event that sorts before the genesis of the log.
    expect(EventSchema.safeParse(aRecordedEvent({ seq: 0 })).success).toBe(false)
    expect(EventSchema.safeParse(aRecordedEvent({ seq: 1.5 })).success).toBe(false)
  })

  it('requires a lowercase 64-character hex integrity hash', () => {
    expect(EventSchema.safeParse(aRecordedEvent({ integrityHash: 'A'.repeat(64) })).success).toBe(
      false,
    )
    expect(EventSchema.safeParse(aRecordedEvent({ integrityHash: 'a'.repeat(63) })).success).toBe(
      false,
    )
  })

  it('requires both timestamps', () => {
    expect(EventSchema.safeParse(aRecordedEvent({ recordedAt: undefined })).success).toBe(false)
    expect(EventSchema.safeParse(aRecordedEvent({ occurredAt: undefined })).success).toBe(false)
  })
})

describe('actors and subjects', () => {
  it('accepts the four actor types and rejects others', () => {
    for (const type of ['user', 'agent', 'system', 'schedule']) {
      expect(ActorSchema.safeParse({ type, id: 'x' }).success).toBe(true)
    }
    expect(ActorSchema.safeParse({ type: 'connector', id: 'x' }).success).toBe(false)
  })

  it('describes the system actor completely', () => {
    expect(ActorSchema.safeParse(SYSTEM_ACTOR).success).toBe(true)
  })

  it('requires both halves of a subject', () => {
    expect(SubjectSchema.safeParse({ type: 'plan', id: 'p1' }).success).toBe(true)
    expect(SubjectSchema.safeParse({ type: 'plan' }).success).toBe(false)
  })
})
