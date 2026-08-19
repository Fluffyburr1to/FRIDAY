import { createCapabilityRegistry, routePlan } from '@friday/chief-of-staff'
import type { DepartmentCapability, DepartmentManifest } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Deterministic routing.
 *
 * ★ Two properties are being defended, and they pull in different directions
 * from the usual instinct to be helpful:
 *
 *   1. **No guessing.** An unknown action is refused, not matched to something
 *      similar. A plan naming a capability that does not exist is usually a
 *      hallucinated one, and "she tried something close" is not a defensible
 *      answer to what FRIDAY did.
 *   2. **No authority.** Routing says *who does this*, never *may this be
 *      done*. Nothing here reads `riskClass`.
 */

function aCapability(overrides: Partial<DepartmentCapability> = {}): DepartmentCapability {
  return {
    id: 'run-self-check',
    action: 'diagnostics.self-check.run',
    description: 'Check that FRIDAY is internally consistent.',
    input: 'SelfCheckRequest',
    output: 'SelfCheckResult',
    riskClass: 'low',
    irreversible: false,
    sensitivity: 'internal',
    requires: ['diagnostics.run'],
    ...overrides,
  }
}

function aDepartment(overrides: Partial<DepartmentManifest> = {}): DepartmentManifest {
  return {
    id: 'operations',
    name: 'Operations',
    version: '1.0.0',
    description: 'Keeps FRIDAY healthy.',
    capabilities: [aCapability()],
    subscribes: [],
    publishes: ['diagnostics.self-check.completed'],
    degradedMode: {
      whenConnectorUnavailable: 'unaffected',
      description: 'Touches no external service.',
    },
    ...overrides,
  }
}

describe('building the registry', () => {
  it('collects every capability every department declares', () => {
    const registry = createCapabilityRegistry([
      aDepartment({
        capabilities: [
          aCapability(),
          aCapability({ id: 'compact-log', action: 'operations.log.compact' }),
        ],
      }),
    ])

    expect(registry.ok).toBe(true)
    if (registry.ok) {
      expect(registry.value.actions).toEqual([
        'diagnostics.self-check.run',
        'operations.log.compact',
      ])
    }
  })

  it('★ refuses two departments claiming the same action', () => {
    // ★ A router that had to choose would not be deterministic, and
    // "whichever loaded first" is a routing rule nobody wrote down. It fails
    // at load, when a developer is looking, rather than at execution, when the
    // owner is.
    const registry = createCapabilityRegistry([
      aDepartment(),
      aDepartment({ id: 'engineering', name: 'Engineering' }),
    ])

    expect(registry.ok).toBe(false)
    if (!registry.ok) {
      expect(registry.error.message).toContain('will not guess')
      expect(registry.error.detail?.departments).toEqual(['operations', 'engineering'])
    }
  })

  it('builds an empty registry from no departments', () => {
    const registry = createCapabilityRegistry([])

    expect(registry.ok).toBe(true)
    if (registry.ok) expect(registry.value.actions).toEqual([])
  })
})

describe('routing one action', () => {
  const registry = createCapabilityRegistry([aDepartment()])
  const lookup = registry.ok ? registry.value : undefined

  it('finds the department that performs it', () => {
    const route = lookup?.route('diagnostics.self-check.run')

    expect(route?.ok).toBe(true)
    if (route?.ok) {
      expect(route.value.department).toBe('operations')
      expect(route.value.capability.id).toBe('run-self-check')
    }
  })

  it('★ refuses an unknown action rather than matching something close', () => {
    // ★ A plan naming a capability that does not exist is usually a
    // hallucinated one. "She tried something similar" is not a defensible
    // answer to what FRIDAY did.
    const route = lookup?.route('diagnostics.self-check.runn')

    expect(route?.ok).toBe(false)
    if (route && !route.ok) {
      expect(route.error.message).toContain('Nothing FRIDAY has')
      expect(route.error.detail?.available).toEqual(['diagnostics.self-check.run'])
    }
  })
})

describe('routing a whole plan', () => {
  const registry = createCapabilityRegistry([
    aDepartment({
      capabilities: [
        aCapability(),
        aCapability({ id: 'compact-log', action: 'operations.log.compact' }),
      ],
    }),
  ])
  const lookup = registry.ok ? registry.value : undefined

  it('resolves every step, in order', () => {
    const routes = lookup
      ? routePlan(lookup, [
          { id: 's1', actionType: 'diagnostics.self-check.run', department: 'operations' },
          { id: 's2', actionType: 'operations.log.compact', department: 'operations' },
        ])
      : undefined

    expect(routes?.ok).toBe(true)
    if (routes?.ok)
      expect(routes.value.map((r) => r.capability.id)).toEqual(['run-self-check', 'compact-log'])
  })

  it('★ refuses when the planner named a department that does not do it', () => {
    // ★ The lookup wins, and the mismatch REFUSES rather than being silently
    // corrected. A planner naming the wrong department is either confused or
    // being steered, and quietly routing it to the right place would hide both.
    const routes = lookup
      ? routePlan(lookup, [
          { id: 's1', actionType: 'diagnostics.self-check.run', department: 'engineering' },
        ])
      : undefined

    expect(routes?.ok).toBe(false)
    if (routes && !routes.ok) {
      expect(routes.error.detail?.claimed).toBe('engineering')
      expect(routes.error.detail?.actual).toBe('operations')
    }
  })

  it('refuses the whole plan when one step cannot be routed', () => {
    const routes = lookup
      ? routePlan(lookup, [
          { id: 's1', actionType: 'diagnostics.self-check.run', department: 'operations' },
          { id: 's2', actionType: 'finance.bank.transfer', department: 'operations' },
        ])
      : undefined

    expect(routes?.ok).toBe(false)
  })
})

describe('routing is not authorization', () => {
  it('★ routes a capability the Guardian would refuse outright', () => {
    // ★ THE separation. `finance.bank.transfer` is denied by the shipped rules
    // for everyone, grant or no grant — and routing still resolves it, because
    // routing answers "who does this" and never "may this be done".
    //
    // If routing refused here it would be a second authority path, and the
    // owner would have two places to look for why something was stopped. The
    // Guardian stops it, at the moment the step runs, every time.
    const registry = createCapabilityRegistry([
      aDepartment({
        id: 'finance',
        name: 'Finance',
        capabilities: [
          aCapability({
            id: 'transfer',
            action: 'finance.bank.transfer',
            riskClass: 'critical',
            irreversible: true,
          }),
        ],
      }),
    ])

    expect(registry.ok).toBe(true)
    if (registry.ok) expect(registry.value.route('finance.bank.transfer').ok).toBe(true)
  })

  it('carries irreversibility through for the approval screen', () => {
    // Not an authorization input — the "cannot be undone" line the owner reads.
    const registry = createCapabilityRegistry([
      aDepartment({
        capabilities: [aCapability({ irreversible: true })],
      }),
    ])

    const route = registry.ok ? registry.value.route('diagnostics.self-check.run') : undefined

    expect(route?.ok && route.value.capability.irreversible).toBe(true)
  })
})
