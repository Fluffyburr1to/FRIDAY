import { createPolicySet, evaluatePolicies, type PolicySet } from '@friday/guardian'
import { describe, expect, it } from 'vitest'

function setOf(...rules: Record<string, unknown>[]): PolicySet {
  const result = createPolicySet(rules)
  if (!result.ok) throw new Error(`fixture policy set is invalid: ${result.error.message}`)
  return result.value
}

function rule(
  id: string,
  effect: string,
  riskClass: string,
  when: Record<string, unknown>,
  unless?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    id,
    description: `Fixture rule ${id}.`,
    effect,
    riskClass,
    when,
    ...(unless === undefined ? {} : { unless }),
  }
}

const REQUEST = {
  action: 'connector.gmail.write',
  resource: 'connector:gmail/labels/inbox',
  actorType: 'agent',
  actorId: 'agent:communications/label',
}

const NO_GRANT = { standingGrantApplies: false }
const GRANT = { standingGrantApplies: true }

describe('no match', () => {
  it('refuses an action no rule mentions', () => {
    // Fail closed. An action nobody classified is one the owner has never
    // considered, and the default for an unconsidered action cannot be "go".
    const set = setOf(rule('unrelated', 'allow', 'low', { action: 'memory.read' }))

    const evaluation = evaluatePolicies(set, REQUEST, NO_GRANT)

    expect(evaluation.effect).toBeNull()
    expect(evaluation.deciding).toBeNull()
    expect(evaluation.matched).toEqual([])
  })

  it('classifies an unmatched action as critical rather than harmless', () => {
    const set = setOf(rule('unrelated', 'allow', 'low', { action: 'memory.read' }))

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).riskClass).toBe('critical')
  })
})

describe('the strictest outcome wins', () => {
  it('lets deny beat approval and allow', () => {
    const set = setOf(
      rule('a-allow', 'allow', 'low', { action: 'connector.*.write' }),
      rule('b-approve', 'require_approval', 'medium', { action: 'connector.*.write' }),
      rule('c-deny', 'deny', 'high', { action: 'connector.*.write' }),
    )

    const evaluation = evaluatePolicies(set, REQUEST, NO_GRANT)

    expect(evaluation.effect).toBe('deny')
    expect(evaluation.deciding).toBe('c-deny')
  })

  it('lets approval beat allow', () => {
    const set = setOf(
      rule('a-allow', 'allow', 'low', { action: 'connector.*.write' }),
      rule('b-approve', 'require_approval', 'medium', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).effect).toBe('require_approval')
  })

  it('gives the same answer whatever order the rules arrive in', () => {
    // The property ADR-0025 exists for. Under first-match-wins, adding a file
    // that happened to sort earlier could disarm a restriction with nothing in
    // the diff to show it.
    const rules = [
      rule('z-allow', 'allow', 'low', { action: 'connector.*.write' }),
      rule('a-deny', 'deny', 'high', { action: 'connector.*.write' }),
      rule('m-approve', 'require_approval', 'medium', { action: 'connector.*.write' }),
    ]

    const forwards = evaluatePolicies(setOf(...rules), REQUEST, NO_GRANT)
    const backwards = evaluatePolicies(setOf(...[...rules].reverse()), REQUEST, NO_GRANT)

    expect(forwards).toEqual(backwards)
    expect(forwards.effect).toBe('deny')
  })
})

describe('the highest risk wins', () => {
  it('takes the maximum across matching rules', () => {
    const set = setOf(
      rule('a-low', 'require_approval', 'low', { action: 'connector.*.write' }),
      rule('b-high', 'require_approval', 'high', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).riskClass).toBe('high')
  })

  it('maximises risk independently of effect', () => {
    // An allow rule may still classify something as high risk, and that
    // classification is what a standing grant is later checked against.
    const set = setOf(
      rule('a-allow-high', 'allow', 'high', { action: 'connector.*.write' }),
      rule('b-approve-low', 'require_approval', 'low', { action: 'connector.*.write' }),
    )

    const evaluation = evaluatePolicies(set, REQUEST, NO_GRANT)

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.riskClass).toBe('high')
  })

  it('ranks self_modification above critical', () => {
    const set = setOf(
      rule('a-critical', 'require_approval', 'critical', { action: 'connector.*.write' }),
      rule('b-self', 'require_approval', 'self_modification', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).riskClass).toBe('self_modification')
  })
})

describe('the deciding rule', () => {
  it('is the strictest, then the riskiest, then the first by id', () => {
    const set = setOf(
      rule('a-deny-medium', 'deny', 'medium', { action: 'connector.*.write' }),
      rule('b-deny-critical', 'deny', 'critical', { action: 'connector.*.write' }),
      rule('c-approve', 'require_approval', 'self_modification', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).deciding).toBe('b-deny-critical')
  })

  it('breaks a tie on id, so the same explanation appears every run', () => {
    const set = setOf(
      rule('a-deny', 'deny', 'high', { action: 'connector.*.write' }),
      rule('b-deny', 'deny', 'high', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).deciding).toBe('a-deny')
  })

  it('is the only matching rule when there is only one', () => {
    const set = setOf(rule('only', 'allow', 'low', { action: 'connector.*.write' }))

    const evaluation = evaluatePolicies(set, REQUEST, NO_GRANT)

    expect(evaluation.deciding).toBe('only')
    expect(evaluation.effect).toBe('allow')
    expect(evaluation.riskClass).toBe('low')
  })
})

describe('every matched rule is reported', () => {
  it('names all of them, not only the deciding one', () => {
    // "Three rules applied; this one is why you are being asked." Recording
    // only the decisive rule would be true and would still mislead the owner
    // about how much of their policy set was engaged.
    const set = setOf(
      rule('a-allow', 'allow', 'low', { action: 'connector.*.write' }),
      rule('b-approve', 'require_approval', 'medium', { action: 'connector.*.write' }),
      rule('c-unrelated', 'deny', 'high', { action: 'memory.delete' }),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).matched).toEqual(['a-allow', 'b-approve'])
  })
})

describe('standing grant exemptions', () => {
  it('steps a rule aside when it asked to and a grant applies', () => {
    const set = setOf(
      rule(
        'a-approve',
        'require_approval',
        'medium',
        { action: 'connector.*.write' },
        {
          standingGrant: true,
        },
      ),
      rule('b-allow', 'allow', 'low', { action: 'connector.*.write' }),
    )

    const evaluation = evaluatePolicies(set, REQUEST, GRANT)

    expect(evaluation.effect).toBe('allow')
    expect(evaluation.exempted).toEqual(['a-approve'])
    expect(evaluation.matched).toContain('a-approve')
  })

  it('leaves a rule that did not ask for the exemption in force', () => {
    // Critical rules carry no `unless`, which is how "no standing grant may
    // fully satisfy a critical action" is expressed in policy rather than in
    // a special case somewhere in code.
    const set = setOf(
      rule('a-critical', 'require_approval', 'critical', { action: 'connector.*.write' }),
    )

    const evaluation = evaluatePolicies(set, REQUEST, GRANT)

    expect(evaluation.effect).toBe('require_approval')
    expect(evaluation.exempted).toEqual([])
  })

  it('keeps a rule in force when no grant applies', () => {
    const set = setOf(
      rule(
        'a-approve',
        'require_approval',
        'medium',
        { action: 'connector.*.write' },
        {
          standingGrant: true,
        },
      ),
    )

    expect(evaluatePolicies(set, REQUEST, NO_GRANT).effect).toBe('require_approval')
  })

  it('permits the action when the exempted rule was the only one asking', () => {
    // The case that makes softening necessary rather than removing. If the
    // rule were dropped, this would fall through to "no rule matched" and be
    // refused — the owner would have granted permission and thereby made the
    // action less possible.
    const set = setOf(
      rule(
        'a-approve',
        'require_approval',
        'medium',
        { action: 'connector.*.write' },
        {
          standingGrant: true,
        },
      ),
    )

    const evaluation = evaluatePolicies(set, REQUEST, GRANT)

    expect(evaluation.effect).toBe('allow')
    expect(evaluation.exempted).toEqual(['a-approve'])
  })

  it('keeps the risk class of a rule a grant exempted', () => {
    // A pre-approved action has not become a safe one, and the class is what
    // the grant's own ceiling is checked against.
    const set = setOf(
      rule(
        'a-approve',
        'require_approval',
        'high',
        { action: 'connector.*.write' },
        {
          standingGrant: true,
        },
      ),
    )

    expect(evaluatePolicies(set, REQUEST, GRANT).riskClass).toBe('high')
  })

  it('still refuses when a deny rule applies, grant or not', () => {
    const set = setOf(
      rule(
        'a-approve',
        'require_approval',
        'medium',
        { action: 'connector.*.write' },
        {
          standingGrant: true,
        },
      ),
      rule('b-deny', 'deny', 'critical', { action: 'connector.*.write' }),
    )

    expect(evaluatePolicies(set, REQUEST, GRANT).effect).toBe('deny')
  })
})
