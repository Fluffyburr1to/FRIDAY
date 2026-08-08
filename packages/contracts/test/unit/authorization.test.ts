import {
  ActionPatternSchema,
  ActionSchema,
  isUnboundedScope,
  matchesAction,
  matchesResource,
  ResourcePatternSchema,
  ResourceSchema,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

describe('action names', () => {
  it('accepts two to four lowercase dotted segments', () => {
    for (const action of [
      'memory.read',
      'calendar.event.create',
      'connector.gmail.message.send',
      'plan.step.retried',
    ]) {
      expect(ActionSchema.safeParse(action).success).toBe(true)
    }
  })

  it('accepts inner hyphens, because agent and step names carry them', () => {
    expect(ActionSchema.safeParse('memory.contact-list.read').success).toBe(true)
  })

  it('rejects anything that is not a well-formed action', () => {
    for (const bad of [
      'memory', // one segment says nothing about what is being done
      'a.b.c.d.e', // five segments is a typo, not a novel action
      'Memory.read', // capitals
      'memory..read', // empty segment
      'memory.read.', // trailing dot
      '.memory.read', // leading dot
      'memory.*', // a pattern is not an action
      'memory read', // whitespace
      '1memory.read', // segments start with a letter
      'memory.-read', // a hyphen never starts a segment
    ]) {
      expect(ActionSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('action patterns', () => {
  it('accepts * for whole segments and * alone', () => {
    for (const pattern of ['*', 'connector.*.write', '*.event.create', 'memory.*']) {
      expect(ActionPatternSchema.safeParse(pattern).success).toBe(true)
    }
  })

  it('rejects partial-segment wildcards', () => {
    // `connector.gm*.write` would make matching a substring question, and
    // substring matching on permissions is how a grant ends up wider than the
    // owner read it as being.
    for (const bad of ['connector.gm*.write', 'memory.**', '**']) {
      expect(ActionPatternSchema.safeParse(bad).success).toBe(false)
    }
  })

  it('matches a wildcard segment against exactly one segment', () => {
    expect(matchesAction('connector.*.write', 'connector.gmail.write')).toBe(true)
    expect(matchesAction('connector.*', 'connector.gmail.write')).toBe(false)
    expect(matchesAction('connector.*.*', 'connector.gmail.write')).toBe(true)
  })

  it('matches * against everything and an exact pattern against itself', () => {
    expect(matchesAction('*', 'anything.at.all')).toBe(true)
    expect(matchesAction('memory.read', 'memory.read')).toBe(true)
  })

  it('does not match across a different segment count', () => {
    expect(matchesAction('memory.read', 'memory.read.all')).toBe(false)
    expect(matchesAction('memory.read.all', 'memory.read')).toBe(false)
  })

  it('does not match a different segment', () => {
    expect(matchesAction('connector.gmail.write', 'connector.slack.write')).toBe(false)
  })
})

describe('resources', () => {
  it('accepts scheme and path', () => {
    for (const resource of [
      'memory:contacts',
      'memory:contacts/sarah-chen',
      'calendar:personal/events/01J8XKQ',
      'connector:gmail/messages/CAF=abc@mail.example',
    ]) {
      expect(ResourceSchema.safeParse(resource).success).toBe(true)
    }
  })

  it('rejects a concrete resource that smuggles a wildcard', () => {
    // The important one in this list. A resource is compared against patterns,
    // so a `*` inside a supposedly concrete value would match things the
    // caller never named.
    expect(ResourceSchema.safeParse('memory:contacts/*').success).toBe(false)
  })

  it('rejects malformed resources', () => {
    for (const bad of [
      'memory', // no scheme separator
      ':contacts', // no scheme
      'Memory:contacts', // schemes are lowercase
      'memory:', // no path
      'memory:contacts/', // empty trailing segment
      'memory:contacts//sarah', // empty inner segment
      'memory:contacts sarah', // whitespace
    ]) {
      expect(ResourceSchema.safeParse(bad).success).toBe(false)
    }
  })
})

describe('resource patterns', () => {
  it('accepts one-segment and subtree wildcards', () => {
    for (const pattern of [
      '*',
      'memory:*',
      'memory:**',
      'memory:contacts/*',
      'memory:contacts/**',
      'calendar:personal/*/attendees',
    ]) {
      expect(ResourcePatternSchema.safeParse(pattern).success).toBe(true)
    }
  })

  it('rejects a subtree wildcard anywhere but the end', () => {
    expect(ResourcePatternSchema.safeParse('memory:**/sarah').success).toBe(false)
  })

  it('matches * against one segment and ** against a subtree', () => {
    expect(matchesResource('memory:contacts/*', 'memory:contacts/sarah-chen')).toBe(true)
    expect(matchesResource('memory:contacts/*', 'memory:contacts/work/sarah')).toBe(false)
    expect(matchesResource('memory:contacts/**', 'memory:contacts/work/sarah')).toBe(true)
  })

  it('does not let ** cover the node it hangs from', () => {
    // `contacts/**` is a statement about what is inside `contacts`. Reading it
    // as also covering `contacts` itself would widen every subtree grant by one
    // node, silently.
    expect(matchesResource('memory:contacts/**', 'memory:contacts')).toBe(false)
    expect(matchesResource('memory:**', 'memory:contacts')).toBe(true)
  })

  it('never matches across schemes', () => {
    expect(matchesResource('memory:*', 'calendar:personal')).toBe(false)
    expect(matchesResource('memory:**', 'calendar:personal/events')).toBe(false)
  })

  it('matches * against everything and an exact pattern against itself', () => {
    expect(matchesResource('*', 'anything:at/all')).toBe(true)
    expect(matchesResource('memory:contacts', 'memory:contacts')).toBe(true)
  })

  it('rejects a value with no scheme separator on either side', () => {
    expect(matchesResource('memory:contacts', 'contacts')).toBe(false)
    expect(matchesResource('contacts', 'memory:contacts')).toBe(false)
  })

  it('does not match when the pattern is longer than the resource', () => {
    expect(matchesResource('memory:contacts/work/*', 'memory:contacts')).toBe(false)
    expect(matchesResource('memory:contacts/work', 'memory:contacts')).toBe(false)
  })

  it('does not match when the resource is longer than the pattern', () => {
    expect(matchesResource('memory:contacts', 'memory:contacts/sarah')).toBe(false)
  })

  it('does not match a different segment', () => {
    expect(matchesResource('memory:contacts/sarah', 'memory:contacts/alex')).toBe(false)
  })
})

describe('unbounded scope', () => {
  it('is the pair that Chapter 19 rejects as an abdication', () => {
    expect(isUnboundedScope('*', '*')).toBe(true)
  })

  it('is not triggered when either side is narrowed at all', () => {
    expect(isUnboundedScope('*', 'memory:**')).toBe(false)
    expect(isUnboundedScope('memory.*', '*')).toBe(false)
    expect(isUnboundedScope('memory.read', 'memory:contacts')).toBe(false)
  })
})
