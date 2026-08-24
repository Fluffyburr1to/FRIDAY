import {
  type Connector,
  type ConnectorContext,
  createConnectorFetch,
  type OperationContext,
  superviseConnector,
} from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type CorrelationId,
  err,
  fridayError,
  isErr,
  isOk,
  ok,
} from '@friday/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/** Fictional on purpose — no connector has been chosen. */
const MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'example-calendar',
  service: 'Example Calendar',
  version: '1.0.0',
  auth: { type: 'none', scopes: [], scopeJustification: {} },
  egress: {
    hosts: ['api.example.com'],
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

const CONTEXT: ConnectorContext = {
  fetch: createConnectorFetch({ manifest: MANIFEST, fetch: globalThis.fetch }),
  now: () => 1_000,
}

const CALL: OperationContext = { correlationId: 'cor_1' as CorrelationId }

interface Spy {
  initialize: ReturnType<typeof vi.fn>
  health: ReturnType<typeof vi.fn>
  execute: ReturnType<typeof vi.fn>
  dryRun: ReturnType<typeof vi.fn>
  shutdown: ReturnType<typeof vi.fn>
}

let spy: Spy

function healthy() {
  return {
    component: 'example-calendar',
    status: 'healthy' as const,
    detail: 'answering',
    checkedAt: 1_000,
    latencyMs: 5,
    metrics: {},
  }
}

beforeEach(() => {
  spy = {
    initialize: vi.fn(() => Promise.resolve(ok(undefined))),
    health: vi.fn(() => Promise.resolve(healthy())),
    execute: vi.fn(() => Promise.resolve(ok({ events: [] }))),
    dryRun: vi.fn(() =>
      Promise.resolve(
        ok({
          preview: { kind: 'none' as const, content: '' },
          impact: {
            reversible: true,
            dataLeavesDevice: true,
            dataCategories: ['calendar_events'],
            estimatedCostCents: null,
          },
        }),
      ),
    ),
    shutdown: vi.fn(() => Promise.resolve()),
  }
})

function supervised() {
  return superviseConnector({ manifest: MANIFEST, ...spy } as unknown as Connector)
}

describe('nothing runs before it is started', () => {
  it('begins in created, not ready', () => {
    expect(supervised().state).toBe('created')
  })

  it('refuses to execute before initialize, and never calls through', async () => {
    const connector = supervised()

    const result = await connector.execute('list-events', {}, CALL)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONNECTOR_NOT_READY')
    expect(spy.execute).not.toHaveBeenCalled()
  })

  it('refuses to preview before initialize', async () => {
    const result = await supervised().dryRun('list-events', {})

    expect(isErr(result)).toBe(true)
    expect(spy.dryRun).not.toHaveBeenCalled()
  })

  it('reports unknown health before it starts, never healthy', async () => {
    // Chapter 23: assuming health from silence is how outages go unnoticed.
    const report = await supervised().health()

    expect(report.status).toBe('unknown')
    expect(spy.health).not.toHaveBeenCalled()
  })

  it('becomes ready once initialize succeeds', async () => {
    const connector = supervised()
    expect(isOk(await connector.initialize(CONTEXT))).toBe(true)
    expect(connector.state).toBe('ready')
  })

  it('stays unusable when initialize fails', async () => {
    spy.initialize.mockResolvedValue(err(fridayError({ code: 'CONFIG_INVALID', message: 'no' })))
    const connector = supervised()

    await connector.initialize(CONTEXT)

    expect(connector.state).toBe('created')
    expect(isErr(await connector.execute('list-events', {}, CALL))).toBe(true)
  })

  it('refuses a second initialize rather than acquiring twice', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const again = await connector.initialize(CONTEXT)

    expect(isErr(again)).toBe(true)
    expect(spy.initialize).toHaveBeenCalledTimes(1)
  })
})

describe('nothing runs after it is stopped', () => {
  it('refuses to execute after shutdown', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)
    await connector.shutdown()

    const result = await connector.execute('list-events', {}, CALL)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.code).toBe('CONNECTOR_NOT_READY')
      expect(result.error.detail).toMatchObject({ state: 'stopped' })
    }
    expect(spy.execute).not.toHaveBeenCalled()
  })

  it('can be shut down more than once', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)

    await connector.shutdown()
    await connector.shutdown()

    expect(spy.shutdown).toHaveBeenCalledTimes(1)
  })

  it('can be shut down without ever having started', async () => {
    await expect(supervised().shutdown()).resolves.toBeUndefined()
  })

  it('is stopped even when the connector throws on the way out', async () => {
    spy.shutdown.mockRejectedValue(new Error('leaked a socket'))
    const connector = supervised()
    await connector.initialize(CONTEXT)

    // A connector that throws while stopping must not block whatever is next
    // in the shutdown sequence.
    await expect(connector.shutdown()).resolves.toBeUndefined()
    expect(connector.state).toBe('stopped')
  })
})

describe('only what the manifest declares', () => {
  it('refuses an operation that was never declared', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const result = await connector.execute('delete-everything', {}, CALL)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('OPERATION_NOT_DECLARED')
    expect(spy.execute).not.toHaveBeenCalled()
  })

  it('refuses to preview an operation that was never declared', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const result = await connector.dryRun('delete-everything', {})

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('OPERATION_NOT_DECLARED')
    expect(spy.dryRun).not.toHaveBeenCalled()
  })

  it('lets a declared operation through, with its input and context intact', async () => {
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const result = await connector.execute('list-events', { limit: 5 }, CALL)

    expect(isOk(result)).toBe(true)
    expect(spy.execute).toHaveBeenCalledWith('list-events', { limit: 5 }, CALL)
  })
})

describe('a connector that misbehaves does not take the kernel with it', () => {
  it('turns a thrown execute into a typed failure blaming the connector', async () => {
    spy.execute.mockRejectedValue(new Error('undefined is not a function'))
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const result = await connector.execute('list-events', {}, CALL)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      // Not CONNECTOR_UNAVAILABLE: that would send someone to read the
      // provider's status page while the bug sat in this repository.
      expect(result.error.code).toBe('CONNECTOR_FAULTED')
      expect(result.error.detail).toMatchObject({ connector: 'example-calendar' })
    }
  })

  it('turns a thrown dryRun into a typed failure', async () => {
    spy.dryRun.mockRejectedValue(new Error('boom'))
    const connector = supervised()
    await connector.initialize(CONTEXT)

    const result = await connector.dryRun('list-events', {})

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONNECTOR_FAULTED')
  })

  it('turns a thrown initialize into a typed failure, and stays unstarted', async () => {
    spy.initialize.mockRejectedValue(new Error('boom'))
    const connector = supervised()

    const result = await connector.initialize(CONTEXT)

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONNECTOR_FAULTED')
    expect(connector.state).toBe('created')
  })

  it('reports unhealthy when the health check itself throws', async () => {
    spy.health.mockRejectedValue(new Error('boom'))
    const connector = supervised()
    await connector.initialize(CONTEXT)

    expect((await connector.health()).status).toBe('unhealthy')
  })
})
