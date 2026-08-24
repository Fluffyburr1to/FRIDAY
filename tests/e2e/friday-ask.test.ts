import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough } from 'node:stream'
import { createOutput, run, runAsk } from '@friday/cli'
import { type FridayConfig, loadConfig } from '@friday/config'
import type { FridayError } from '@friday/contracts'
import { type OpenedContext, openContext } from '@friday/core'
import { CAPABILITY_KEY_REFERENCE } from '@friday/guardian'
import { createInMemoryKeyProvider, KEY_LENGTH_BYTES, type KeyProvider } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ `friday ask` — the whole system, through the door the owner uses.
 *
 * This is the M5 acceptance test. It runs the real shipped things: the real
 * department manifest on disk, the real Guardian rules in
 * `packages/guardian/policies`, the real clerk, the real event bus, real
 * SQLite, and the real CLI entry point. Nothing here is a stand-in for a
 * component — the only injected thing is the key provider, which is ADR-0020's
 * sanctioned seam and the only way to run this without the machine's Keychain.
 *
 * ★ The property under test is not "it works". It is that **the CLI has no
 * path of its own**: what runs when the owner types `friday ask` is the same
 * registry, the same Guardian, the same executor and the same log that
 * everything else uses. A second path would be a second set of rules, and the
 * quieter one always wins.
 *
 * Reference: docs/01-bible/12-chief-of-staff.md · docs/01-bible/39-roadmap.md
 */

const POLICIES = new URL('../../packages/guardian/policies', import.meta.url).pathname
const DEPARTMENTS = new URL('../../departments', import.meta.url).pathname

let directory: string
let config: FridayConfig
let keys: KeyProvider
const environment: Record<string, string | undefined> = {}

function remember(name: string, value: string) {
  environment[name] = process.env[name]
  process.env[name] = value
}

/** Runs the real CLI and captures what the owner would have seen. */
async function cli(...argv: string[]) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  const out: string[] = []
  const problems: string[] = []

  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()))
  stderr.on('data', (chunk: Buffer) => problems.push(chunk.toString()))

  const code = await run({ argv, stdout, stderr })

  return { code, out: out.join(''), problems: problems.join('') }
}

/**
 * Unwraps a `Result`, or fails the test with the reason it carried.
 *
 * A test that swallowed the reason would report "expected true, got false"
 * about a storage failure three layers down, and the next person would spend
 * an afternoon on it.
 */
function must<T>(result: { ok: true; value: T } | { ok: false; error: FridayError }): T {
  if (!result.ok) throw new Error(result.error.message)

  return result.value
}

/** Opens the same context the CLI opens, to look at what it left behind. */
function inspect(): OpenedContext {
  const opened = openContext({ config, keys })
  if (!opened.ok) throw new Error(opened.error.message)

  return opened.value
}

/**
 * Runs the real `friday ask` command.
 *
 * ★ The command itself, not a re-implementation of it: `runAsk` opens the
 * context, takes the session, and prints. The only thing supplied here is the
 * key provider — ADR-0020's seam, and the reason a test can run this at all
 * without the machine's Keychain.
 */
async function ask(options: {
  utterance?: string
  resume?: string
  approve?: boolean
  why?: string
}) {
  const stdout = new PassThrough()
  const stderr = new PassThrough()

  const out: string[] = []
  const problems: string[] = []

  stdout.on('data', (chunk: Buffer) => out.push(chunk.toString()))
  stderr.on('data', (chunk: Buffer) => problems.push(chunk.toString()))

  const code = await runAsk({
    context: { config, keys, out: createOutput({ json: false, stdout, stderr }) },
    ...options,
  })

  return { code, out: out.join(''), problems: problems.join('') }
}

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'friday-ask-'))

  remember('FRIDAY_DATA_DIR', directory)
  remember('FRIDAY_POLICIES_DIR', POLICIES)

  // ★ The manifest that actually ships, read off disk. Pointing this at a
  // fixture would leave the shipped one untested — and the manifest is the
  // security boundary, so it is the thing that most needs to be the real one.
  remember('FRIDAY_DEPARTMENTS_DIR', DEPARTMENTS)

  const loaded = loadConfig({})
  if (!loaded.ok) throw new Error(loaded.error.message)

  config = loaded.value

  keys = createInMemoryKeyProvider({
    [config.keychain.fieldKeyRef]: Buffer.alloc(KEY_LENGTH_BYTES, 7).toString('base64'),
    [CAPABILITY_KEY_REFERENCE]: Buffer.alloc(KEY_LENGTH_BYTES, 9).toString('base64'),
  })
})

afterEach(() => {
  for (const [name, value] of Object.entries(environment)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }

  rmSync(directory, { recursive: true, force: true })
})

describe('the way in', () => {
  it('★ shows the plan before anything runs', async () => {
    // ★ Chapter 12's promise, and it is unconditional. The plan is printed
    // every time — not only when FRIDAY judges it worth showing, which is a
    // promise the owner cannot rely on.
    const opened = inspect()

    try {
      if (!opened.ask.ok) throw new Error(opened.ask.error.message)

      const proposed = await opened.ask.value.propose('check my records')

      expect(proposed.ok).toBe(true)
      if (!proposed.ok) return

      expect(proposed.value.steps).toHaveLength(1)
      expect(proposed.value.steps[0]?.actionType).toBe('diagnostics.self-check.run')

      // ★ Nothing ran. The plan exists, on disk, and every step is pending.
      expect(proposed.value.progress.planStatus).toBe('draft')
      expect(Object.values(proposed.value.progress.stepStatuses)).toEqual(['pending'])
    } finally {
      opened.close()
    }
  })

  it('★ runs a whole operation through the real Guardian and the real department', async () => {
    const opened = inspect()

    try {
      if (!opened.ask.ok) throw new Error(opened.ask.error.message)

      const session = opened.ask.value
      const proposed = await session.propose('check my records')
      if (!proposed.ok) throw new Error(proposed.error.message)

      const outcome = await session.run(proposed.value)

      expect(outcome.ok).toBe(true)
      if (!outcome.ok) return

      if (outcome.value.kind === 'failed')
        throw new Error(`${outcome.value.because} :: ${JSON.stringify(outcome.value.error)}`)

      expect(outcome.value.kind).toBe('completed')

      // ★ The explanation is read back out of the log, not composed from
      // anything this run remembered.
      if (outcome.value.kind !== 'completed') return

      expect(outcome.value.explanation.asked).toBe('check my records')

      const said = outcome.value.explanation.detail.lines.map((line) => line.text)

      expect(said.some((line) => line.includes('worked out how to do this'))).toBe(true)
      expect(said.some((line) => line.includes('Done:'))).toBe(true)
    } finally {
      opened.close()
    }
  })

  it('★ the Guardian really decided, and said so in the log', async () => {
    // ★ Not "a decision was made somewhere". The real Guardian published
    // `guardian.decided` under this plan's correlation id, naming the rule
    // from the shipped policy file.
    const opened = inspect()

    try {
      if (!opened.ask.ok) throw new Error(opened.ask.error.message)

      const session = opened.ask.value
      const proposed = await session.propose('check my records')
      if (!proposed.ok) throw new Error(proposed.error.message)

      await session.run(proposed.value)

      const events = opened.context.events.readAfter({ afterSeq: 0, limit: 200 })
      if (!events.ok) throw new Error('the log would not read back')

      const decided = events.value.filter((event) => event.type === 'guardian.decided')

      expect(decided).toHaveLength(1)
      expect(decided[0]?.payload.action).toBe('diagnostics.self-check.run')
      expect(decided[0]?.payload.matchedPolicies).toEqual(['agents-may-run-diagnostics'])
    } finally {
      opened.close()
    }
  })

  it('★ stops for the owner on the capability that must always ask', async () => {
    // ★ The other half of the M5 done-when, and it goes through the shipped
    // rule that gives `operations.log.compact` no standing-grant exemption.
    // Nothing is performed, and the plan is left waiting rather than failed.
    const opened = inspect()

    try {
      const session = must(opened.ask)
      const proposed = must(await session.propose('compact the event log'))

      expect(proposed.steps[0]?.actionType).toBe('operations.log.compact')

      // ★ TWO gates, and the first one fires before any step is considered.
      // The capability is classified `high` in the manifest, so the owner sees
      // the plan before it starts. Nothing has been asked of the Guardian yet.
      expect(must(await session.run(proposed)).kind).toBe('awaiting_plan_approval')

      const approved = must(await session.approveShape(proposed.plan.id))

      // ★ Approving the SHAPE released no step. Every one is still pending and
      // still owes the Guardian a question — which is the whole distinction
      // between reviewing work and authorising it.
      expect(Object.values(approved.progress.stepStatuses)).toEqual(['pending'])

      const outcome = must(await session.run(approved))

      expect(outcome.kind).toBe('awaiting_approval')
      if (outcome.kind !== 'awaiting_approval') return

      // ★ And it survives being put down. Read back off disk, the plan is
      // still waiting on that same step.
      const reopened = must(await session.reopen(proposed.plan.id))

      expect(reopened.progress.stepStatuses[outcome.stepId]).toBe('awaiting_approval')
    } finally {
      opened.close()
    }
  })

  it('★ answering releases that one step, and it asks the Guardian again', async () => {
    const opened = inspect()

    try {
      const session = must(opened.ask)
      const proposed = must(await session.propose('compact the event log'))

      must(await session.run(proposed))

      const approved = must(await session.approveShape(proposed.plan.id))
      const stopped = must(await session.run(approved))

      if (stopped.kind !== 'awaiting_approval') throw new Error(`expected a suspension`)

      const answered = must(await session.answerStep(proposed.plan.id, stopped.stepId))

      must(await session.run(answered))

      // ★ It asked again, and the shipped rule said "ask the owner" again —
      // because the owner's answer unblocked the QUESTION and was never itself
      // the permission. This is the invariant the whole milestone is arranged
      // around, seen from outside.
      const decided = must(opened.context.events.readAfter({ afterSeq: 0, limit: 200 })).filter(
        (event) => event.type === 'guardian.decided',
      )

      expect(decided.length).toBeGreaterThanOrEqual(2)
      expect(decided.every((event) => event.payload.action === 'operations.log.compact')).toBe(true)
    } finally {
      opened.close()
    }
  })

  it('★ refuses to guess when nothing she has matches what was asked', async () => {
    // ★ Chapter 12's ambiguity ladder ends in asking, never in the nearest
    // capability. A planner that picked something because something had to be
    // picked would be the most dangerous thing in this file.
    const opened = inspect()

    try {
      if (!opened.ask.ok) throw new Error(opened.ask.error.message)

      const proposed = await opened.ask.value.propose('book me a flight to Lisbon')

      expect(proposed.ok).toBe(false)
      if (proposed.ok) return

      expect(proposed.error.message.length).toBeGreaterThan(0)
    } finally {
      opened.close()
    }
  })
})

describe('the command itself', () => {
  it('★ asks for something to do rather than assuming', async () => {
    const { code, problems } = await cli('ask')

    expect(code).not.toBe(0)
    expect(problems).toContain('Tell FRIDAY what you want')
  })

  it('lists ask in its own help', async () => {
    const { problems } = await cli('--help')

    expect(problems).toContain('friday ask')
  })

  it('★ prints the plan, runs it, and explains it', async () => {
    const { code, out } = await ask({ utterance: 'check my records' })

    // ★ The plan appears BEFORE the account of what happened. That ordering is
    // the promise: the owner sees the work described, then sees it done.
    expect(out.indexOf("FRIDAY's plan")).toBeLessThan(out.indexOf('Done:'))
    expect(out).toContain('1. Check that FRIDAY is internally consistent')
    expect(code).toBe(0)
  })

  it('★ stops, says what it needs, and hands back the exact command', async () => {
    // ★ A plan that stopped is useless if the owner cannot find it again — and
    // a non-zero exit here would make a script treat "she asked you" as a
    // failure, which is how "just add --approve to everything" starts.
    const { code, out } = await ask({ utterance: 'compact the event log' })

    expect(code).toBe(0)
    expect(out).toContain('FRIDAY stopped before starting')
    expect(out).toMatch(/friday ask --resume [0-9a-f-]{36} --approve/)
  })

  it('★ carries on from where it stopped, in a separate invocation', async () => {
    // ★ Two commands, minutes or days apart. Nothing is held in memory between
    // them: the second reads the plan off disk and picks it up.
    const started = await ask({ utterance: 'compact the event log' })
    const planId = /--resume ([0-9a-f-]{36})/.exec(started.out)?.[1]

    if (planId === undefined) throw new Error(`no plan id printed: ${started.out}`)

    const answered = await ask({ resume: planId, approve: true })

    // ★ And she asked AGAIN, about the step this time. The owner approving the
    // shape did not approve the action inside it.
    expect(answered.code).toBe(0)
    expect(answered.out).toContain('FRIDAY stopped and needs you')
    expect(answered.out).toContain('Compact the event log')
  })

  it('★ explains a plan from its own record, afterwards', async () => {
    const started = await ask({ utterance: 'check my records' })

    const opened = inspect()
    let planId: string

    try {
      const plans = opened.context.events.readAfter({ afterSeq: 0, limit: 200 })
      if (!plans.ok) throw new Error('the log would not read back')

      const created = plans.value.find((event) => event.type === 'plan.created')
      planId = String(created?.payload.planId)
    } finally {
      opened.close()
    }

    expect(started.code).toBe(0)

    const explained = await ask({ why: planId })

    expect(explained.code).toBe(0)
    expect(explained.out).toContain('You asked: check my records')
    expect(explained.out).toContain('The plan finished.')
  })
})
