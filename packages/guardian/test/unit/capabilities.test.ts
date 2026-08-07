import { type Actor, MAX_CAPABILITY_LIFETIME_MS, uuidv7 } from '@friday/contracts'
import {
  CAPABILITY_KEY_REFERENCE,
  type CapabilityIssuer,
  type CapabilityKeyProvider,
  type CapabilityRequest,
  type CapabilityStore,
  createCapabilityIssuer,
  createInMemoryCapabilityStore,
  DEFAULT_CAPABILITY_LIFETIME_MS,
} from '@friday/guardian'
import { beforeEach, describe, expect, it } from 'vitest'

const AGENT: Actor = { type: 'agent', id: 'agent:communications/draft-email' }
const OTHER: Actor = { type: 'agent', id: 'agent:communications/send' }

const REQUEST = {
  principalId: 'usr_tyler',
  issuedTo: AGENT,
  action: 'memory.read',
  resource: 'memory:contacts/sarah-chen',
}

function keyProvider(value = Buffer.alloc(32, 7).toString('base64')): CapabilityKeyProvider {
  return {
    getKey: (reference) =>
      reference === CAPABILITY_KEY_REFERENCE
        ? { ok: true, value: Buffer.from(value, 'base64') }
        : { ok: false, error: { code: 'ENCRYPTION_KEY_UNAVAILABLE', message: 'no such key' } },
  }
}

let clock: number
let store: CapabilityStore
let issuer: CapabilityIssuer

function build(keys: CapabilityKeyProvider = keyProvider()): CapabilityIssuer {
  const result = createCapabilityIssuer({ store, keys, now: () => clock })
  if (!result.ok) throw new Error(`fixture issuer failed: ${result.error.message}`)
  return result.value
}

beforeEach(() => {
  clock = 1_700_000_000_000
  store = createInMemoryCapabilityStore()
  issuer = build()
})

describe('construction', () => {
  it('fails loudly when the signing key cannot be read', () => {
    // Reported at startup, not discovered on the first action FRIDAY was about
    // to take.
    const result = createCapabilityIssuer({
      store,
      keys: {
        getKey: () => ({
          ok: false,
          error: { code: 'ENCRYPTION_KEY_UNAVAILABLE', message: 'locked' },
        }),
      },
    })

    expect(result.ok).toBe(false)
  })

  it('uses the wall clock when no clock is injected', () => {
    // Every other test drives a fake clock, which would leave the real one
    // never exercised — and the real one is what production runs on.
    const built = createCapabilityIssuer({ store, keys: keyProvider() })
    if (!built.ok) throw new Error('expected an issuer')

    const before = Date.now()
    const issued = built.value.issue(REQUEST)
    if (!issued.ok) throw new Error('expected an issued capability')

    expect(issued.value.capability.issuedAt).toBeGreaterThanOrEqual(before)
    expect(issued.value.capability.expiresAt - issued.value.capability.issuedAt).toBe(
      DEFAULT_CAPABILITY_LIFETIME_MS,
    )
  })
})

describe('issuing', () => {
  it('mints a token that carries no claims', () => {
    const issued = issuer.issue(REQUEST)

    expect(issued.ok).toBe(true)
    if (!issued.ok) return

    // The token reveals nothing about what it is for. A leaked one in a log
    // line tomorrow is a dead string.
    expect(issued.value.token).not.toContain('memory')
    expect(issued.value.token.startsWith('fct_v1.')).toBe(true)
    expect(store.get(issued.value.capability.id)?.action).toBe('memory.read')
  })

  it('defaults to five minutes', () => {
    const issued = issuer.issue(REQUEST)
    if (!issued.ok) throw new Error('expected an issued capability')

    expect(issued.value.capability.expiresAt - clock).toBe(DEFAULT_CAPABILITY_LIFETIME_MS)
  })

  it('caps a longer request at fifteen minutes rather than refusing it', () => {
    const issued = issuer.issue({ ...REQUEST, lifetimeMs: 24 * 60 * 60 * 1000 })
    if (!issued.ok) throw new Error('expected an issued capability')

    expect(issued.value.capability.expiresAt - clock).toBe(MAX_CAPABILITY_LIFETIME_MS)
  })

  it('refuses to issue a permission for a pattern', () => {
    // A wildcard capability would restore exactly the ambient authority the
    // design exists to remove.
    const issued = issuer.issue({ ...REQUEST, resource: 'memory:contacts/*' })

    expect(issued.ok).toBe(false)
    if (issued.ok) return
    expect(issued.error.code).toBe('CAPABILITY_INVALID')
  })

  it('records the plan step that justified it', () => {
    const planId = uuidv7()
    const issued = issuer.issue({ ...REQUEST, planId, planStepId: uuidv7() })
    if (!issued.ok) throw new Error('expected an issued capability')

    expect(issued.value.capability.planId).toBe(planId)
  })
})

describe('verifying', () => {
  function issue(overrides: Partial<CapabilityRequest> = {}): string {
    const issued = issuer.issue({ ...REQUEST, ...overrides })
    if (!issued.ok) throw new Error('expected an issued capability')
    return issued.value.token
  }

  it('accepts a token used for exactly what it was issued for', () => {
    const token = issue()

    const verified = issuer.verify({
      token,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(true)
  })

  it('rejects something that never looked like a token', () => {
    const verified = issuer.verify({
      token: 'hello',
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_malformed')
  })

  it('tells a constructed token apart from a real one', () => {
    // A different incident from a replay, and the audit trail has to say so.
    const forged = `fct_v1.${uuidv7()}.${'A'.repeat(43)}`

    const verified = issuer.verify({
      token: forged,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_forged')
  })

  it('rejects a correctly signed token for a record that does not exist', () => {
    const token = issue()

    // Same signing key, so the signature verifies — but the record is not in
    // this store. This is what a token surviving a database restore, or an
    // in-memory store after a restart, looks like from the outside.
    const detached = createCapabilityIssuer({
      store: createInMemoryCapabilityStore(),
      keys: keyProvider(),
      now: () => clock,
    })
    if (!detached.ok) throw new Error('expected an issuer')

    const verified = detached.value.verify({
      token,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_unknown')
  })

  it('rejects a token presented by a different agent', () => {
    const token = issue()

    const verified = issuer.verify({
      token,
      actor: OTHER,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_actor_mismatch')
  })

  it('rejects a token used for a different action or resource', () => {
    const token = issue()

    for (const wrong of [
      { action: 'memory.write', resource: 'memory:contacts/sarah-chen' },
      { action: 'memory.read', resource: 'memory:contacts/alex' },
    ]) {
      const verified = issuer.verify({ token, actor: AGENT, ...wrong })

      expect(verified.ok).toBe(false)
      if (verified.ok) continue
      expect(verified.error.reason).toBe('capability_scope_mismatch')
    }
  })

  it('reports a scope mismatch even when the token has also expired', () => {
    // Ordering that is about the audit trail rather than about speed. A real
    // attack must not be filed as an ordinary lapsed permission.
    const token = issue()
    clock += MAX_CAPABILITY_LIFETIME_MS + 1

    const verified = issuer.verify({
      token,
      actor: AGENT,
      action: 'memory.write',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_scope_mismatch')
  })

  it('rejects an expired token', () => {
    const token = issue()
    clock += DEFAULT_CAPABILITY_LIFETIME_MS

    const verified = issuer.verify({
      token,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_expired')
  })

  it('rejects a revoked token immediately, with no window', () => {
    const issued = issuer.issue(REQUEST)
    if (!issued.ok) throw new Error('expected an issued capability')

    issuer.revoke(issued.value.capability.id, 'the owner cancelled the plan')

    const verified = issuer.verify({
      token: issued.value.token,
      actor: AGENT,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    expect(verified.ok).toBe(false)
    if (verified.ok) return
    expect(verified.error.reason).toBe('capability_revoked')
  })

  it('counts uses and refuses the one past the budget', () => {
    // The property a self-contained token cannot have, and the reason the
    // claims live in the store at all.
    const token = issue({ constraints: { maxCalls: 2 } })
    const use = () =>
      issuer.verify({
        token,
        actor: AGENT,
        action: 'memory.read',
        resource: 'memory:contacts/sarah-chen',
      })

    expect(use().ok).toBe(true)
    expect(use().ok).toBe(true)

    const third = use()
    expect(third.ok).toBe(false)
    if (third.ok) return
    expect(third.error.reason).toBe('capability_exhausted')
  })

  it('never puts the token value in the error it returns', () => {
    // A refused token is still a credential until it expires, and an error
    // object ends up in a log line.
    const token = issue()
    const verified = issuer.verify({
      token,
      actor: OTHER,
      action: 'memory.read',
      resource: 'memory:contacts/sarah-chen',
    })

    if (verified.ok) throw new Error('expected a rejection')
    expect(JSON.stringify(verified.error)).not.toContain(token)
  })
})

describe('revoking', () => {
  it('reports a token that was never issued', () => {
    const result = issuer.revoke(uuidv7(), 'housekeeping')

    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.error.code).toBe('NOT_FOUND')
  })

  it('keeps the first revocation when asked twice', () => {
    // The original reason and time are what the audit trail needs; a later
    // sweep overwriting them would lose why it was withdrawn.
    const issued = issuer.issue(REQUEST)
    if (!issued.ok) throw new Error('expected an issued capability')

    issuer.revoke(issued.value.capability.id, 'the owner cancelled the plan')
    clock += 60_000
    const second = issuer.revoke(issued.value.capability.id, 'routine sweep')

    expect(second.ok).toBe(true)
    if (!second.ok) return
    expect(second.value.revokedReason).toBe('the owner cancelled the plan')
  })

  it('withdraws everything a plan was holding at once', () => {
    const planId = uuidv7()
    issuer.issue({ ...REQUEST, planId })
    issuer.issue({ ...REQUEST, planId, resource: 'memory:contacts/alex' })
    issuer.issue({ ...REQUEST, planId: uuidv7() })

    expect(issuer.revokeForPlan(planId, 'the plan was cancelled')).toBe(2)

    // Idempotent: a second sweep finds nothing left to withdraw.
    expect(issuer.revokeForPlan(planId, 'the plan was cancelled')).toBe(0)
  })
})
