import { readFileSync } from 'node:fs'
import { DepartmentManifestSchema, err, fridayError, ok } from '@friday/contracts'
import { compactEventLog, runSelfCheck } from '@friday/operations'
import { describe, expect, it } from 'vitest'

/**
 * FRIDAY's first department.
 *
 * ★ The assertions that matter are about what this department **does not do**.
 * It performs no authorization, holds no policy, and cannot grant itself
 * anything — which is what `departments/README.md` means by *no department
 * implements authorization*.
 */

const MANIFEST = new URL('../../department.json', import.meta.url).pathname

function manifest() {
  const parsed = DepartmentManifestSchema.safeParse(
    JSON.parse(readFileSync(MANIFEST, 'utf8')) as unknown,
  )

  if (!parsed.success) throw new Error(`the manifest does not parse: ${parsed.error.message}`)

  return parsed.data
}

describe('the manifest', () => {
  it('parses against the contract the kernel validates it with', () => {
    expect(manifest().id).toBe('operations')
  })

  it('★ declares exactly the two capabilities M5 scopes it to', () => {
    // ★ Scope creep in a department is how a milestone stops being reviewable.
    expect(
      manifest()
        .capabilities.map((c) => c.id)
        .sort(),
    ).toEqual(['compact-event-log', 'run-self-check'])
  })

  it('★ marks compaction high and irreversible', () => {
    // ★ `irreversible` is a user-safety flag, not metadata: it becomes the
    // "cannot be undone" line on the approval screen, which is the single most
    // decision-relevant fact when approving something in ten seconds.
    const compact = manifest().capabilities.find((c) => c.id === 'compact-event-log')

    expect(compact?.riskClass).toBe('high')
    expect(compact?.irreversible).toBe(true)
  })

  it('declares no connectors and no external reach', () => {
    // Zero external risk is why this department is first.
    expect(manifest().degradedMode.whenConnectorUnavailable).toBe('unaffected')
  })

  it('declares every event it publishes', () => {
    // Chapter 13 rule: declared, not discovered. Undeclared use fails at load.
    expect(manifest().publishes).toContain('operations.log.compacted')
  })
})

describe('run-self-check', () => {
  const intact = () => Promise.resolve(ok({ intact: true, checked: 12 }))

  it('reports healthy when the record is intact', async () => {
    const result = await runSelfCheck({}, { verifyChain: intact })

    expect(result.ok && result.value.status).toBe('healthy')
    expect(result.ok && result.value.couldNotRun).toBe(0)
  })

  it('★ succeeds even when a check finds a problem', async () => {
    // ★ A self-check that finds something has SUCCEEDED. Returning an error
    // would make "the check ran and found a problem" indistinguishable from
    // "the check could not run" — the exact confusion Chapter 23 exists to
    // prevent.
    const result = await runSelfCheck(
      {},
      { verifyChain: () => Promise.resolve(ok({ intact: false, checked: 3 })) },
    )

    expect(result.ok).toBe(true)
    expect(result.ok && result.value.status).toBe('unhealthy')
  })

  it('★ counts a check that could not run, without calling it healthy', async () => {
    // ★ Chapter 23's rule, carried all the way out to the department's answer.
    const result = await runSelfCheck(
      {},
      {
        verifyChain: () =>
          Promise.resolve(err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'no db' }))),
      },
    )

    expect(result.ok && result.value.status).toBe('unknown')
    expect(result.ok && result.value.couldNotRun).toBe(1)
  })

  it('runs only what was asked for', async () => {
    const result = await runSelfCheck({ only: ['audit-chain'] }, { verifyChain: intact })

    expect(result.ok && result.value.checks.map((c) => c.id)).toEqual(['audit-chain'])
  })
})

describe('compact-event-log', () => {
  it('does what it is given, and reports what happened', async () => {
    const result = await compactEventLog(
      { olderThanMs: 1000 },
      {
        compact: () =>
          Promise.resolve(ok({ compacted: 40, archivedTo: '/archive/2026-08.parquet' })),
      },
    )

    expect(result.ok && result.value.compacted).toBe(40)
  })

  it('★ never checks whether it is allowed', async () => {
    // ★ THE assertion for this department. The capability is handed a
    // compactor and calls it. There is no policy lookup, no permission check,
    // and nothing it could consult — the Guardian decides, at the moment the
    // step runs.
    //
    // A capability that authorised itself would be a second authority, and the
    // one that edits the audit trail is the worst possible place to start.
    let compacted = false

    await compactEventLog(
      { olderThanMs: 0 },
      {
        compact: () => {
          compacted = true
          return Promise.resolve(ok({ compacted: 0, archivedTo: '' }))
        },
      },
    )

    // It ran because it was ASKED to, not because it decided it could. The
    // Guardian's refusal happens before this function is ever reached.
    expect(compacted).toBe(true)
    expect(Object.keys(compactEventLog)).not.toContain('authorize')
  })

  it('passes a failure straight back rather than swallowing it', async () => {
    const result = await compactEventLog(
      { olderThanMs: 0 },
      {
        compact: () =>
          Promise.resolve(err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'locked' }))),
      },
    )

    expect(result.ok).toBe(false)
  })
})
