import type {
  Connector,
  ConnectorContext,
  DryRunResult,
  OperationContext,
} from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  err,
  type FridayError,
  fridayError,
  type HealthReport,
  isOk,
  ok,
  type Result,
} from '@friday/contracts'

/**
 * A connector for a service that does not exist.
 *
 * ★ **Deliberately fictional.** Which service FRIDAY connects to first is an
 * owner decision that has not been made, and a test connector named after a
 * real provider would read like that decision had been taken quietly. This
 * exists only so the conformance suite has something to run against — and so
 * that the suite is proven to fail when a connector misbehaves, which is the
 * only way to know it proves anything at all.
 *
 * It is also the smallest complete example of the interface: one read, one
 * write, a preview, and a health check.
 */

export const EXAMPLE_MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'example-notes',
  service: 'Example Notes',
  version: '1.0.0',
  auth: {
    type: 'oauth2',
    scopes: ['notes.read', 'notes.write'],
    scopeJustification: {
      'notes.read': 'Read your notes so FRIDAY can answer questions about them',
      'notes.write': 'Add a note when you have approved the text of it',
    },
  },
  egress: {
    hosts: ['api.example-notes.test'],
    dataCategories: ['note_contents'],
    transmitsPersonalData: true,
    dataRetentionByProvider: 'Per the provider terms; not controlled by FRIDAY',
  },
  operations: [
    {
      id: 'list-notes',
      description: 'List your notes',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['note_contents'],
      writes: [],
      timeoutMs: 30_000,
    },
    {
      id: 'create-note',
      description: 'Add a note you have approved',
      riskClass: 'medium',
      idempotent: false,
      irreversible: false,
      reads: [],
      writes: ['note_contents'],
      timeoutMs: 30_000,
    },
  ],
  rateLimits: { requestsPerMinute: 60, burstSize: 10 },
  healthCheck: { operation: 'list-notes', intervalSeconds: 300 },
  supportsDryRun: true,
})

const BASE = 'https://api.example-notes.test'

/**
 * One declared operation, by id.
 *
 * Exported so callers name what they mean instead of indexing into the
 * operations array, which the compiler cannot know is non-empty.
 */
export function exampleOperation(id: string): ConnectorOperation {
  const found = EXAMPLE_MANIFEST.operations.find((operation) => operation.id === id)
  if (found === undefined) throw new Error(`the example connector has no operation ${id}`)
  return found
}

export const LIST_NOTES = exampleOperation('list-notes')
export const CREATE_NOTE = exampleOperation('create-note')

export interface CreateNoteInput {
  readonly text: string
}

/** Answers as the provider would. Stands in for recorded HTTP fixtures. */
export function exampleFixtures(url: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? 'GET').toUpperCase()

  if (method === 'GET' && url.startsWith(`${BASE}/notes`)) {
    return Promise.resolve(
      new Response(JSON.stringify({ notes: [{ id: 'n1', text: 'buy milk' }] }), { status: 200 }),
    )
  }

  if (method === 'POST' && url === `${BASE}/notes`) {
    return Promise.resolve(new Response(JSON.stringify({ id: 'n2' }), { status: 201 }))
  }

  return Promise.resolve(new Response('not found', { status: 404 }))
}

export const EXAMPLE_SAMPLES: Readonly<Record<string, unknown>> = {
  'list-notes': {},
  'create-note': { text: 'remember the milk' } satisfies CreateNoteInput,
}

/**
 * Builds the example connector.
 *
 * @param context - The guarded fetch and clock the SDK hands every connector.
 * @returns A connector implementing the full interface.
 */
export function createExampleConnector(context: ConnectorContext): Connector {
  async function readNotes(call: OperationContext): Promise<Result<unknown, FridayError>> {
    // Spread rather than `signal: call.signal`: under exactOptionalPropertyTypes
    // an explicit `undefined` is not the same as an absent property.
    const response = await context.fetch(LIST_NOTES, `${BASE}/notes`, {
      ...(call.signal === undefined ? {} : { signal: call.signal }),
    })

    if (!response.ok) return response
    return ok(await response.value.json())
  }

  return {
    manifest: EXAMPLE_MANIFEST,

    initialize(): Promise<Result<void, FridayError>> {
      return Promise.resolve(ok(undefined))
    },

    async health(): Promise<HealthReport> {
      const started = context.now()
      const result = await readNotes({ correlationId: 'cor_health' as never })

      return {
        component: EXAMPLE_MANIFEST.id,
        status: isOk(result) ? 'healthy' : 'unhealthy',
        detail: isOk(result) ? 'answering' : 'not answering',
        checkedAt: context.now(),
        latencyMs: context.now() - started,
        metrics: {},
      }
    },

    async execute(operationId, input, call): Promise<Result<unknown, FridayError>> {
      if (operationId === 'list-notes') return await readNotes(call)

      const response = await context.fetch(CREATE_NOTE, `${BASE}/notes`, {
        method: 'POST',
        body: JSON.stringify(input),
        ...(call.signal === undefined ? {} : { signal: call.signal }),
      })

      if (!response.ok) return response

      // ★ Returns the failure rather than claiming success. A connector that
      // reported a 4xx as done would be lying to the audit trail.
      if (response.value.status >= 400) {
        return err(
          fridayError({
            code: 'CONNECTOR_UNAVAILABLE',
            message: 'Example Notes refused to add the note.',
            detail: { status: response.value.status },
          }),
        )
      }

      return ok(await response.value.json())
    },

    dryRun(operationId, input): Promise<Result<DryRunResult, FridayError>> {
      if (operationId !== 'create-note') {
        return Promise.resolve(
          err(
            fridayError({
              code: 'NOT_IMPLEMENTED',
              message: `${operationId} reads and needs no preview.`,
            }),
          ),
        )
      }

      // ★ The actual artifact, not a description of it. Whatever `execute`
      // would send is what the owner sees.
      const text = (input as CreateNoteInput).text

      return Promise.resolve(
        ok({
          preview: { kind: 'text' as const, content: text },
          impact: {
            reversible: true,
            dataLeavesDevice: true,
            dataCategories: ['note_contents'],
            estimatedCostCents: null,
          },
        }),
      )
    },

    shutdown(): Promise<void> {
      return Promise.resolve()
    },
  }
}
