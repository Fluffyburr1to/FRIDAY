import {
  buildCausalChain,
  createAuditor,
  EXPLANATION_DEPTHS,
  explain,
  flattenChain,
  PHRASED_TYPES,
  significanceOf,
  unsupportedClaims,
} from '@friday/audit'
import {
  createEventRegistry,
  type FridayEvent,
  registerCoreEventTypes,
  registerGuardianEventTypes,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const CORRELATION = uuidv7()
const PRINCIPAL = 'usr_tyler'

let seq = 0

/** An event as the log would have recorded it. */
function event(
  type: string,
  payload: Record<string, unknown> = {},
  causationId?: string,
): FridayEvent {
  seq += 1

  return {
    seq,
    id: uuidv7(1_700_000_000_000 + seq),
    type,
    occurredAt: 1_700_000_000_000 + seq,
    recordedAt: 1_700_000_000_000 + seq,
    actor: { type: 'agent', id: 'agent:communications/send' },
    principalId: PRINCIPAL,
    correlationId: CORRELATION,
    payload,
    payloadVersion: 1,
    sensitivity: 'internal',
    integrityHash: 'a'.repeat(64),
    ...(causationId === undefined ? {} : { causationId }),
  }
}

/** The story M2 tells: an agent tried to send mail and had to ask. */
function sendingMail() {
  seq = 0

  const started = event('system.started', { version: '0', nodeVersion: '24', pid: 1 })
  const issued = event('capability.issued', { action: 'connector.gmail.message.send' }, started.id)
  const used = event('capability.used', { action: 'connector.gmail.message.send' }, issued.id)
  const decided = event(
    'guardian.decided',
    { summary: 'Sending a message needs your approval, because it cannot be unsent.' },
    used.id,
  )
  const asked = event(
    'approval.requested',
    { title: 'Send a follow-up email to Sarah Chen' },
    decided.id,
  )
  const granted = event('approval.granted', { respondedVia: 'desktop' }, asked.id)

  return { events: [started, issued, used, decided, asked, granted], asked, granted }
}

describe('rebuilding what caused what', () => {
  it('places every event under the one that caused it', () => {
    const { events } = sendingMail()
    const chain = buildCausalChain(CORRELATION, events)

    expect(chain.roots).toHaveLength(1)
    expect(chain.orphaned).toEqual([])
    expect(flattenChain(chain)).toHaveLength(events.length)

    // A straight line of causation, so each node has exactly one child until
    // the end.
    const depths = flattenChain(chain).map((node) => node.depth)
    expect(depths).toEqual([0, 1, 2, 3, 4, 5])
  })

  it('rebuilds the same tree whatever order the events arrive in', () => {
    const { events } = sendingMail()

    const forwards = buildCausalChain(CORRELATION, events)
    const shuffled = buildCausalChain(CORRELATION, [...events].reverse())

    expect(shuffled).toEqual(forwards)
  })

  it('reports an event whose cause is missing rather than dropping it', () => {
    // ★ The failure this guards against is silent omission. An explanation
    // that quietly left out part of what happened would be invisible, and
    // would be exactly the thing this package exists to prevent.
    seq = 0
    const lonely = event('approval.granted', { respondedVia: 'desktop' }, uuidv7())

    const chain = buildCausalChain(CORRELATION, [lonely])

    expect(chain.roots).toEqual([])
    expect(chain.orphaned.map((e) => e.id)).toEqual([lonely.id])
  })

  it('does not spin on a log where two events cause each other', () => {
    // Impossible in a healthy log — sequence order forbids it — so this is
    // about a damaged one. Neither event is reachable from a root, and both
    // are reported rather than lost or looped over.
    seq = 0
    const first = event('system.started')
    const second = event('system.stopped', {}, first.id)
    const cyclic = { ...first, causationId: second.id }

    const chain = buildCausalChain(CORRELATION, [cyclic, second])

    expect(chain.roots).toEqual([])
    expect(chain.orphaned).toHaveLength(2)
  })

  it('handles an operation with nothing in it', () => {
    const chain = buildCausalChain(CORRELATION, [])

    expect(chain.events).toEqual([])
    expect(chain.roots).toEqual([])
  })
})

describe('composing an explanation', () => {
  it('leads with what the operation ended up doing', () => {
    // The last headline, not the first. "It began" is not what someone
    // glancing at this needs.
    const { events } = sendingMail()
    const explanation = explain(buildCausalChain(CORRELATION, events), { depth: 'standard' })

    expect(explanation.headline).toContain('You approved it on the desktop')
  })

  it('says less at each shallower depth, and never more', () => {
    const { events } = sendingMail()
    const chain = buildCausalChain(CORRELATION, events)

    const counts = EXPLANATION_DEPTHS.map((depth) => explain(chain, { depth }).lines.length)

    expect(counts[0]).toBeLessThan(counts[1] ?? 0)
    expect(counts[1]).toBeLessThan(counts[2] ?? 0)
    expect(counts[2]).toBe(events.length)
  })

  it('reports what it left out rather than trimming silently', () => {
    const { events } = sendingMail()
    const explanation = explain(buildCausalChain(CORRELATION, events), { depth: 'summary' })

    expect(explanation.omitted.belowDepth).toBe(events.length - explanation.lines.length)
  })

  it('quotes the Guardian rather than describing its decision again', () => {
    // The Guardian already composed a sentence from the rules the owner wrote.
    // A second account of the same decision would drift from the first.
    const { events } = sendingMail()
    const explanation = explain(buildCausalChain(CORRELATION, events), { depth: 'full' })

    expect(explanation.lines.map((line) => line.text)).toContain(
      'Sending a message needs your approval, because it cannot be unsent.',
    )
  })

  it('falls back to a type’s registered description when nothing phrases it', () => {
    seq = 0
    const registry = registerGuardianEventTypes(registerCoreEventTypes(createEventRegistry()))
    const chain = buildCausalChain(CORRELATION, [event('diagnostics.chain.verified', {})])

    const explanation = explain(chain, { depth: 'full', registry })

    expect(explanation.lines[0]?.text).toBe(
      'The audit log’s integrity chain was checked end to end.',
    )
  })

  it('counts an undescribable event instead of printing its type name', () => {
    // The owner does not read code. `some.unknown.thing` in a sentence is
    // worse than an honest gap.
    seq = 0
    const chain = buildCausalChain(CORRELATION, [event('some.unknown.thing', {})])
    const explanation = explain(chain, { depth: 'full' })

    expect(explanation.lines).toEqual([])
    expect(explanation.omitted.unphrased).toEqual(['some.unknown.thing'])
    expect(explanation.headline).not.toContain('some.unknown.thing')
  })

  it('says so plainly when there is no record at all', () => {
    const explanation = explain(buildCausalChain(CORRELATION, []), { depth: 'standard' })

    expect(explanation.headline).toBe('There is no record of this.')
  })

  it('falls back to the first line when nothing is a headline', () => {
    seq = 0
    const chain = buildCausalChain(CORRELATION, [
      event('capability.issued', { action: 'memory.read' }),
    ])

    expect(explain(chain, { depth: 'full' }).headline).toContain('permission slip')
  })

  it('describes a declined approval with the reason the owner gave', () => {
    seq = 0
    const chain = buildCausalChain(CORRELATION, [
      event('approval.declined', { respondedVia: 'desktop', reason: 'Wrong Sarah.' }),
    ])

    expect(explain(chain, { depth: 'full' }).headline).toBe(
      'You declined it on the desktop. Your reason: Wrong Sarah.',
    )
  })

  it('describes an expiry as inaction rather than as an answer', () => {
    seq = 0
    const chain = buildCausalChain(CORRELATION, [event('approval.expired', {})])

    expect(explain(chain, { depth: 'full' }).headline).toBe(
      'Nobody answered in time, so FRIDAY did not act.',
    )
  })

  it('names the standing permission that meant you were not asked', () => {
    seq = 0
    const chain = buildCausalChain(CORRELATION, [
      event('approval.auto_granted', { grantReason: 'Labelling my own inbox is fine.' }),
    ])

    expect(explain(chain, { depth: 'full' }).headline).toContain('Labelling my own inbox is fine')
  })
})

describe('every claim maps to a recorded event', () => {
  it('holds for every depth', () => {
    // ★ The invariant this package exists for. A line with no supporting event
    // is a story, and Principle 7 asks for the other thing.
    const { events } = sendingMail()
    const chain = buildCausalChain(CORRELATION, events)

    for (const depth of EXPLANATION_DEPTHS) {
      const explanation = explain(chain, { depth })

      expect(unsupportedClaims(explanation, chain)).toEqual([])
      for (const line of explanation.lines) {
        expect(line.eventId.length).toBeGreaterThan(0)
        expect(chain.events.some((e) => e.id === line.eventId)).toBe(true)
      }
    }
  })

  it('catches a claim that was not derived from the record', () => {
    // Proves the check can fail. When a model is eventually used to phrase
    // these more naturally, this is what keeps that safe.
    const { events } = sendingMail()
    const chain = buildCausalChain(CORRELATION, events)
    const explanation = explain(chain, { depth: 'full' })

    const tampered = {
      ...explanation,
      lines: [
        ...explanation.lines,
        {
          text: 'FRIDAY also tidied your inbox.',
          eventId: uuidv7(),
          eventType: 'invented',
          seq: 99,
          occurredAt: 0,
          depth: 0,
        },
      ],
    }

    expect(unsupportedClaims(tampered, chain)).toEqual(['FRIDAY also tidied your inbox.'])
  })
})

describe('significance', () => {
  it('treats an unphrased type as detail rather than as a headline', () => {
    expect(significanceOf('nobody.wrote.this')).toBe('detail')
  })

  it('phrases every Guardian event type the owner would see', () => {
    // These are the ones that appear when FRIDAY asks, is answered, or refuses.
    for (const type of [
      'guardian.decided',
      'approval.requested',
      'approval.granted',
      'approval.declined',
      'approval.expired',
      'approval.auto_granted',
    ]) {
      expect(PHRASED_TYPES).toContain(type)
    }
  })
})

describe('the auditor over a source', () => {
  it('reads an operation and explains it', () => {
    const { events } = sendingMail()
    const auditor = createAuditor({
      events: { readByCorrelation: () => ({ ok: true, value: events }) },
    })

    const why = auditor.why({ correlationId: CORRELATION })

    expect(why.ok).toBe(true)
    if (!why.ok) return
    expect(why.value.headline).toContain('You approved it')
    expect(why.value.depth).toBe('standard')
  })

  it('reports a log it could not read, rather than an empty story', () => {
    // An unreadable log producing "nothing happened" would be the worst
    // possible answer: confidently wrong about the past.
    const auditor = createAuditor({
      events: {
        readByCorrelation: () => ({
          ok: false,
          error: { code: 'STORAGE_UNAVAILABLE', message: 'the log could not be read' },
        }),
      },
    })

    expect(auditor.why({ correlationId: CORRELATION }).ok).toBe(false)
    expect(auditor.reconstruct({ correlationId: CORRELATION }).ok).toBe(false)
  })

  it('honours the depth it is asked for', () => {
    const { events } = sendingMail()
    const auditor = createAuditor({
      events: { readByCorrelation: () => ({ ok: true, value: events }) },
    })

    const summary = auditor.why({ correlationId: CORRELATION, depth: 'summary' })
    const full = auditor.why({ correlationId: CORRELATION, depth: 'full' })

    expect(summary.ok && full.ok && summary.value.lines.length < full.value.lines.length).toBe(true)
  })
})
