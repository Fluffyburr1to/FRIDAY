import type {
  Connector,
  ConnectorContext,
  DryRunResult,
  OperationContext,
} from '@friday/connector-sdk'
import {
  coarsen,
  err,
  type FridayError,
  fridayError,
  type HealthReport,
  isOk,
  type Location,
  LocationSchema,
  ok,
  type Result,
} from '@friday/contracts'
import { z } from 'zod'
import { describeDisclosure, urlFor } from './disclosure.js'
import { OPEN_METEO_MANIFEST } from './manifest.js'

/**
 * The Open-Meteo connector — FRIDAY's first real one.
 *
 * ★ **It knows how, never when.** It does not decide whether to ask about the
 * weather, or what the answer means. It translates one question into one
 * request, and it refuses to say more about where the owner is than it was
 * given a reason to say.
 *
 * ★★ **There is no credential in this file, and no code path that could hold
 * one.** Open-Meteo needs no account. That is why it is first.
 *
 * See: README.md · docs/01-bible/14-connector-framework.md · ADR-0048 · ADR-0051
 */

export { type Disclosure, describeDisclosure, urlFor } from './disclosure.js'
export { OPEN_METEO_HOST, OPEN_METEO_MANIFEST } from './manifest.js'

/**
 * What a caller asks for.
 *
 * ★ `location` is the full discriminated union, so a precise request cannot be
 * constructed without its written justification — the rule is enforced by the
 * shape rather than by this connector remembering to check.
 */
export const WeatherRequestSchema = z.object({ location: LocationSchema })
export type WeatherRequest = z.infer<typeof WeatherRequestSchema>

/**
 * Builds a request at the default precision.
 *
 * ★ The default is `coarse`, and it is a function rather than a fallback
 * inside the connector so that choosing precision is always something a caller
 * did on purpose. There is no path where an unrounded coordinate becomes the
 * default by omission.
 *
 * @param latitude - Degrees north.
 * @param longitude - Degrees east.
 * @returns A request disclosing roughly a kilometre.
 */
export function weatherNear(latitude: number, longitude: number): WeatherRequest {
  return { location: coarsen(latitude, longitude) }
}

function parseRequest(input: unknown): Result<Location, FridayError> {
  const parsed = WeatherRequestSchema.safeParse(input)

  if (!parsed.success) {
    return err(
      fridayError({
        code: 'VALIDATION_FAILED',
        message: 'FRIDAY was asked about the weather somewhere she cannot place.',
        detail: { issues: parsed.error.issues.length },
      }),
    )
  }

  return ok(parsed.data.location)
}

/**
 * Builds the connector.
 *
 * ★ The manifest is parsed at module load, so a manifest that violates the
 * schema — an undeclared category, a write without a preview, a wildcard host
 * — fails at import rather than at the first request.
 *
 * @param context - The guarded fetch and clock the SDK supplies.
 * @returns A connector over Open-Meteo.
 */
export function createOpenMeteoConnector(context: ConnectorContext): Connector {
  const operation = (id: string) => {
    const found = OPEN_METEO_MANIFEST.operations.find((candidate) => candidate.id === id)
    if (found === undefined) throw new Error(`open-meteo has no operation ${id}`)
    return found
  }

  async function ask(
    operationId: string,
    input: unknown,
    call?: OperationContext,
  ): Promise<Result<unknown, FridayError>> {
    const location = parseRequest(input)
    if (!location.ok) return location

    const disclosure = describeDisclosure(operationId, location.value)
    if (!disclosure.ok) return disclosure

    const response = await context.fetch(operation(operationId), urlFor(disclosure.value), {
      ...(call?.signal === undefined ? {} : { signal: call.signal }),
      ...(call?.correlationId === undefined ? {} : { correlationId: call.correlationId }),
    })

    if (!response.ok) return response

    // ★ A status is an answer, not a success. Reporting a 4xx as done would
    // put a weather reading in the record that never existed.
    if (response.value.status >= 400) {
      return err(
        fridayError({
          code: 'CONNECTOR_UNAVAILABLE',
          message: `Open-Meteo could not answer (${response.value.status}).`,
          detail: { status: response.value.status, operation: operationId },
        }),
      )
    }

    return ok(await response.value.json())
  }

  return {
    manifest: OPEN_METEO_MANIFEST,

    initialize(): Promise<Result<void, FridayError>> {
      // Nothing to acquire: no credential, no pool, no session.
      return Promise.resolve(ok(undefined))
    },

    async health(): Promise<HealthReport> {
      const startedAt = context.now()

      // ★ The probe uses a deliberately coarse, fixed point rather than the
      // owner's location. A health check is FRIDAY's business, and sending
      // where the owner is every fifteen minutes to find out whether a
      // service is up would be a daily location feed dressed as monitoring.
      const result = await ask('current-weather', { location: coarsen(0, 0) })

      return {
        component: OPEN_METEO_MANIFEST.id,
        status: isOk(result) ? 'healthy' : 'unhealthy',
        detail: isOk(result) ? 'Open-Meteo is answering.' : 'Open-Meteo is not answering.',
        checkedAt: context.now(),
        latencyMs: context.now() - startedAt,
        metrics: {},
      }
    },

    execute(operationId, input, call): Promise<Result<unknown, FridayError>> {
      return ask(operationId, input, call)
    },

    dryRun(operationId): Promise<Result<DryRunResult, FridayError>> {
      // Every operation is read-only, so there is no artifact to approve.
      // Answering with a fabricated preview would be worse than refusing.
      return Promise.resolve(
        err(
          fridayError({
            code: 'NOT_IMPLEMENTED',
            message: `${operationId} only reads, so there is nothing to preview.`,
            detail: { operationId },
          }),
        ),
      )
    },

    shutdown(): Promise<void> {
      return Promise.resolve()
    },
  }
}
