import {
  err,
  type FridayError,
  fridayError,
  type Location,
  locationCategory,
  ok,
  precisionReason,
  type Result,
} from '@friday/contracts'
import { OPEN_METEO_HOST } from './manifest.js'

/**
 * Exactly what would leave the machine, worked out without sending anything.
 *
 * ★ The point of this file. A connector that can only be understood by
 * watching its traffic is a connector nobody has reviewed — so the disclosure
 * is a value that can be printed, asserted on, and shown to the owner, and the
 * request is built *from* it rather than alongside it. There is no second code
 * path that could send something this does not describe.
 *
 * Reference: ADR-0051 · Constitution Article IV
 */

export interface Disclosure {
  /** The only host this connector may reach. */
  readonly host: string
  readonly path: string

  /** Every query parameter, in the order they are sent. */
  readonly query: ReadonlyArray<readonly [string, string]>

  /** Which representation of the owner's position is being sent. */
  readonly precision: Location['precision']

  /** The declared data category this falls under. */
  readonly dataCategory: string

  /** Why more than the default was permitted, when it was. */
  readonly justification: string | null
}

/** The fields asked for, per operation. Nothing else is ever requested. */
const FIELDS: Readonly<Record<string, readonly string[]>> = {
  'current-weather': ['temperature_2m', 'apparent_temperature', 'weather_code', 'wind_speed_10m'],
  'daily-forecast': ['weather_code', 'temperature_2m_max', 'temperature_2m_min'],
}

const PARAM: Readonly<Record<string, string>> = {
  'current-weather': 'current',
  'daily-forecast': 'daily',
}

/**
 * Works out what a request would disclose.
 *
 * @param operationId - Which operation is being run.
 * @param location - Where, at whatever precision was permitted.
 * @returns The full disclosure, or a refusal.
 */
export function describeDisclosure(
  operationId: string,
  location: Location,
): Result<Disclosure, FridayError> {
  const fields = FIELDS[operationId]
  const param = PARAM[operationId]

  if (fields === undefined || param === undefined) {
    return err(
      fridayError({
        code: 'OPERATION_NOT_DECLARED',
        message: `Open-Meteo does not do "${operationId}".`,
        detail: { operationId },
      }),
    )
  }

  if (location.precision === 'named-place') {
    // ★ Refused rather than quietly geocoded. Turning a name into coordinates
    // means a second host and a different disclosure — a place name is not a
    // coordinate — and that is a manifest change with an audit record, not
    // something a connector should reach for on its own.
    return err(
      fridayError({
        code: 'NOT_IMPLEMENTED',
        message:
          'FRIDAY can only ask about a place she has coordinates for. Looking a name up would mean sending that name to a second service.',
        detail: { place: location.place },
      }),
    )
  }

  return ok({
    host: OPEN_METEO_HOST,
    path: '/v1/forecast',
    query: [
      ['latitude', String(location.latitude)],
      ['longitude', String(location.longitude)],
      [param, fields.join(',')],

      // ★ Sent so the provider does not infer a timezone from the coordinates
      // and answer in it. FRIDAY converts locally; the request stays neutral.
      ['timezone', 'UTC'],
    ],
    precision: location.precision,
    dataCategory: locationCategory(location),
    justification: precisionReason(location),
  })
}

/**
 * The URL a disclosure describes.
 *
 * ★ Built from the disclosure rather than beside it, so what is sent and what
 * was described cannot drift apart.
 *
 * @param disclosure - What was worked out above.
 * @returns The exact URL, and nothing that is not in the disclosure.
 */
export function urlFor(disclosure: Disclosure): string {
  const url = new URL(`https://${disclosure.host}${disclosure.path}`)

  for (const [key, value] of disclosure.query) url.searchParams.append(key, value)

  return url.toString()
}
