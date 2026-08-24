import type { Connector, SupervisedConnector } from '@friday/connector-sdk'
import {
  type ConnectorContext,
  type ConnectorFetch,
  createConnectorFetch,
  mayRepeat,
  type OperationContext,
  superviseConnector,
} from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  HealthReportSchema,
  ImpactSchema,
  isErr,
  isOk,
  PreviewSchema,
  requiresDryRun,
  uuidv7,
} from '@friday/contracts'
import { describe, expect, it, vi } from 'vitest'

/**
 * The conformance suite every connector must pass before merge.
 *
 * Chapter 14: this is *"what keeps a hastily-written connector from becoming
 * the weak link"* — in the one component that has both network access and
 * credentials. A connector author does not get to choose which of these apply.
 *
 * ★ **Everything here is asserted from the outside.** The suite never reaches
 * into a connector's internals; it drives the published interface and watches
 * what leaves through the guarded fetch. A connector that passes by being
 * inspected would prove only that it was inspectable.
 *
 * Reference: docs/01-bible/14-connector-framework.md · tests/contract/README.md
 */

/** One request a connector made, as the boundary saw it. */
export interface SeenRequest {
  readonly url: string
  readonly method: string
}

export interface ContractSubject {
  /** The connector's manifest, exactly as it ships. */
  readonly manifest: ConnectorManifest

  /**
   * One representative input per declared operation.
   *
   * ★ Required for **every** operation the manifest declares — a missing entry
   * fails the suite rather than skipping that operation. Otherwise the easiest
   * way to pass conformance would be to leave the risky operation untested.
   */
  readonly samples: Readonly<Record<string, unknown>>

  /** Answers as the real provider would, from recorded fixtures. */
  readonly respond: (url: string, init?: RequestInit) => Promise<Response>

  /** Builds the connector under test. */
  readonly create: (context: ConnectorContext) => Connector
}

export const METHODS_THAT_CHANGE_THINGS = ['POST', 'PUT', 'PATCH', 'DELETE']

/**
 * Drives a connector and reports what left through the boundary.
 *
 * ★ Exported so the suite's own assertions can be tested. A conformance suite
 * that has never been shown to FAIL proves nothing about the connectors that
 * pass it — which is exactly how the boundary rules in `tests/architecture/`
 * sat inert for three milestones.
 *
 * @param subject - The connector under test.
 * @param drive - What to do with the started connector.
 * @returns Every request the boundary saw, in order.
 */
export async function observe(
  subject: ContractSubject,
  drive: (connector: SupervisedConnector, call: () => OperationContext) => Promise<unknown>,
  respond: ContractSubject['respond'] = subject.respond,
): Promise<SeenRequest[]> {
  const seen: SeenRequest[] = []

  const recording: typeof globalThis.fetch = (async (url: string, init?: RequestInit) => {
    seen.push({ url, method: (init?.method ?? 'GET').toUpperCase() })
    return await respond(url, init)
  }) as unknown as typeof globalThis.fetch

  const context: ConnectorContext = {
    fetch: createConnectorFetch({ manifest: subject.manifest, fetch: recording }),
    now: () => 1_000,
  }

  const connector = superviseConnector(subject.create(context))
  await connector.initialize(context)
  await drive(connector, () => callContext())

  return seen
}

function callContext(overrides: Partial<OperationContext> = {}): OperationContext {
  return { correlationId: uuidv7(), ...overrides }
}

/**
 * The first declared operation.
 *
 * The manifest schema guarantees at least one, so this cannot fail for a
 * manifest that parsed — but saying so explicitly beats an assertion the
 * compiler cannot see.
 */
function firstOperation(manifest: ConnectorManifest): ConnectorOperation {
  const [operation] = manifest.operations
  if (operation === undefined) throw new Error('a manifest declares at least one operation')
  return operation
}

/**
 * Runs the shared suite against one connector.
 *
 * @param subject - The connector, its manifest, and its fixtures.
 */
export function describeConnectorContract(subject: ContractSubject): void {
  const manifest = subject.manifest

  /** Builds a connector with a recording boundary in front of it. */
  function build(respond = subject.respond) {
    const seen: SeenRequest[] = []

    const recording: typeof globalThis.fetch = (async (url: string, init?: RequestInit) => {
      seen.push({ url, method: (init?.method ?? 'GET').toUpperCase() })
      return await respond(url, init)
    }) as unknown as typeof globalThis.fetch

    const fetch: ConnectorFetch = createConnectorFetch({ manifest, fetch: recording })
    const context: ConnectorContext = { fetch, now: () => 1_000 }
    const connector = superviseConnector(subject.create(context))

    return { connector, context, seen }
  }

  async function started(respond = subject.respond) {
    const built = build(respond)
    const result = await built.connector.initialize(built.context)
    expect(isOk(result), 'the connector must be able to start').toBe(true)
    return built
  }

  describe(`${manifest.id} — manifest`, () => {
    it('is a manifest FRIDAY would accept', () => {
      expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(true)
    })

    it('offers a sample for every operation it declares', () => {
      // Otherwise the cheapest way to pass this suite is to leave the
      // dangerous operation out of the samples.
      const declared = manifest.operations.map((operation) => operation.id).sort()
      const sampled = Object.keys(subject.samples).sort()

      expect(sampled).toEqual(declared)
    })
  })

  describe(`${manifest.id} — lifecycle`, () => {
    it('does nothing before it is started', async () => {
      const { connector } = build()
      const operation = firstOperation(manifest)

      const result = await connector.execute(
        operation.id,
        subject.samples[operation.id],
        callContext(),
      )

      expect(isErr(result)).toBe(true)
    })

    it('reports unknown health before it is started, never healthy', async () => {
      expect((await build().connector.health()).status).toBe('unknown')
    })

    it('reports health in the shape the dashboard reads', async () => {
      const { connector } = await started()

      expect(HealthReportSchema.safeParse(await connector.health()).success).toBe(true)
    })

    it('does nothing after it is stopped', async () => {
      const { connector } = await started()
      await connector.shutdown()
      const operation = firstOperation(manifest)

      const result = await connector.execute(
        operation.id,
        subject.samples[operation.id],
        callContext(),
      )

      expect(isErr(result)).toBe(true)
    })

    it('can be stopped twice without complaint', async () => {
      const { connector } = await started()

      await connector.shutdown()
      await expect(connector.shutdown()).resolves.toBeUndefined()
    })

    it('refuses an operation it does not declare', async () => {
      const { connector } = await started()

      const result = await connector.execute('not-a-real-operation', {}, callContext())

      expect(isErr(result)).toBe(true)
      if (isErr(result)) expect(result.error.code).toBe('OPERATION_NOT_DECLARED')
    })
  })

  describe(`${manifest.id} — every declared operation`, () => {
    for (const operation of manifest.operations) {
      it(`${operation.id} answers with a Result rather than throwing`, async () => {
        const { connector } = await started()

        // The assertion is that this line does not throw. A connector that
        // throws for an ordinary outcome breaks every caller's error handling.
        const result = await connector.execute(
          operation.id,
          subject.samples[operation.id],
          callContext(),
        )

        expect(typeof result.ok).toBe('boolean')
      })

      if (requiresDryRun(operation)) {
        it(`${operation.id} can show what it would do before doing it`, async () => {
          const { connector } = await started()

          const result = await connector.dryRun(operation.id, subject.samples[operation.id])

          expect(isOk(result), 'a write operation must implement dryRun').toBe(true)
          if (isOk(result)) {
            expect(PreviewSchema.safeParse(result.value.preview).success).toBe(true)
            expect(ImpactSchema.safeParse(result.value.impact).success).toBe(true)
          }
        })

        it(`${operation.id} changes nothing while previewing`, async () => {
          // ★ The assertion that makes dry run worth having. A preview that
          // performed the write would be a confirmation screen shown after
          // the fact, and the owner's approval would be theatre.
          const { connector, seen } = await started()

          await connector.dryRun(operation.id, subject.samples[operation.id])

          const changed = seen.filter((r) => METHODS_THAT_CHANGE_THINGS.includes(r.method))
          expect(changed, `${operation.id} sent a mutating request while previewing`).toEqual([])
        })
      }
    }
  })

  describe(`${manifest.id} — the boundary`, () => {
    it('only ever reaches hosts it declared, over an encrypted connection', async () => {
      const { connector, seen } = await started()

      for (const operation of manifest.operations) {
        await connector.execute(operation.id, subject.samples[operation.id], callContext())
      }

      for (const request of seen) {
        const url = new URL(request.url)
        expect(manifest.egress.hosts, `reached ${url.hostname}`).toContain(url.hostname)
        expect(url.protocol, `reached ${url} unencrypted`).toBe('https:')
      }
    })

    it('gives up when the provider stops answering', async () => {
      vi.useFakeTimers()
      try {
        const hang = (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')))
          })

        const { connector } = await started(hang)
        const operation = firstOperation(manifest)

        const pending = connector.execute(
          operation.id,
          subject.samples[operation.id],
          callContext(),
        )
        await vi.advanceTimersByTimeAsync(operation.timeoutMs + 1)

        const result = await pending
        expect(isErr(result), 'an unanswered call must end').toBe(true)
      } finally {
        vi.useRealTimers()
      }
    })

    it('does not repeat a call the provider cannot deduplicate', async () => {
      // ★ Chapter 14's rule, checked from the outside: whatever a connector
      // does internally, an operation that is not idempotent and carries no
      // key must reach the provider exactly once.
      const risky = manifest.operations.filter((operation) => !mayRepeat(operation, callContext()))

      for (const operation of risky) {
        const { connector, seen } = await started(() =>
          Promise.resolve(new Response('nope', { status: 503 })),
        )

        await connector.execute(operation.id, subject.samples[operation.id], callContext())

        expect(seen.length, `${operation.id} was sent more than once`).toBeLessThanOrEqual(1)
      }
    })
  })
}
