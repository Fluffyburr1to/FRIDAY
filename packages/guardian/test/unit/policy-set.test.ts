import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createPolicySet, loadPolicySet } from '@friday/guardian'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

function rule(id: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id,
    description: `Fixture rule ${id}.`,
    effect: 'require_approval',
    riskClass: 'medium',
    when: { action: 'connector.*.write' },
    ...overrides,
  }
}

describe('building a set', () => {
  it('accepts a valid set and sorts it by id', () => {
    const result = createPolicySet([rule('zebra'), rule('alpha')])

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.value.policies.map((policy) => policy.id)).toEqual(['alpha', 'zebra'])
    expect(result.value.get('alpha')?.id).toBe('alpha')
    expect(result.value.get('nothing')).toBeUndefined()
  })

  it('refuses an empty set rather than silently refusing everything', () => {
    // It would behave identically — nothing matches, so nothing is permitted —
    // but a Guardian whose rules failed to load is a broken system that looks
    // exactly like a strict one.
    const result = createPolicySet([])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLICY_SET_EMPTY')
  })

  it('refuses a malformed rule and says which one', () => {
    const result = createPolicySet([rule('good'), { id: 'bad' }])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLICY_INVALID')
    expect(result.error.detail?.index).toBe(1)
  })

  it('refuses two rules with the same name', () => {
    // Rule ids are quoted whenever FRIDAY explains a decision, so a duplicate
    // would make an explanation naming that id untrue.
    const result = createPolicySet([rule('same'), rule('same', { effect: 'allow' })])

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('same')
  })
})

describe('loading from disk', () => {
  let directory: string

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-policies-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('reads every json file and combines them', () => {
    writeFileSync(join(directory, '00-a.json'), JSON.stringify([rule('from-a')]))
    writeFileSync(join(directory, '10-b.json'), JSON.stringify([rule('from-b')]))
    writeFileSync(join(directory, 'README.md'), '# not a rule file')

    const result = loadPolicySet(directory)

    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.policies.map((policy) => policy.id)).toEqual(['from-a', 'from-b'])
  })

  it('fails rather than skipping a file that will not parse', () => {
    // A rule file that quietly failed to parse would remove whatever
    // restrictions it contained. That is the one failure mode this component
    // cannot have.
    writeFileSync(join(directory, '00-a.json'), JSON.stringify([rule('from-a')]))
    writeFileSync(join(directory, '10-broken.json'), '{ not json')

    const result = loadPolicySet(directory)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('10-broken.json')
  })

  it('fails when a file is not a list of rules', () => {
    writeFileSync(join(directory, '00-a.json'), JSON.stringify(rule('lonely')))

    const result = loadPolicySet(directory)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.message).toContain('list of rules')
  })

  it('fails when the directory cannot be read, and names the command that fixes it', () => {
    const missing = join(directory, 'does-not-exist')
    const result = loadPolicySet(missing)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLICY_INVALID')

    // Naming the directory tells the owner where she looked. Naming the command
    // tells them what to do about it, which is the part that was missing — the
    // Keychain half of the same failure has said it since M4.
    expect(result.error.message).toContain(missing)
    expect(result.error.message).toContain('friday init')
  })

  it('fails when the directory holds no rules at all, and names the command that fixes it', () => {
    const result = loadPolicySet(directory)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLICY_SET_EMPTY')
    expect(result.error.message).toContain(directory)
    expect(result.error.message).toContain('friday init')

    // ★ The assertion that pins the actual defect. This message used to send
    // the owner to `packages/guardian/policies/` — a path inside the source
    // repository, which does not exist on a machine FRIDAY was installed onto.
    expect(result.error.message).not.toContain('packages/guardian/policies')
  })

  it('re-words the empty set even when rule files exist but hold nothing', () => {
    // The case an early `files.length === 0` check would miss: the directory
    // has rule files, they parse, and they contain no rules.
    writeFileSync(join(directory, '00-empty.json'), '[]')

    const result = loadPolicySet(directory)

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('POLICY_SET_EMPTY')
    expect(result.error.message).toContain('friday init')
  })
})
