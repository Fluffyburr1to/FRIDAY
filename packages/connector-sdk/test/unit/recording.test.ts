import { createConnectorRuntime, recordingObserver } from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  createEventRegistry,
  mayLeaveTheMachine,
  type NewEvent,
  NewEventSchema,
  type PrincipalId,
  registerConnectorEventTypes,
  SYSTEM_ACTOR,
  uuidv7,
} from '@friday/contracts'

import { beforeEach, describe, expect, it, vi } from 'vitest'

const MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'example-notes',
  service: 'Example Notes',
  version: '1.0.0',
  auth: { type: 'none', scopes: [], scopeJustification: {} },
  egress: {
    hosts: ['api.example-notes.test'],
    dataCategories: ['note_contents'],
    transmitsPersonalData: true,
    dataRetentionByProvider: 'Per the provider terms',
  },
  operations: [
    {
      id: 'list-notes',
      description: 'List notes',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['note_contents'],
      writes: [],
      timeoutMs: 30_000,
    },
  ],
  rateLimits: { requestsPerMinute: 600, burstSize: 60 },
  healthCheck: { operation: 'list-notes', intervalSeconds: 300 },
  supportsDryRun: false,
})

const READ = MANIFEST.operations[0] as ConnectorOperation
const URL_OK = 'https://api.example-notes.test/notes'
const PRINCIPAL = 'usr_owner' as PrincipalId

let clock: number
let recorded: NewEvent[]

beforeEach(() => {
  clock = 1_000
  recorded = []
})

function runtime(fetchImpl: typeof globalThis.fetch) {
  return createConnectorRuntime({
    manifest: MANIFEST,
    fetch: fetchImpl,
    now: () => clock,
    sleep: (ms) => {
      clock += ms
      return Promise.resolve()
    },
    observer: recordingObserver(
      { record: (event) => recorded.push(event) },
      { principalId: PRINCIPAL, now: () => clock },
    ),
  })
}

const respond = (status: number) =>
  vi.fn(() => Promise.resolve(new Response('{}', { status }))) as unknown as typeof globalThis.fetch

function ofType(type: string): NewEvent[] {
  return recorded.filter((event) => event.type === type)
}

describe('every event is one the log would accept', () => {
  it('produces events that pass the event schema itself', async () => {
    const runner = runtime(respond(200))

    await runner.fetch(READ, URL_OK, { correlationId: uuidv7() })
    await runner.fetch(READ, 'https://evil.test/x')

    expect(recorded.length).toBeGreaterThan(0)
    for (const event of recorded) {
      expect(NewEventSchema.safeParse(event).success, `${event.type} is malformed`).toBe(true)
    }
  })

  it('produces payloads the registry itself accepts', async () => {
    // ★ Validated through the SAME call the bus makes, rather than against a
    // list of schemas kept by hand in this file. A payload the bus would
    // refuse is an audit event that silently never gets written — and a
    // hand-kept list would drift from the registry without anything noticing.
    const registry = registerConnectorEventTypes(createEventRegistry())
    const runner = runtime(respond(500))

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    await runner.fetch(READ, 'https://evil.test/x')

    expect(recorded.length).toBeGreaterThan(0)
    for (const event of recorded) {
      expect(registry.has(event.type), `${event.type} is not registered`).toBe(true)

      const validated = registry.validate({
        type: event.type,
        payloadVersion: event.payloadVersion ?? 1,
        payload: event.payload,
      })
      expect(validated.ok, `${event.type} payload would be refused by the bus`).toBe(true)
    }
  })

  it("emits every type it declares, over a connector's whole life", async () => {
    // If the adapter stopped emitting one of these, nothing else here would
    // fail — the others would still validate.
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    await runner.fetch(READ, 'https://evil.test/x')
    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 120_000
    await runner.fetch(READ, URL_OK)

    expect(new Set(recorded.map((event) => event.type))).toEqual(
      new Set([
        'security.egress.blocked',
        'connector.called',
        'connector.degraded',
        'connector.recovered',
      ]),
    )
  })
})

describe('how sensitive each event says it is', () => {
  it('claims exactly what its type declares, never less', async () => {
    // ★ The bus accepts an event claiming LESS sensitivity than its type
    // allows, so under-claiming is not caught anywhere downstream. It matters:
    // `public` would make these eligible to leave the machine, and they name
    // hosts, connectors, and the shape of the owner's outbound traffic.
    const declared = new Map(
      registerConnectorEventTypes(createEventRegistry())
        .list()
        .map((definition) => [definition.type, definition.maxSensitivity]),
    )
    const runner = runtime(respond(200))

    await runner.fetch(READ, URL_OK)
    await runner.fetch(READ, 'https://evil.test/x')

    expect(recorded.length).toBeGreaterThan(0)
    for (const event of recorded) {
      expect(event.sensitivity, `${event.type} misdeclares its sensitivity`).toBe(
        declared.get(event.type),
      )
    }
  })

  it('never marks a connector event as free to leave the machine', async () => {
    const runner = runtime(respond(200))

    await runner.fetch(READ, URL_OK)
    await runner.fetch(READ, 'https://evil.test/x')

    for (const event of recorded) {
      expect(mayLeaveTheMachine(event.sensitivity), `${event.type} may egress`).toBe(false)
    }
  })
})

describe('what each event says', () => {
  it('records a call, with the request it belonged to', async () => {
    const runner = runtime(respond(200))

    const correlationId = uuidv7()
    await runner.fetch(READ, URL_OK, { correlationId })

    const [call] = ofType('connector.called')
    expect(call?.correlationId).toBe(correlationId)
    expect(call?.payload).toMatchObject({
      connectorId: 'example-notes',
      operationId: 'list-notes',
      outcome: 'succeeded',
      status: 200,
      attempts: 1,
    })
  })

  it('records a blocked host as its own event, not as a failed call', async () => {
    // ★ Chapter 14 requires this one to raise a diagnostic. It is the only
    // signal that a connector tried to reach somewhere it never declared.
    const runner = runtime(respond(200))

    await runner.fetch(READ, 'https://evil.test/collect')

    const [blocked] = ofType('security.egress.blocked')
    expect(blocked?.payload).toMatchObject({
      connectorId: 'example-notes',
      host: 'evil.test',
      reason: 'undeclared_host',
    })

    // And the call itself is recorded as refused, not failed.
    expect(ofType('connector.called')[0]?.payload).toMatchObject({ outcome: 'refused' })
  })

  it('records a service going quiet and coming back', async () => {
    const fetchImpl = vi.fn(() => Promise.resolve(new Response('', { status: 500 })))
    const runner = runtime(fetchImpl as unknown as typeof globalThis.fetch)

    for (let i = 0; i < 5; i++) {
      clock += 60_000
      await runner.fetch(READ, URL_OK)
    }
    expect(ofType('connector.degraded')).toHaveLength(1)

    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
    clock += 120_000
    await runner.fetch(READ, URL_OK)

    expect(ofType('connector.recovered')).toHaveLength(1)
  })
})

describe('what no event ever carries', () => {
  it('never records a request body, a response body, or a header', async () => {
    // ★ Chapter 22 puts a redaction layer in the logger. This is designed so
    // that layer has nothing to catch: a secret that never reaches it is
    // better than one something else has to strip.
    const secret = 'ya29.super-secret-token'
    const runner = runtime(
      vi.fn(() =>
        Promise.resolve(new Response(JSON.stringify({ token: secret }), { status: 200 })),
      ) as unknown as typeof globalThis.fetch,
    )

    await runner.fetch(READ, URL_OK, {
      method: 'POST',
      body: JSON.stringify({ token: secret }),
      headers: { authorization: `Bearer ${secret}` },
      idempotencyKey: secret,
    })

    const serialised = JSON.stringify(recorded)
    expect(serialised).not.toContain(secret)
    expect(serialised).not.toContain('authorization')
  })

  it('never records the URL, only the host that was refused', async () => {
    // A full URL carries query parameters, and query parameters carry
    // identifiers. The host is what a diagnostic needs; the path is not.
    const runner = runtime(respond(200))

    await runner.fetch(READ, 'https://evil.test/collect?email=leaked%40example.com')

    const serialised = JSON.stringify(recorded)
    expect(serialised).not.toContain('leaked')
    expect(serialised).not.toContain('/collect')
  })
})

describe('whose data, and on whose behalf', () => {
  it('names the principal on every event', async () => {
    const runner = runtime(respond(200))

    await runner.fetch(READ, URL_OK)

    for (const event of recorded) expect(event.principalId).toBe(PRINCIPAL)
  })

  it('attributes these to the system, not to the owner', async () => {
    // The owner did not make this request; FRIDAY's machinery did. Recording
    // it as the owner's action would misdescribe the audit trail.
    const runner = runtime(respond(200))

    await runner.fetch(READ, URL_OK)

    for (const event of recorded) expect(event.actor).toEqual(SYSTEM_ACTOR)
  })
})
