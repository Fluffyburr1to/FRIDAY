import { readFileSync } from 'node:fs'
import { createCapabilityRegistry, routePlan } from '@friday/chief-of-staff'
import { DepartmentManifestSchema } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The shipped department manifest, against the real router.
 *
 * ★ A contract test rather than a unit test, and the distinction is the whole
 * value: `departments/operations` and `packages/chief-of-staff` each have
 * their own tests, and both pass while the two disagree about what an action
 * is called. **A typo in the manifest is a capability FRIDAY silently cannot
 * reach**, and neither package's own suite would notice.
 *
 * Reference: docs/01-bible/13-department-architecture.md · tests/README.md
 */

const MANIFEST = new URL('../../departments/operations/department.json', import.meta.url).pathname

function operations() {
  const parsed = DepartmentManifestSchema.safeParse(
    JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown,
  )

  if (!parsed.success) throw new Error(`the manifest does not parse: ${parsed.error.message}`)

  return parsed.data
}

describe('the operations department, as the router sees it', () => {
  it('★ builds a registry from the manifest that actually ships', () => {
    const registry = createCapabilityRegistry([operations()])

    expect(registry.ok).toBe(true)
    if (registry.ok) {
      expect(registry.value.actions).toEqual([
        'diagnostics.self-check.run',
        'operations.log.compact',
      ])
    }
  })

  it('★ routes both capabilities to operations', () => {
    // ★ The cross-check. If the manifest said `operations.self-check.run` and
    // the Guardian rule said `diagnostics.*.run`, every test in both packages
    // would still pass and the capability would be unreachable.
    const registry = createCapabilityRegistry([operations()])
    expect(registry.ok).toBe(true)
    if (!registry.ok) return

    const routes = routePlan(registry.value, [
      { id: 's1', actionType: 'diagnostics.self-check.run', department: 'operations' },
      { id: 's2', actionType: 'operations.log.compact', department: 'operations' },
    ])

    expect(routes.ok).toBe(true)
    if (routes.ok) {
      expect(routes.value.map((route) => route.capability.id)).toEqual([
        'run-self-check',
        'compact-event-log',
      ])
    }
  })

  it('★ every shipped action matches a shipped Guardian rule', () => {
    // ★ The other half of the same seam. An action nothing classifies is
    // DENIED — correctly, and invisibly, because the department looks fine and
    // the rules look fine and the two were never compared.
    //
    // Matched the way the Guardian matches: a pattern segment of `*` covers
    // any one segment.
    const rules = JSON.parse(
      readFileSync(
        new URL('../../packages/guardian/policies/30-thinking.json', import.meta.url).pathname,
        'utf8',
      ),
    ) as { when: { action?: string } }[]

    const patterns = rules
      .map((rule) => rule.when.action)
      .filter((a): a is string => a !== undefined)

    function covered(action: string): boolean {
      return patterns.some((pattern) => {
        const p = pattern.split('.')
        const a = action.split('.')
        if (p.length !== a.length) return false

        return p.every((segment, index) => segment === '*' || segment === a[index])
      })
    }

    for (const capability of operations().capabilities) {
      expect(covered(capability.action), `no rule classifies ${capability.action}`).toBe(true)
    }
  })

  it('★ compaction is classified above low, and self-check is not', () => {
    // ★ The pair that proves both halves of M5's done-when: work that
    // proceeds, and work that stops for the owner.
    const capabilities = operations().capabilities
    const selfCheck = capabilities.find((c) => c.id === 'run-self-check')
    const compact = capabilities.find((c) => c.id === 'compact-event-log')

    expect(selfCheck?.riskClass).toBe('low')
    expect(compact?.riskClass).not.toBe('low')
  })
})
