import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createApprovalClerk, registerClerkEventTypes } from '@friday/clerk'
import { type FridayConfig, loadConfig } from '@friday/config'
import type { Actor, RiskClass } from '@friday/contracts'
import { appRouter, type OpenedContext, openContext } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createEventBus } from '@friday/kernel'
import {
  createInMemoryKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
  openStorage,
} from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Answering an approval from the browser.
 *
 * The rule being protected is ADR-0030's: a connection from this machine says
 * the request came from the owner's computer, and says nothing about whether
 * the owner is sitting at it. So the routine approvals can be answered here
 * and the consequential ones cannot — and the refusal comes from the Guardian,
 * not from this app deciding to be careful.
 */

const FIELD_KEY_REF = 'friday-field-key'

/**
 * The rules FRIDAY decides against in these tests: the ones she ships with.
 *
 * Pointed at the repository's own policy directory rather than a fixture, so
 * these tests exercise the rules that actually govern her. ADR-0033 makes the
 * location configuration, and configuration is what a test supplies.
 */
const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname
const AGENT: Actor = { type: 'agent', id: 'agent:communications/mailer' }

describe('the approvals API', () => {
  let directory: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider
  const opened: OpenedContext[] = []

  /**
   * Raises a real approval request of a given risk, through the real clerk.
   *
   * ★ Not seeded straight into the table. An approval that was never recorded
   * as having been asked cannot be answered — the clerk refuses it, because
   * the grant would have nothing to name as its cause. Going through the clerk
   * here is what makes this setup resemble the thing it is testing.
   */
  async function raise(riskClass: RiskClass): Promise<string> {
    const storage = openStorage({
      eventsDbPath: config.paths.eventsDb,
      mainDbPath: config.paths.mainDb,
      keys,
      fieldKeyReference: config.keychain.fieldKeyRef,
    })

    if (!storage.ok) throw new Error(`test setup could not open storage: ${storage.error.message}`)

    const bus = registerClerkEventTypes(
      createEventBus({ storage: storage.value, principalId: config.principalId }),
    )

    const decisionId = crypto.randomUUID()

    // The decision the request hangs from. Without it there is no chain.
    const decided = await bus.publish({
      type: 'guardian.decided',
      actor: AGENT,
      principalId: config.principalId,
      payload: {
        decisionId,
        decision: 'needs_approval',
        reason: 'approval_required',
        riskClass,
        action: 'connector.gmail.send',
        resource: 'gmail:thread/abc',
        actor: AGENT,
        matchedPolicies: ['connector-sends-need-approval'],
        approvalId: null,
        standingGrantId: null,
        summary: `A ${riskClass} thing that needs you.`,
      },
      sensitivity: 'private',
    })

    if (!decided.ok)
      throw new Error(`test setup could not record a decision: ${decided.error.message}`)

    const clerk = createApprovalClerk({ approvals: storage.value.guardian.approvals, bus })

    const raised = await clerk.request({
      principalId: config.principalId,
      title: `A ${riskClass} thing that needs you`,
      riskClass,
      explanation: {
        what: 'Send a follow-up email to Sarah Chen',
        why: 'You asked to be kept on top of the contract thread',
        confidence: 0.8,
        risks: ['The tone may be wrong for this relationship'],
        alternatives: ['Wait for her to reply first'],
      },
      preview: { kind: 'text', content: 'Hi Sarah — following up on the contract.' },
      impact: {
        reversible: false,
        dataLeavesDevice: true,
        dataCategories: ['correspondence'],
        estimatedCostCents: null,
      },
      actor: AGENT,
      action: 'connector.gmail.send',
      resource: 'gmail:thread/abc',
      decisionId,
      causedByEventId: decided.value.id,
    })

    if (!raised.ok)
      throw new Error(`test setup could not raise the request: ${raised.error.message}`)

    storage.value.close()
    return raised.value.request.id
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-approvals-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    process.env.FRIDAY_DATA_DIR = directory
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_POLICIES_DIR = POLICY_DIR

    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(`test setup could not load config: ${loaded.error.message}`)

    config = loaded.value
    // Both names, because two things read this provider: the helper below,
    // which opens storage directly, and `openContext`, which uses whatever the
    // configuration names. They only had to agree once the context started
    // writing `private` events, which is what field encryption needs a key for.
    keys = createInMemoryKeyProvider({
      [FIELD_KEY_REF]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),

      // Composing a Guardian reads this at construction, even though nothing
      // in these tests presents a capability.
      [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
    })
  })

  afterEach(() => {
    // Every handle, not just the last. A test that opens two contexts and
    // closes one leaves SQLite holding the first, which is the kind of leak
    // that behaves differently under a different filesystem.
    for (const context of opened.splice(0)) context.close()

    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
  })

  /** Opens a context over the real databases and returns a caller on it. */
  function caller(): ReturnType<typeof appRouter.createCaller> {
    const result = openContext({ config, keys })
    if (!result.ok) throw new Error(result.error.message)

    opened.push(result.value)
    return appRouter.createCaller(result.value.context)
  }

  it('lists what is waiting on the owner', async () => {
    await raise('low')
    await raise('high')

    const page = await caller().approvals.pending()

    expect(page.approvals).toHaveLength(2)
    expect(page.approvals.every((request) => request.status === 'pending')).toBe(true)

    // The explanation travels with the request. A dashboard that showed the
    // title alone would be asking for consent to something unexplained.
    expect(page.approvals[0]?.explanation.why).toContain('contract thread')
  })

  it('records an answer to a routine request, and says it came from the browser', async () => {
    const id = await raise('low')

    const settled = await caller().approvals.respond({ approvalId: id, decision: 'approve' })

    expect(settled.status).toBe('approved')
    expect(settled.respondedVia).toBe('web')
    expect(settled.respondedAt).not.toBeNull()
  })

  it('records a decline, with the reason the owner gave', async () => {
    const id = await raise('medium')

    const settled = await caller().approvals.respond({
      approvalId: id,
      decision: 'decline',
      reason: 'Wrong tone for this relationship',
    })

    expect(settled.status).toBe('declined')
    expect(settled.responseReason).toBe('Wrong tone for this relationship')
  })

  it('refuses a high-risk request, because a local connection is not a present owner', async () => {
    // ★ ADR-0030. This app never supplies `authenticatedAt`, so the Guardian
    // refuses — and the refusal is the Guardian's, which is the point. If this
    // app started filling that field in, STEP_UP_REQUIRED would become
    // unreachable and the guarantee would be gone while the code still looked
    // like it enforced something.
    const id = await raise('high')

    await expect(
      caller().approvals.respond({ approvalId: id, decision: 'approve' }),
    ).rejects.toThrow(/prove it is you/i)
  })

  it('refuses a request to change her own code from the browser', async () => {
    const id = await raise('self_modification')

    await expect(
      caller().approvals.respond({ approvalId: id, decision: 'approve' }),
    ).rejects.toThrow(/prove it is you/i)
  })

  it('leaves a refused request pending rather than half-answered', async () => {
    const id = await raise('critical')

    await expect(
      caller().approvals.respond({ approvalId: id, decision: 'approve' }),
    ).rejects.toThrow()

    // The failure mode worth guarding: a request that was refused for
    // step-up but recorded as settled anyway would be an approval the owner
    // never gave, and it would disappear from the panel that asks for it.
    const page = await caller().approvals.pending()
    const still = page.approvals.find((request) => request.id === id)

    expect(still?.status).toBe('pending')
    expect(still?.respondedAt).toBeNull()
  })
})
