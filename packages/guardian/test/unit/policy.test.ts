import { type Policy, PolicySchema, policyMatches } from '@friday/guardian'
import { describe, expect, it } from 'vitest'

function rule(overrides: Record<string, unknown> = {}): unknown {
  return {
    id: 'connector-writes-need-approval',
    description: 'Changing something in a connected service needs your approval.',
    effect: 'require_approval',
    riskClass: 'medium',
    when: { action: 'connector.*.write' },
    ...overrides,
  }
}

const AGENT = {
  action: 'connector.gmail.write',
  resource: 'connector:gmail/labels/inbox',
  actorType: 'agent',
  actorId: 'agent:communications/label',
}

describe('the shape of a rule', () => {
  it('accepts a well-formed rule', () => {
    expect(PolicySchema.safeParse(rule()).success).toBe(true)
  })

  it('requires a description an owner could read', () => {
    // A rule that cannot be explained cannot be applied. Its id is quoted in
    // every explanation it decides, and an id alone tells the owner nothing.
    expect(PolicySchema.safeParse(rule({ description: '' })).success).toBe(false)
  })

  it('requires a kebab-case id', () => {
    for (const id of ['Connector_Writes', 'connector writes', '-leading', 'trailing-', '']) {
      expect(PolicySchema.safeParse(rule({ id })).success).toBe(false)
    }
  })

  it('requires a risk class, because risk comes only from a rule', () => {
    const withoutRisk = rule() as Record<string, unknown>
    withoutRisk.riskClass = undefined

    expect(PolicySchema.safeParse(withoutRisk).success).toBe(false)
  })

  it('requires the rule to name an action or a resource', () => {
    expect(PolicySchema.safeParse(rule({ when: {} })).success).toBe(false)
    expect(PolicySchema.safeParse(rule({ when: { actorType: 'agent' } })).success).toBe(false)
    expect(PolicySchema.safeParse(rule({ when: { resource: 'memory:**' } })).success).toBe(true)
  })

  it('refuses a permissive rule that matches everything', () => {
    // The single edit that would switch the system off.
    for (const effect of ['allow', 'require_approval']) {
      const parsed = PolicySchema.safeParse(rule({ effect, when: { action: '*', resource: '*' } }))

      expect(parsed.success).toBe(false)
    }
  })

  it('allows a deny rule to match everything', () => {
    const parsed = PolicySchema.safeParse(
      rule({ effect: 'deny', when: { action: '*', resource: '*' } }),
    )

    expect(parsed.success).toBe(true)
  })

  it('allows a wildcard rule that is narrowed by actor', () => {
    // "Anything you do yourself" is a legitimate rule. Article III governs what
    // FRIDAY does unattended, not what the owner does at the keyboard.
    expect(
      PolicySchema.safeParse(rule({ effect: 'allow', when: { action: '*', actorType: 'user' } }))
        .success,
    ).toBe(true)

    expect(
      PolicySchema.safeParse(
        rule({ effect: 'allow', when: { action: '*', actorId: 'agent:ops/backup' } }),
      ).success,
    ).toBe(true)
  })

  it('refuses an unknown effect', () => {
    expect(PolicySchema.safeParse(rule({ effect: 'maybe' })).success).toBe(false)
  })
})

describe('matching a rule to a request', () => {
  const parse = (input: unknown): Policy => {
    const parsed = PolicySchema.safeParse(input)
    if (!parsed.success) throw new Error('fixture rule is invalid')
    return parsed.data
  }

  it('matches on the action alone when that is all the rule names', () => {
    expect(policyMatches(parse(rule()), AGENT)).toBe(true)
    expect(policyMatches(parse(rule()), { ...AGENT, action: 'connector.gmail.read' })).toBe(false)
  })

  it('matches on the resource when the rule names one', () => {
    const scoped = parse(rule({ when: { resource: 'memory:contacts/**' } }))

    expect(policyMatches(scoped, { ...AGENT, resource: 'memory:contacts/work/sarah' })).toBe(true)
    expect(policyMatches(scoped, { ...AGENT, resource: 'memory:notes/idea' })).toBe(false)
  })

  it('matches on actor type', () => {
    const agentsOnly = parse(rule({ when: { action: 'connector.*.write', actorType: 'agent' } }))

    expect(policyMatches(agentsOnly, AGENT)).toBe(true)
    expect(policyMatches(agentsOnly, { ...AGENT, actorType: 'user' })).toBe(false)
  })

  it('matches on an exact actor id', () => {
    const one = parse(
      rule({ when: { action: 'connector.*.write', actorId: 'agent:communications/label' } }),
    )

    expect(policyMatches(one, AGENT)).toBe(true)
    expect(policyMatches(one, { ...AGENT, actorId: 'agent:communications/send' })).toBe(false)
  })

  it('treats an omitted condition as no constraint at all', () => {
    // The rule names an action and says nothing about who is asking, so it
    // applies to everyone. Reading silence as "only agents" is the mistake
    // that makes a policy set narrower than the owner believes.
    const anyActor = parse(rule())

    expect(policyMatches(anyActor, { ...AGENT, actorType: 'schedule' })).toBe(true)
    expect(policyMatches(anyActor, { ...AGENT, actorType: 'user' })).toBe(true)
  })

  it('requires every stated condition to hold', () => {
    const both = parse(
      rule({
        when: { action: 'connector.*.write', resource: 'connector:gmail/**', actorType: 'agent' },
      }),
    )

    expect(policyMatches(both, AGENT)).toBe(true)
    expect(policyMatches(both, { ...AGENT, resource: 'connector:slack/channels/general' })).toBe(
      false,
    )
  })
})
