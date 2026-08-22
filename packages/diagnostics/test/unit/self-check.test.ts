import type { HealthReport } from '@friday/contracts'
import { aggregateHealth, err, freshOrUnknown, fridayError, ok } from '@friday/contracts'
import { auditChainCheck, runSelfChecks, type SelfCheck } from '@friday/diagnostics'
import { describe, expect, it } from 'vitest'

/**
 * Self-checks.
 *
 * ★ Every assertion here is about the difference between **"I looked and it is
 * broken"** and **"I could not look"**. Chapter 23 is explicit that assuming
 * health from silence is how outages go unnoticed, and that is the failure
 * these tests exist to prevent.
 */

function aCheck(id: string, run: SelfCheck['run']): SelfCheck {
  return { id, description: `what ${id} establishes`, run }
}

const clock = () => {
  let at = 1_000
  return () => (at += 5)
}

describe('running the checks', () => {
  it('reports what a passing check found', async () => {
    const outcomes = await runSelfChecks({
      checks: [
        aCheck('ok-check', () =>
          Promise.resolve(ok({ status: 'healthy' as const, detail: 'all good' })),
        ),
      ],
      now: clock(),
    })

    expect(outcomes[0]?.report.status).toBe('healthy')
    expect(outcomes[0]?.couldNotRun).toBe(false)
  })

  it('★ reports unknown — not unhealthy — when a check cannot run', async () => {
    // ★ THE distinction. A check that could not run has established nothing.
    // Calling it `unhealthy` would raise a false alarm; calling it `healthy`
    // would hide a real one. `unknown` is the only honest answer.
    const outcomes = await runSelfChecks({
      checks: [
        aCheck('broken', () =>
          Promise.resolve(err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'db is gone' }))),
        ),
      ],
      now: clock(),
    })

    expect(outcomes[0]?.report.status).toBe('unknown')
    expect(outcomes[0]?.couldNotRun).toBe(true)
    expect(outcomes[0]?.report.detail).toContain('could not run')
  })

  it('★ treats a thrown check as one that did not run', async () => {
    // ★ A throw must not be mistaken for a clean result, and must not take the
    // rest of the run down with it.
    const outcomes = await runSelfChecks({
      checks: [
        aCheck('throws', () => {
          throw new Error('exploded')
        }),
      ],
      now: clock(),
    })

    expect(outcomes[0]?.report.status).toBe('unknown')
    expect(outcomes[0]?.couldNotRun).toBe(true)
  })

  it('★ keeps going after a check fails, so later problems are still found', async () => {
    // ★ A run that abandoned itself on the first problem would hide every
    // problem after it — and finding the ones nobody is looking for is the
    // entire purpose.
    const outcomes = await runSelfChecks({
      checks: [
        aCheck('first', () => {
          throw new Error('boom')
        }),
        aCheck('second', () =>
          Promise.resolve(ok({ status: 'unhealthy' as const, detail: 'a real problem' })),
        ),
      ],
      now: clock(),
    })

    expect(outcomes).toHaveLength(2)
    expect(outcomes[1]?.report.status).toBe('unhealthy')
  })

  it('records how long each check took', async () => {
    const outcomes = await runSelfChecks({
      checks: [aCheck('slow', () => Promise.resolve(ok({ status: 'healthy', detail: 'x' })))],
      now: clock(),
    })

    expect(outcomes[0]?.report.latencyMs).toBeGreaterThanOrEqual(0)
  })
})

describe('the audit chain check', () => {
  it('★ says the record is intact, with what was examined', async () => {
    const check = auditChainCheck(() => Promise.resolve(ok({ intact: true, checked: 412 })))
    const result = await check.run()

    expect(result.ok && result.value.status).toBe('healthy')
    expect(result.ok && result.value.metrics?.eventsChecked).toBe(412)
  })

  it('★ is unhealthy, not degraded, when the chain does not hold', async () => {
    // ★ There is no partial version of "the audit trail can be trusted". If it
    // can be silently modified, every guarantee in the Bible is void.
    const check = auditChainCheck(() => Promise.resolve(ok({ intact: false, checked: 9 })))
    const result = await check.run()

    expect(result.ok && result.value.status).toBe('unhealthy')
    if (result.ok) {
      expect(result.value.detail).toContain('has been altered')
    }
  })

  it('★ reports unknown when verification itself could not run', async () => {
    // ★ "I could not verify the chain" is not "the chain is fine".
    const check = auditChainCheck(() =>
      Promise.resolve(err(fridayError({ code: 'STORAGE_UNAVAILABLE', message: 'no db' }))),
    )

    const outcomes = await runSelfChecks({ checks: [check], now: clock() })

    expect(outcomes[0]?.report.status).toBe('unknown')
  })

  it('does not write anything, and takes no arguments that could', () => {
    // Chapter 23: checks are cheap and have no side effects. The check is
    // built over a verifier that only reads.
    const check = auditChainCheck(() => Promise.resolve(ok({ intact: true, checked: 1 })))

    expect(Object.keys(check).sort()).toEqual(['description', 'id', 'run'])
  })
})

describe('aggregating what the parts say', () => {
  function report(status: HealthReport['status'], checkedAt = 1000): HealthReport {
    return { component: 'c', status, detail: 'd', checkedAt, latencyMs: 1, metrics: {} }
  }

  it('takes the worst status present', () => {
    expect(aggregateHealth([report('healthy'), report('degraded')])).toBe('degraded')
    expect(aggregateHealth([report('degraded'), report('unhealthy')])).toBe('unhealthy')
  })

  it('★ ranks unknown worse than healthy', () => {
    // ★ A component that has gone quiet must not be averaged away by the ones
    // still reporting.
    expect(aggregateHealth([report('healthy'), report('unknown')])).toBe('unknown')
  })

  it('ranks unknown better than a known problem', () => {
    expect(aggregateHealth([report('unknown'), report('unhealthy')])).toBe('unhealthy')
  })

  it('★ says unknown when nothing reported at all', () => {
    // ★ Not `healthy`. An empty system is not a well one.
    expect(aggregateHealth([])).toBe('unknown')
  })

  it('★ turns a stale report unknown, whatever it last said', () => {
    // ★ The mechanism behind "silence is not health".
    const stale = freshOrUnknown(report('healthy', 1000), 100_000, 60_000)

    expect(stale.status).toBe('unknown')
    expect(stale.detail).toContain('has not reported since')
  })

  it('leaves a fresh report alone', () => {
    const fresh = freshOrUnknown(report('healthy', 99_000), 100_000, 60_000)

    expect(fresh.status).toBe('healthy')
  })
})
