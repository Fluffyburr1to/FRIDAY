import {
  createEventRegistry,
  EventTypeSchema,
  GUARDIAN_EVENT_TYPES,
  registerCoreEventTypes,
  registerGuardianEventTypes,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('the Guardian event types', () => {
  it('registers alongside the core types without collision', () => {
    const registry = registerGuardianEventTypes(registerCoreEventTypes(createEventRegistry()))

    for (const definition of GUARDIAN_EVENT_TYPES) {
      expect(registry.has(definition.type)).toBe(true)
    }
  })

  it('names every type in a form the event log accepts', () => {
    // `approval.auto_granted` is the one that matters here: Chapter 19 names
    // it, and the event-type rule was widened to accept underscores rather
    // than renaming the Bible's own event.
    for (const definition of GUARDIAN_EVENT_TYPES) {
      expect(EventTypeSchema.safeParse(definition.type).success).toBe(true)
    }

    expect(GUARDIAN_EVENT_TYPES.map((d) => d.type)).toContain('approval.auto_granted')
  })

  it('describes each type in language the owner could read', () => {
    for (const definition of GUARDIAN_EVENT_TYPES) {
      expect(definition.description.length).toBeGreaterThan(0)
      expect(definition.description).not.toMatch(/schema|payload|struct/i)
    }
  })

  it('classifies anything naming a concrete resource as private', () => {
    // A resource is a fact about the owner's life. Article IV: nothing above
    // internal leaves the machine, and private is encrypted at rest.
    const namesAResource = GUARDIAN_EVENT_TYPES.filter(
      (definition) => definition.type !== 'capability.revoked',
    )

    for (const definition of namesAResource) {
      expect(definition.maxSensitivity).toBe('private')
    }
  })

  it('validates a decision payload and rejects an incomplete one', () => {
    const registry = registerGuardianEventTypes(createEventRegistry())

    const valid = registry.validate({
      type: 'guardian.decided',
      payloadVersion: 1,
      payload: {
        decisionId: uuidv7(),
        decision: 'deny',
        reason: 'no_policy_matched',
        riskClass: 'high',
        action: 'connector.gmail.message.send',
        resource: 'connector:gmail/messages/draft-1',
        actor: { type: 'agent', id: 'agent:communications/draft-email' },
        matchedPolicies: [],
        approvalId: null,
        standingGrantId: null,
        summary: 'No rule covers sending mail, so it was refused.',
      },
    })

    expect(valid.ok).toBe(true)

    const missingSummary = registry.validate({
      type: 'guardian.decided',
      payloadVersion: 1,
      payload: { decisionId: uuidv7(), decision: 'deny' },
    })

    expect(missingSummary.ok).toBe(false)
  })

  it('validates an auto-granted payload carrying the owner’s own words', () => {
    const registry = registerGuardianEventTypes(createEventRegistry())

    const result = registry.validate({
      type: 'approval.auto_granted',
      payloadVersion: 1,
      payload: {
        decisionId: uuidv7(),
        grantId: uuidv7(),
        action: 'calendar.event.create',
        resource: 'calendar:personal/events/01j8',
        riskClass: 'medium',
        grantReason: 'You said calendar events on your personal calendar are fine.',
        grantUses: 4,
        grantMaxUses: null,
      },
    })

    expect(result.ok).toBe(true)
  })
})
