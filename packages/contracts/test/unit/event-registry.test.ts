import { createEventRegistry } from '@friday/contracts'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'

const PayloadSchema = z.object({ note: z.string() })

describe('createEventRegistry', () => {
  it('starts empty', () => {
    const registry = createEventRegistry()

    expect(registry.list()).toEqual([])
    expect(registry.has('test.event.emitted')).toBe(false)
  })

  it('registers a type and reports it', () => {
    const registry = createEventRegistry().register({
      type: 'test.event.emitted',
      payloadVersion: 1,
      schema: PayloadSchema,
      maxSensitivity: 'internal',
      description: 'A test event.',
    })

    expect(registry.has('test.event.emitted')).toBe(true)
    expect(registry.list()).toHaveLength(1)
  })

  it('finds a type registered behind another one', () => {
    // `has` scans every definition. If it only ever saw a one-entry registry
    // the loop would look correct while never having iterated past the first.
    const registry = createEventRegistry()
      .register({
        type: 'system.started',
        payloadVersion: 1,
        schema: z.object({}),
        maxSensitivity: 'internal',
        description: 'First.',
      })
      .register({
        type: 'test.event.emitted',
        payloadVersion: 1,
        schema: PayloadSchema,
        maxSensitivity: 'internal',
        description: 'Second.',
      })

    expect(registry.has('test.event.emitted')).toBe(true)
    expect(registry.has('plan.created')).toBe(false)
  })

  it('validates a well-formed payload', () => {
    const registry = createEventRegistry().register({
      type: 'test.event.emitted',
      payloadVersion: 1,
      schema: PayloadSchema,
      maxSensitivity: 'internal',
      description: 'A test event.',
    })

    const result = registry.validate({
      type: 'test.event.emitted',
      payloadVersion: 1,
      payload: { note: 'hello' },
    })

    expect(result.ok && result.value).toEqual({ note: 'hello' })
  })

  it('rejects a payload that does not match, naming the issues', () => {
    const registry = createEventRegistry().register({
      type: 'test.event.emitted',
      payloadVersion: 1,
      schema: PayloadSchema,
      maxSensitivity: 'internal',
      description: 'A test event.',
    })

    const result = registry.validate({
      type: 'test.event.emitted',
      payloadVersion: 1,
      payload: { note: 42 },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('EVENT_PAYLOAD_INVALID')
      expect(result.error.detail?.issues).toBeDefined()
    }
  })

  it('rejects an unregistered type', () => {
    const result = createEventRegistry().validate({
      type: 'plan.created',
      payloadVersion: 1,
      payload: {},
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EVENT_TYPE_UNREGISTERED')
  })

  it('distinguishes an unknown version of a known type', () => {
    // A different fix from an unknown type: this one usually means a missing
    // upcaster, and the message has to say so or the reader chases a typo.
    const registry = createEventRegistry().register({
      type: 'test.event.emitted',
      payloadVersion: 1,
      schema: PayloadSchema,
      maxSensitivity: 'internal',
      description: 'A test event.',
    })

    const result = registry.validate({
      type: 'test.event.emitted',
      payloadVersion: 2,
      payload: { note: 'hello' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('EVENT_TYPE_UNREGISTERED')
      expect(result.error.message).toContain('Version 2')
      expect(result.error.detail?.hint).toContain('upcaster')
    }
  })

  it('keeps two versions of one type side by side', () => {
    // Rule 5 of Chapter 10: payloads are versioned, never rewritten. Both
    // versions have to be resolvable at once or historical events stop reading.
    const registry = createEventRegistry()
      .register({
        type: 'test.event.emitted',
        payloadVersion: 1,
        schema: PayloadSchema,
        maxSensitivity: 'internal',
        description: 'v1',
      })
      .register({
        type: 'test.event.emitted',
        payloadVersion: 2,
        schema: z.object({ note: z.string(), tag: z.string() }),
        maxSensitivity: 'internal',
        description: 'v2',
      })

    expect(registry.list()).toHaveLength(2)
    expect(
      registry.validate({ type: 'test.event.emitted', payloadVersion: 1, payload: { note: 'a' } })
        .ok,
    ).toBe(true)
    expect(
      registry.validate({
        type: 'test.event.emitted',
        payloadVersion: 2,
        payload: { note: 'a', tag: 'b' },
      }).ok,
    ).toBe(true)
  })

  it('throws when the same type and version is registered twice', () => {
    // A genuine bug — two components disagreeing about one shape — so it
    // throws rather than returning a Result.
    const definition = {
      type: 'test.event.emitted',
      payloadVersion: 1,
      schema: PayloadSchema,
      maxSensitivity: 'internal',
      description: 'A test event.',
    } as const

    const registry = createEventRegistry().register(definition)

    expect(() => registry.register(definition)).toThrow(TypeError)
  })

  it('throws on a malformed event type at registration rather than at publish', () => {
    expect(() =>
      createEventRegistry().register({
        type: 'sendEmail',
        payloadVersion: 1,
        schema: PayloadSchema,
        maxSensitivity: 'internal',
        description: 'A command, not an event.',
      }),
    ).toThrow(TypeError)
  })
})
