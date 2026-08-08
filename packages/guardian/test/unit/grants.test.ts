import type { GrantQuery, GrantRegistry, NewGrant } from '@friday/guardian'
import { createGrantRegistry, createInMemoryGrantStore } from '@friday/guardian'
import { beforeEach, describe, expect, it } from 'vitest'

const DAY_MS = 24 * 60 * 60 * 1000
const START = 1_700_000_000_000

let clock: number
let grants: GrantRegistry

function newGrant(overrides: Partial<NewGrant> = {}): NewGrant {
  return {
    principalId: 'usr_tyler',
    actionPattern: 'connector.*.write',
    resourcePattern: 'connector:gmail/**',
    riskClass: 'medium',
    reason: 'You approved eight of these last month.',
    expiresAt: START + 30 * DAY_MS,
    ...overrides,
  }
}

function create(overrides: Partial<NewGrant> = {}) {
  const result = grants.create(newGrant(overrides))
  if (!result.ok) throw new Error(`fixture grant rejected: ${result.error.message}`)
  return result.value
}

/** `find` returns a Result now; every assertion here is about the outcome. */
function outcomeOf(query: GrantQuery) {
  const result = grants.find(query)
  if (!result.ok) throw new Error(`grant lookup failed: ${result.error.message}`)
  return result.value
}

const QUERY = {
  principalId: 'usr_tyler',
  action: 'connector.gmail.write',
  resource: 'connector:gmail/labels/inbox',
  riskClass: 'medium',
} as const

beforeEach(() => {
  clock = START
  grants = createGrantRegistry({ store: createInMemoryGrantStore(), now: () => clock })
})

describe('creating', () => {
  it('accepts a specific, expiring permission', () => {
    expect(grants.create(newGrant()).ok).toBe(true)
  })

  it('refuses one that never ends', () => {
    expect(grants.create(newGrant({ expiresAt: START })).ok).toBe(false)
  })

  it('refuses one that outlives its class', () => {
    expect(grants.create(newGrant({ expiresAt: START + 91 * DAY_MS })).ok).toBe(false)
    expect(grants.create(newGrant({ riskClass: 'high', expiresAt: START + 31 * DAY_MS })).ok).toBe(
      false,
    )
  })

  it('refuses one covering money or FRIDAY’s own code', () => {
    expect(grants.create(newGrant({ riskClass: 'critical' })).ok).toBe(false)
    expect(grants.create(newGrant({ riskClass: 'self_modification' })).ok).toBe(false)
  })

  it('refuses "FRIDAY can do anything"', () => {
    const result = grants.create(newGrant({ actionPattern: '*', resourcePattern: '*' }))

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('GRANT_INVALID')
  })

  it('accepts a standing denial of anything at all', () => {
    // Refusing to pre-authorise is never the dangerous direction.
    const result = grants.create(
      newGrant({
        negative: true,
        actionPattern: '*',
        resourcePattern: '*',
        riskClass: 'critical',
        reason: 'Never act without asking me first.',
        expiresAt: START + 365 * DAY_MS,
      }),
    )

    expect(result.ok).toBe(true)
  })
})

describe('applying', () => {
  it('covers a request it matches', () => {
    const grant = create()

    const outcome = outcomeOf(QUERY)

    expect(outcome.kind).toBe('applies')
    if (outcome.kind !== 'applies') return
    expect(outcome.grant.id).toBe(grant.id)
  })

  it('does not cover a different action or resource', () => {
    create()

    expect(outcomeOf({ ...QUERY, action: 'memory.delete' }).kind).toBe('none')
    expect(outcomeOf({ ...QUERY, resource: 'connector:slack/channels/general' }).kind).toBe('none')
  })

  it('does not cover another principal', () => {
    create()

    expect(outcomeOf({ ...QUERY, principalId: 'usr_someone-else' }).kind).toBe('none')
  })

  it('stops covering once it expires', () => {
    create()
    clock = START + 30 * DAY_MS

    expect(outcomeOf(QUERY).kind).toBe('none')
  })

  it('stops covering once it is withdrawn', () => {
    const grant = create()
    grants.revoke(grant.id)

    expect(outcomeOf(QUERY).kind).toBe('none')
  })

  it('stops covering once it is used up', () => {
    const grant = create({ maxUses: 1 })
    grants.use(grant.id)

    expect(outcomeOf(QUERY).kind).toBe('none')
  })

  it('stops covering when the action is reclassified above it', () => {
    // The rule that matters most here. Reclassifying upward is how the owner
    // tightens things, and a grant that ignored the new class would silently
    // undo the tightening.
    create({ riskClass: 'medium' })

    const outcome = outcomeOf({ ...QUERY, riskClass: 'high' })

    expect(outcome.kind).toBe('insufficient')
  })

  it('covers a class below its ceiling', () => {
    create({ riskClass: 'high', expiresAt: START + 30 * DAY_MS })

    expect(outcomeOf({ ...QUERY, riskClass: 'medium' }).kind).toBe('applies')
  })

  it('reports a near miss rather than silence', () => {
    // "Your permission does not stretch this far" is a different sentence from
    // "you gave no permission", and the owner needs to tell them apart.
    create({ constraints: { maxAmountCents: 500 } })

    const outcome = outcomeOf({ ...QUERY, amountCents: 900 })

    expect(outcome.kind).toBe('insufficient')
  })

  it('honours a spending ceiling', () => {
    create({ constraints: { maxAmountCents: 500 } })

    expect(outcomeOf({ ...QUERY, amountCents: 500 }).kind).toBe('applies')
  })

  it('treats an unstated amount as not covered by a spending ceiling', () => {
    // Silence is not zero. An action that spends without saying how much is
    // exactly the one a ceiling exists to stop.
    create({ constraints: { maxAmountCents: 500 } })

    expect(outcomeOf(QUERY).kind).toBe('insufficient')
  })

  it('lets a standing denial beat a permission', () => {
    create()
    create({
      negative: true,
      reason: 'Never touch the inbox labels again.',
      riskClass: 'medium',
    })

    const outcome = outcomeOf(QUERY)

    expect(outcome.kind).toBe('denied')
  })

  it('finds nothing when nothing was ever granted', () => {
    expect(outcomeOf(QUERY).kind).toBe('none')
  })
})

describe('counting and withdrawing', () => {
  it('counts a use only when asked to', () => {
    // `find` is read-only, so a request that is refused for another reason does
    // not quietly consume the owner's grant.
    const grant = create({ maxUses: 2 })

    outcomeOf(QUERY)
    outcomeOf(QUERY)

    expect(outcomeOf(QUERY).kind).toBe('applies')

    grants.use(grant.id)
    grants.use(grant.id)

    expect(outcomeOf(QUERY).kind).toBe('none')
  })

  it('reports a use or withdrawal of something that does not exist', () => {
    expect(grants.use('nope').ok).toBe(false)
    expect(grants.revoke('nope').ok).toBe(false)
  })

  it('keeps the first withdrawal when asked twice', () => {
    const grant = create()
    grants.revoke(grant.id)
    clock += DAY_MS
    const second = grants.revoke(grant.id)

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.revokedAt).toBe(START)
  })

  it('lists lapsed grants too, because the renewal review needs them', () => {
    const grant = create({ maxUses: 5 })
    grants.use(grant.id)
    grants.revoke(grant.id)

    const listed = grants.list('usr_tyler')
    if (!listed.ok) throw new Error('expected a listing')

    expect(listed.value).toHaveLength(1)
    expect(listed.value[0]?.uses).toBe(1)
  })

  it('uses the wall clock when none is injected', () => {
    const live = createGrantRegistry({ store: createInMemoryGrantStore() })
    const created = live.create(newGrant({ expiresAt: Date.now() + 30 * DAY_MS }))

    expect(created.ok).toBe(true)
    if (!created.ok) return

    const revoked = live.revoke(created.value.id)
    expect(revoked.ok).toBe(true)
    if (!revoked.ok) return
    expect(revoked.value.revokedAt).not.toBeNull()
  })
})
