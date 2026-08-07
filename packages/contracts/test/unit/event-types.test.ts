import {
  ChainVerifiedPayloadSchema,
  CORE_EVENT_TYPES,
  createEventRegistry,
  EventTypeSchema,
  registerCoreEventTypes,
  SystemDegradedPayloadSchema,
  SystemStartedPayloadSchema,
  SystemStoppedPayloadSchema,
  TestEventPayloadSchema,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('the core event types', () => {
  it('all register without conflict', () => {
    const registry = registerCoreEventTypes(createEventRegistry())

    expect(registry.list()).toHaveLength(CORE_EVENT_TYPES.length)
  })

  it('all have well-formed names', () => {
    for (const definition of CORE_EVENT_TYPES) {
      expect(EventTypeSchema.safeParse(definition.type).success).toBe(true)
    }
  })

  it('all carry a plain-language description for the audit explorer', () => {
    for (const definition of CORE_EVENT_TYPES) {
      expect(definition.description.length).toBeGreaterThan(0)
    }
  })

  it('none claim to carry personal content at Milestone 1', () => {
    // She can record, and she cannot act. Nothing she emits about herself
    // should be above `internal` yet, and a change to that is a decision.
    for (const definition of CORE_EVENT_TYPES) {
      expect(['public', 'internal']).toContain(definition.maxSensitivity)
    }
  })

  it('validates a test event through the registry', () => {
    const registry = registerCoreEventTypes(createEventRegistry())

    const result = registry.validate({
      type: 'test.event.emitted',
      payloadVersion: 1,
      payload: { note: 'from the other terminal' },
    })

    expect(result.ok).toBe(true)
  })
})

describe('core event payload schemas', () => {
  it('validates system.started', () => {
    expect(
      SystemStartedPayloadSchema.safeParse({ version: '0.0.0', nodeVersion: 'v24.19.0', pid: 42 })
        .success,
    ).toBe(true)
    expect(SystemStartedPayloadSchema.safeParse({ version: '0.0.0' }).success).toBe(false)
  })

  it('validates system.stopped', () => {
    expect(SystemStoppedPayloadSchema.safeParse({ reason: 'signal', uptimeMs: 10 }).success).toBe(
      true,
    )
    expect(SystemStoppedPayloadSchema.safeParse({ reason: 'bored', uptimeMs: 10 }).success).toBe(
      false,
    )
  })

  it('validates system.degraded', () => {
    expect(
      SystemDegradedPayloadSchema.safeParse({
        component: 'kernel.async-lane',
        reason: 'A subscriber failed eight times and was suspended.',
        recoverable: true,
      }).success,
    ).toBe(true)
  })

  it('validates diagnostics.chain.verified', () => {
    expect(
      ChainVerifiedPayloadSchema.safeParse({
        fromSeq: 1,
        toSeq: 100,
        eventsChecked: 100,
        intact: true,
        brokenAtSeq: null,
      }).success,
    ).toBe(true)
  })

  it('validates test.event.emitted', () => {
    expect(TestEventPayloadSchema.safeParse({ note: '' }).success).toBe(true)
    expect(TestEventPayloadSchema.safeParse({}).success).toBe(false)
  })
})
