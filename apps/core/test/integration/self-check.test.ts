import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCausalChain, explain, unsupportedClaims } from '@friday/audit'
import { createApprovalClerk, createAuthorizingClerk, registerClerkEventTypes } from '@friday/clerk'
import { type FridayConfig, loadConfig } from '@friday/config'
import { err, fridayError } from '@friday/contracts'
import {
  fatalProblem,
  type OpenedContext,
  openContext,
  runStartupSelfCheck,
  type SelfCheckOutcome,
} from '@friday/core'
import {
  CAPABILITY_KEY_REFERENCE,
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  loadPolicySet,
} from '@friday/guardian'
import { createEventBus } from '@friday/kernel'
import {
  createInMemoryKeyProvider,
  KEY_LENGTH_BYTES,
  type KeyProvider,
  openStorage,
} from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * The first authorization decision FRIDAY makes in production.
 *
 * Everything here goes through the real Guardian, the real clerk, the real bus
 * and a real SQLite log. Nothing is stubbed and no event is hand-constructed —
 * that is the point. The recording machinery has been correct since Slice 1
 * and has never had a production producer, so a test built on hand-written
 * events would prove the same nothing it has been proving all along.
 *
 * Reference: docs/adr/0033 · docs/adr/0031 · docs/adr/0032
 */

const POLICY_DIR = new URL('../../../../packages/guardian/policies', import.meta.url).pathname

/** The rule that permits this, by name. Quoted in the decision it produces. */
const SCHEDULE_RULE = 'schedules-may-run-diagnostics'

describe('the startup self-check', () => {
  let directory: string
  let previousDataDir: string | undefined
  let previousPoliciesDir: string | undefined
  let config: FridayConfig
  let keys: KeyProvider
  const opened: OpenedContext[] = []

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-self-check-'))
    previousDataDir = process.env.FRIDAY_DATA_DIR
    previousPoliciesDir = process.env.FRIDAY_POLICIES_DIR
    process.env.FRIDAY_DATA_DIR = directory
    process.env.FRIDAY_POLICIES_DIR = POLICY_DIR

    const loaded = loadConfig({})
    if (!loaded.ok) throw new Error(`test setup could not load config: ${loaded.error.message}`)

    config = loaded.value
    keys = createInMemoryKeyProvider({
      [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
      [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
    })
  })

  afterEach(() => {
    for (const context of opened.splice(0)) context.close()

    if (previousDataDir === undefined) delete process.env.FRIDAY_DATA_DIR
    else process.env.FRIDAY_DATA_DIR = previousDataDir

    if (previousPoliciesDir === undefined) delete process.env.FRIDAY_POLICIES_DIR
    else process.env.FRIDAY_POLICIES_DIR = previousPoliciesDir

    rmSync(directory, { recursive: true, force: true })
  })

  /** Opens a real context over real databases, closed by `afterEach`. */
  function open(): OpenedContext {
    const result = openContext({ config, keys })
    if (!result.ok) throw new Error(result.error.message)

    opened.push(result.value)
    return result.value
  }

  /** Every event carrying one correlation, read back from the real log. */
  function eventsFor(correlationId: string) {
    const storage = openStorage({
      eventsDbPath: config.paths.eventsDb,
      mainDbPath: config.paths.mainDb,
      keys,
      fieldKeyReference: config.keychain.fieldKeyRef,
    })

    if (!storage.ok) throw new Error(`could not reopen the log: ${storage.error.message}`)

    try {
      const read = storage.value.events.readByCorrelation({ correlationId })
      if (!read.ok) throw new Error(`could not read the log: ${read.error.message}`)

      return read.value
    } finally {
      storage.value.close()
    }
  }

  describe('when the rules permit it', () => {
    it('records exactly one guardian.decided, allowed by the shipped schedule rule', async () => {
      const context = open()

      const outcome = await runStartupSelfCheck({
        authorizing: context.authorizing,
        events: context.context.events,
        principalId: config.principalId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      expect(outcome.value.decision.decision).toBe('allow')
      expect(outcome.value.decision.reason).toBe('policy_allowed')
      expect(outcome.value.decision.matchedPolicies).toContain(SCHEDULE_RULE)

      const recorded = eventsFor(outcome.value.correlationId)
      const decided = recorded.filter((event) => event.type === 'guardian.decided')

      // Exactly one. A second would mean the decision was recorded twice for
      // one question, which is the shape of a duplicated consent.
      expect(decided).toHaveLength(1)
      expect(decided[0]?.payload).toMatchObject({
        decision: 'allow',
        action: 'diagnostics.integrity.run',
        resource: 'events:log',
        matchedPolicies: [SCHEDULE_RULE],
      })
    })

    it('asks no approval, because the rule allows it outright', async () => {
      const context = open()

      const outcome = await runStartupSelfCheck({
        authorizing: context.authorizing,
        events: context.context.events,
        principalId: config.principalId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      const types = eventsFor(outcome.value.correlationId).map((event) => event.type)
      expect(types).not.toContain('approval.requested')
    })

    it('records the decision BEFORE it verifies, not after', async () => {
      const context = open()

      const outcome = await runStartupSelfCheck({
        authorizing: context.authorizing,
        events: context.context.events,
        principalId: config.principalId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      const decided = eventsFor(outcome.value.correlationId)[0]
      if (decided === undefined) throw new Error('no decision was recorded')

      // ★ The ordering proof, without a clock or a spy. The verification
      // covers the log up to and including the decision that authorised it,
      // which is only possible if the decision was committed first. Verifying
      // before asking would leave `toSeq` one short, and the authorization
      // would be a formality performed after the fact.
      expect(outcome.value.verification?.intact).toBe(true)
      expect(outcome.value.verification?.toSeq).toBeGreaterThanOrEqual(decided.seq)
    })

    it('reconstructs as a causal chain with no orphans and no unsupported claims', async () => {
      const context = open()

      const outcome = await runStartupSelfCheck({
        authorizing: context.authorizing,
        events: context.context.events,
        principalId: config.principalId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      const recorded = eventsFor(outcome.value.correlationId)
      const chain = buildCausalChain(outcome.value.correlationId, recorded)

      expect(chain.orphaned).toEqual([])
      expect(chain.roots).toHaveLength(1)
      expect(chain.roots[0]?.event.type).toBe('guardian.decided')

      const explanation = explain(chain, { depth: 'full' })
      expect(unsupportedClaims(explanation, chain)).toEqual([])
    })
  })

  describe('when the decision cannot be recorded', () => {
    /**
     * The same composition `openContext` performs, with one store broken.
     *
     * Built by hand rather than injected through `openContext`, because the
     * context deliberately offers no seam for replacing a Guardian store — a
     * production path that let a caller swap the decisions store would be a
     * path that let one be silently dropped.
     */
    function withBrokenDecisions() {
      const storage = openStorage({
        eventsDbPath: config.paths.eventsDb,
        mainDbPath: config.paths.mainDb,
        keys,
        fieldKeyReference: config.keychain.fieldKeyRef,
      })

      if (!storage.ok) throw new Error(storage.error.message)

      const bus = registerClerkEventTypes(
        createEventBus({ storage: storage.value, principalId: config.principalId }),
      )

      const policies = loadPolicySet(POLICY_DIR)
      if (!policies.ok) throw new Error(policies.error.message)

      const capabilities = createCapabilityIssuer({
        store: storage.value.guardian.capabilities,
        keys,
      })
      if (!capabilities.ok) throw new Error(capabilities.error.message)

      const authorizing = createAuthorizingClerk({
        guardian: createGuardian({
          policies: policies.value,
          capabilities: capabilities.value,
          grants: createGrantRegistry({ store: storage.value.guardian.grants }),
        }),
        clerk: createApprovalClerk({ approvals: storage.value.guardian.approvals, bus }),
        bus,
        decisions: {
          record: () =>
            err(
              fridayError({
                code: 'STORAGE_WRITE_FAILED',
                message: 'the decisions table is deliberately broken for this test',
              }),
            ),
        },
      })

      return { authorizing, storage: storage.value }
    }

    it('returns the store’s own error and records no event at all', async () => {
      const { authorizing, storage } = withBrokenDecisions()

      try {
        const outcome = await runStartupSelfCheck({
          authorizing,
          events: storage.events,
          principalId: config.principalId,
          correlationId: '01890000-0000-7000-8000-000000000001',
        })

        expect(outcome.ok).toBe(false)
        if (outcome.ok) throw new Error('the self-check should not have succeeded')

        // ★ The store's typed reason, not the rollback that followed it, and
        // not a `deny`. An infrastructure failure is never a policy answer.
        expect(outcome.error.code).toBe('STORAGE_WRITE_FAILED')
      } finally {
        storage.close()
      }

      // The state write threw inside the append transaction, so the event
      // rolled back with it. Neither happened.
      expect(eventsFor('01890000-0000-7000-8000-000000000001')).toEqual([])
    })
  })

  describe('when the trail does not verify', () => {
    /** A real check, so the decision and the verification are both genuine. */
    async function checked(): Promise<SelfCheckOutcome> {
      const context = open()

      const outcome = await runStartupSelfCheck({
        authorizing: context.authorizing,
        events: context.context.events,
        principalId: config.principalId,
      })

      if (!outcome.ok) throw new Error(outcome.error.message)

      return outcome.value
    }

    it('finds nothing to stop for when the trail is intact', async () => {
      expect(fatalProblem(await checked())).toBeNull()
    })

    it('finds nothing to stop for when the check never ran', async () => {
      const { decision, correlationId } = await checked()

      // A refusal carries no verification, and a refusal is the owner's rules
      // working. Stopping here would turn their rule into a fault.
      expect(fatalProblem({ decision, correlationId })).toBeNull()
    })

    it('stops FRIDAY, and says where the trail broke', async () => {
      const outcome = await checked()
      if (outcome.verification === undefined) throw new Error('the check did not run')

      // ★ The verdict `verifyChain` returns on a damaged log, over a real one.
      // Damaging the file belongs to `packages/storage`, which owns the
      // database and tests the detection; what is asserted here is that FRIDAY
      // acts on that verdict rather than starting anyway.
      const fatal = fatalProblem({
        ...outcome,
        verification: {
          ...outcome.verification,
          intact: false,
          sequenceIntact: false,
          brokenAtSeq: 1,
          reason: 'event 1 is missing.',
        },
      })

      if (fatal === null) throw new Error('a trail that does not verify must stop her')

      expect(fatal.code).toBe('CHAIN_BROKEN')
      expect(fatal.message).toContain('event 1 is missing.')
      expect(fatal.detail).toMatchObject({ brokenAtSeq: 1, sequenceIntact: false })
    })
  })
})
