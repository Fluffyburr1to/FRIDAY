import {
  describeDisclosure,
  OPEN_METEO_HOST,
  OPEN_METEO_MANIFEST,
  urlFor,
  weatherNear,
} from '@friday/connector-open-meteo'
import { coarsen, isErr, isOk, type Location, LocationSchema } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/** Precise enough to identify a doorstep, which is the point. */
const EXACT = { latitude: 55.953_252_1, longitude: -3.188_267_4 }

const PRECISE: Location = LocationSchema.parse({
  precision: 'precise',
  ...EXACT,
  justification: 'You asked about the summit, not about where you live.',
})

function disclose(operationId: string, location: Location) {
  const result = describeDisclosure(operationId, location)
  if (!isOk(result)) throw new Error('expected a disclosure')
  return result.value
}

describe('what leaves the machine', () => {
  it('goes to exactly one host, the one the manifest declares', () => {
    const disclosure = disclose('current-weather', coarsen(EXACT.latitude, EXACT.longitude))

    expect(disclosure.host).toBe(OPEN_METEO_HOST)
    expect(OPEN_METEO_MANIFEST.egress.hosts).toEqual([OPEN_METEO_HOST])
  })

  it('carries the coordinates, the fields asked for, and nothing else', () => {
    // ★ Asserted as the complete list rather than by spot-checking. A new
    // parameter added later fails this test, which is the point — anything
    // else added to the request is a disclosure nobody reviewed.
    const disclosure = disclose('current-weather', coarsen(EXACT.latitude, EXACT.longitude))

    expect(disclosure.query.map(([key]) => key)).toEqual([
      'latitude',
      'longitude',
      'current',
      'timezone',
    ])
  })

  it('sends a rounded point by default', () => {
    const disclosure = disclose(
      'current-weather',
      weatherNear(EXACT.latitude, EXACT.longitude).location,
    )

    expect(disclosure.query).toContainEqual(['latitude', '55.95'])
    expect(disclosure.query).toContainEqual(['longitude', '-3.19'])
    expect(disclosure.precision).toBe('coarse')
  })

  it('never sends the unrounded coordinate by default', () => {
    const url = urlFor(
      disclose('current-weather', weatherNear(EXACT.latitude, EXACT.longitude).location),
    )

    expect(url).not.toContain('55.953')
    expect(url).not.toContain('3.1882')
  })

  it('sends the exact point only when a reason was written down', () => {
    const disclosure = disclose('current-weather', PRECISE)

    expect(disclosure.precision).toBe('precise')
    expect(disclosure.justification).toBe('You asked about the summit, not about where you live.')
    expect(disclosure.query).toContainEqual(['latitude', '55.9532521'])
  })

  it('files coarse and precise under different categories', () => {
    expect(disclose('current-weather', coarsen(0, 0)).dataCategory).toBe('coarse_location')
    expect(disclose('current-weather', PRECISE).dataCategory).toBe('precise_location')
  })

  it('declares both categories in the manifest, so neither is a surprise', () => {
    expect(OPEN_METEO_MANIFEST.egress.dataCategories).toEqual([
      'coarse_location',
      'precise_location',
    ])
  })

  it('reports no justification when none was needed', () => {
    expect(disclose('current-weather', coarsen(0, 0)).justification).toBeNull()
  })
})

describe('what it refuses to send', () => {
  it('refuses a place name rather than looking it up', () => {
    // ★ Geocoding means a second host and a different kind of disclosure — a
    // name is not a coordinate. That is a manifest change with an audit
    // record, not something the connector reaches for on its own.
    const result = describeDisclosure('current-weather', {
      precision: 'named-place',
      place: 'Edinburgh',
    })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_IMPLEMENTED')
  })

  it('refuses an operation it does not have', () => {
    expect(isErr(describeDisclosure('nuclear-launch', coarsen(0, 0)))).toBe(true)
  })

  it('carries no identifier of any kind', () => {
    const url = urlFor(disclose('daily-forecast', coarsen(EXACT.latitude, EXACT.longitude)))

    for (const forbidden of ['key', 'token', 'apikey', 'user', 'id=', 'session', 'correlation']) {
      expect(url.toLowerCase(), `${forbidden} must not appear`).not.toContain(forbidden)
    }
  })

  it('asks in UTC, so the answer is not localised by inference', () => {
    // Letting the provider infer a timezone from the coordinates would have it
    // reason about where the owner is, which is more than it was told.
    expect(disclose('current-weather', coarsen(0, 0)).query).toContainEqual(['timezone', 'UTC'])
  })
})

describe('the url is built from the disclosure, not beside it', () => {
  it('contains exactly what the disclosure described', () => {
    // ★ There is no second code path that could send something the
    // disclosure does not mention.
    const disclosure = disclose('current-weather', coarsen(EXACT.latitude, EXACT.longitude))
    const url = new URL(urlFor(disclosure))

    expect(url.hostname).toBe(disclosure.host)
    expect(url.pathname).toBe(disclosure.path)
    expect([...url.searchParams.keys()]).toEqual(disclosure.query.map(([key]) => key))
  })

  it('always uses https', () => {
    expect(urlFor(disclose('current-weather', coarsen(0, 0)))).toMatch(/^https:/)
  })
})

describe('the manifest holds no credential', () => {
  it('declares that it authenticates with nothing', () => {
    // ★ The property that made this the right first connector: there is no
    // secret to store, leak, renew, or revoke.
    expect(OPEN_METEO_MANIFEST.auth.type).toBe('none')
    expect(OPEN_METEO_MANIFEST.auth.scopes).toEqual([])
  })

  it('writes nothing, so nothing needs approving', () => {
    for (const operation of OPEN_METEO_MANIFEST.operations) {
      expect(operation.writes, `${operation.id} writes`).toEqual([])
      expect(operation.idempotent, `${operation.id} is not idempotent`).toBe(true)
    }
  })
})
