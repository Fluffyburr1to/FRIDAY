import { AmbiguitySchema, hasAmbiguities, type Intent, IntentSchema } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * Intent — FRIDAY's reading of what was asked.
 *
 * The tests worth having here are the ones that pin down what the shape is
 * *for*: it is an interpretation, produced by a model, and the things it
 * declined to decide are as much a part of it as the things it did.
 */

function anIntent(overrides: Partial<Intent> = {}): Intent {
  return {
    kind: 'operations.self-check',
    confidence: 0.9,
    entities: {},
    ambiguities: [],
    ...overrides,
  }
}

describe('the intent contract', () => {
  it('accepts a parse that resolved everything', () => {
    expect(IntentSchema.safeParse(anIntent()).success).toBe(true)
  })

  it('carries what the parser would not decide', () => {
    const intent = anIntent({
      ambiguities: [
        { field: 'person', question: 'Which Sarah?', candidates: ['Sarah Chen', 'Sarah Okafor'] },
      ],
    })

    expect(IntentSchema.safeParse(intent).success).toBe(true)
    expect(hasAmbiguities(intent)).toBe(true)
  })

  it('allows an ambiguity with no candidates at all', () => {
    // ★ "I do not know, and I have nothing plausible to offer" is a different
    // and more honest answer than one low-confidence guess. The schema must
    // not force the parser to invent a candidate to be well-formed.
    const parsed = AmbiguitySchema.safeParse({
      field: 'recipient',
      question: 'Who should this go to?',
      candidates: [],
    })

    expect(parsed.success).toBe(true)
  })

  it('says an intent with no ambiguities left nothing open', () => {
    expect(hasAmbiguities(anIntent())).toBe(false)
  })

  it('rejects a confidence outside 0 to 1', () => {
    expect(IntentSchema.safeParse(anIntent({ confidence: 1.4 })).success).toBe(false)
    expect(IntentSchema.safeParse(anIntent({ confidence: -0.1 })).success).toBe(false)
  })

  it('rejects an intent with no kind', () => {
    expect(IntentSchema.safeParse(anIntent({ kind: '' })).success).toBe(false)
  })

  it('rejects an ambiguity that asks nothing', () => {
    // An ambiguity with no question cannot be put to the owner, which is the
    // only thing it exists to do.
    expect(
      AmbiguitySchema.safeParse({ field: 'person', question: '', candidates: [] }).success,
    ).toBe(false)
  })

  it('takes entities of any shape, because capabilities differ', () => {
    const intent = anIntent({
      entities: { when: '2026-08-20', attendees: ['a', 'b'], nested: { deep: true } },
    })

    expect(IntentSchema.safeParse(intent).success).toBe(true)
  })
})
