import { type BlockedEgress, createConnectorFetch } from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  isErr,
  isOk,
} from '@friday/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Fictional on purpose — no connector has been chosen. See connector.test.ts. */
const MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'example-calendar',
  service: 'Example Calendar',
  version: '1.0.0',
  auth: {
    type: 'oauth2',
    scopes: ['calendar.readonly'],
    scopeJustification: { 'calendar.readonly': 'Read events to prepare briefings' },
  },
  egress: {
    hosts: ['api.example.com', 'oauth2.example.com'],
    dataCategories: ['calendar_events'],
    transmitsPersonalData: true,
    dataRetentionByProvider: 'Per the provider terms',
  },
  operations: [
    {
      id: 'list-events',
      description: 'List events in a window',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['calendar_events'],
      writes: [],
      timeoutMs: 30_000,
    },
  ],
  rateLimits: { requestsPerMinute: 60, burstSize: 10 },
  healthCheck: { operation: 'list-events', intervalSeconds: 300 },
  supportsDryRun: false,
})

const OPERATION: ConnectorOperation = MANIFEST.operations[0] as ConnectorOperation

function okResponse(): Response {
  return new Response('{}', { status: 200 })
}

let blocked: BlockedEgress[]

beforeEach(() => {
  blocked = []
})

function guarded(fetchImpl: typeof fetch) {
  return createConnectorFetch({
    manifest: MANIFEST,
    fetch: fetchImpl,
    onBlocked: (event) => blocked.push(event),
  })
}

describe('the declared hosts', () => {
  it('lets a declared host through, unchanged', async () => {
    const underlying = vi.fn(async () => okResponse())
    const call = guarded(underlying as unknown as typeof fetch)

    const result = await call(OPERATION, 'https://api.example.com/v3/events')

    expect(isOk(result)).toBe(true)
    expect(underlying).toHaveBeenCalledTimes(1)
    expect(blocked).toEqual([])
  })

  it('refuses an undeclared host, and never calls it', async () => {
    const underlying = vi.fn(async () => okResponse())
    const call = guarded(underlying as unknown as typeof fetch)

    const result = await call(OPERATION, 'https://evil.example.com/exfiltrate')

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('EGRESS_BLOCKED')

    // ★ The point of the whole control: the request never happened.
    expect(underlying).not.toHaveBeenCalled()
  })

  it('reports what it blocked, so a diagnostic can be raised', async () => {
    const call = guarded(vi.fn(async () => okResponse()) as unknown as typeof fetch)

    await call(OPERATION, 'https://evil.example.com/exfiltrate')

    expect(blocked).toHaveLength(1)
    expect(blocked[0]).toMatchObject({
      connectorId: 'example-calendar',
      operationId: 'list-events',
      host: 'evil.example.com',
      reason: 'undeclared_host',
    })
  })

  it('does not let a declared host imply its subdomains', async () => {
    const underlying = vi.fn(async () => okResponse())
    const call = guarded(underlying as unknown as typeof fetch)

    for (const url of ['https://cdn.api.example.com/x', 'https://api.example.com.evil.test/x']) {
      expect(isErr(await call(OPERATION, url))).toBe(true)
    }
    expect(underlying).not.toHaveBeenCalled()
  })

  it('refuses a redirect that leaves the allowlist', async () => {
    // Typed parameters so the recorded `init` can be inspected below.
    const underlying = vi.fn((_url: string, _init?: RequestInit) => Promise.resolve(okResponse()))
    const call = guarded(underlying as unknown as typeof fetch)

    await call(OPERATION, 'https://api.example.com/v3/events')

    // Following a redirect ourselves would re-enter the guard; letting fetch
    // follow one would not. The guard must not delegate that decision.
    expect(underlying.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })
})

describe('transport security', () => {
  it('refuses plain http even to a declared host', async () => {
    const underlying = vi.fn(async () => okResponse())
    const call = guarded(underlying as unknown as typeof fetch)

    const result = await call(OPERATION, 'http://api.example.com/v3/events')

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('EGRESS_BLOCKED')
    expect(underlying).not.toHaveBeenCalled()
    expect(blocked[0]).toMatchObject({ reason: 'insecure_transport' })
  })

  it('refuses a url it cannot parse rather than guessing', async () => {
    const underlying = vi.fn(async () => okResponse())
    const call = guarded(underlying as unknown as typeof fetch)

    const result = await call(OPERATION, 'not a url')

    expect(isErr(result)).toBe(true)
    expect(underlying).not.toHaveBeenCalled()
    expect(blocked[0]).toMatchObject({ reason: 'unparseable_url' })
  })
})

describe('the time limit', () => {
  it('gives up when the operation says to, and says which', async () => {
    vi.useFakeTimers()
    try {
      const underlying = vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          }),
      )
      const call = guarded(underlying as unknown as typeof fetch)

      const pending = call({ ...OPERATION, timeoutMs: 1_000 }, 'https://api.example.com/slow')
      await vi.advanceTimersByTimeAsync(1_001)
      const result = await pending

      expect(isErr(result)).toBe(true)
      if (isErr(result)) {
        expect(result.error.code).toBe('TIMEOUT')
        expect(result.error.detail).toMatchObject({ timeoutMs: 1_000 })
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('does not leave the timer running once the call returns', async () => {
    vi.useFakeTimers()
    try {
      const call = guarded(vi.fn(async () => okResponse()) as unknown as typeof fetch)

      expect(isOk(await call(OPERATION, 'https://api.example.com/fast'))).toBe(true)

      // A timer still pending here would abort a later, unrelated call.
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('when the service itself fails', () => {
  it('reports it as unavailable rather than throwing', async () => {
    // A failing fetch rejects; it does not throw synchronously.
    const call = guarded(
      vi.fn(() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch,
    )

    const result = await call(OPERATION, 'https://api.example.com/v3/events')

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONNECTOR_UNAVAILABLE')
  })

  it('passes a failing status back rather than treating it as a fault', async () => {
    const call = guarded(
      vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch,
    )

    const result = await call(OPERATION, 'https://api.example.com/v3/events')

    // 503 is an answer from the service. Deciding what it means is the
    // connector's job, not the boundary's.
    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value.status).toBe(503)
  })
})
