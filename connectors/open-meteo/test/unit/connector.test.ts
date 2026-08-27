import {
  createOpenMeteoConnector,
  OPEN_METEO_MANIFEST,
  weatherNear,
} from '@friday/connector-open-meteo'
import { createConnectorFetch, superviseConnector } from '@friday/connector-sdk'
import { coarsen, isErr, LocationSchema } from '@friday/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const EXACT = { latitude: 55.953_252_1, longitude: -3.188_267_4 }

let seen: string[]

function connector(
  respond = () => Promise.resolve(new Response('{"current":{}}', { status: 200 })),
) {
  const recording = ((url: string) => {
    seen.push(url)
    return respond()
  }) as unknown as typeof globalThis.fetch

  return superviseConnector(
    createOpenMeteoConnector({
      fetch: createConnectorFetch({ manifest: OPEN_METEO_MANIFEST, fetch: recording }),
      now: () => 1_000,
    }),
  )
}

beforeEach(() => {
  seen = []
})

async function started(respond?: () => Promise<Response>) {
  const built = connector(respond)
  await built.initialize({
    fetch: createConnectorFetch({ manifest: OPEN_METEO_MANIFEST, fetch: vi.fn() as never }),
    now: () => 1_000,
  })
  return built
}

describe('asking about the weather', () => {
  it('reaches the declared host and nowhere else', async () => {
    const open = await started()

    await open.execute('current-weather', weatherNear(EXACT.latitude, EXACT.longitude), {
      correlationId: '01920000-0000-7000-8000-000000000001' as never,
    })

    expect(seen).toHaveLength(1)
    expect(new URL(seen[0] as string).hostname).toBe('api.open-meteo.com')
  })

  it('sends a rounded location without being asked to', async () => {
    // ★ The default is coarse, and nothing had to remember to make it so.
    const open = await started()

    await open.execute('current-weather', weatherNear(EXACT.latitude, EXACT.longitude), {
      correlationId: '01920000-0000-7000-8000-000000000002' as never,
    })

    expect(seen[0]).toContain('latitude=55.95')
    expect(seen[0]).not.toContain('55.953')
  })

  it('refuses a location it cannot place', async () => {
    const open = await started()

    const result = await open.execute(
      'current-weather',
      { location: { precision: 'nope' } },
      {
        correlationId: '01920000-0000-7000-8000-000000000003' as never,
      },
    )

    expect(isErr(result)).toBe(true)
    expect(seen).toEqual([])
  })

  it('refuses a precise location supplied without a reason', async () => {
    // ★ The rule is in the shape: this input cannot be a valid location, so
    // it never reaches the point where a URL is built.
    const open = await started()

    const result = await open.execute(
      'current-weather',
      { location: { precision: 'precise', ...EXACT } },
      { correlationId: '01920000-0000-7000-8000-000000000004' as never },
    )

    expect(isErr(result)).toBe(true)
    expect(seen).toEqual([])
  })

  it('sends the exact point when a reason was given', async () => {
    const open = await started()

    await open.execute(
      'current-weather',
      {
        location: LocationSchema.parse({
          precision: 'precise',
          ...EXACT,
          justification: 'You asked about the summit.',
        }),
      },
      { correlationId: '01920000-0000-7000-8000-000000000005' as never },
    )

    expect(seen[0]).toContain('latitude=55.9532521')
  })

  it('reports a refusal from the provider rather than claiming success', async () => {
    const open = await started(() => Promise.resolve(new Response('nope', { status: 429 })))

    const result = await open.execute('current-weather', weatherNear(0, 0), {
      correlationId: '01920000-0000-7000-8000-000000000006' as never,
    })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CONNECTOR_UNAVAILABLE')
  })
})

describe('checking itself', () => {
  it('does not send the owner anywhere to find out if a service is up', async () => {
    // ★ A health check every fifteen minutes carrying the owner's location
    // would be a daily location feed dressed as monitoring.
    const open = await started()

    await open.health()

    expect(seen[0]).toContain('latitude=0')
    expect(seen[0]).toContain('longitude=0')
  })

  it('says unhealthy rather than guessing when the service does not answer', async () => {
    const open = await started(() => Promise.reject(new Error('ECONNREFUSED')))

    expect((await open.health()).status).toBe('unhealthy')
  })
})

describe('previewing', () => {
  it('refuses rather than inventing one, because nothing here writes', async () => {
    const open = await started()

    const result = await open.dryRun('current-weather', weatherNear(0, 0))

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('NOT_IMPLEMENTED')
  })
})

describe('the boundary still applies', () => {
  it('cannot be talked into reaching another host', async () => {
    // The connector builds its own URL, so this asserts the shape rather than
    // an escape: there is no input that produces a different host.
    const open = await started()

    for (const location of [coarsen(90, 180), coarsen(-90, -180), coarsen(0, 0)]) {
      await open.execute(
        'current-weather',
        { location },
        {
          correlationId: '01920000-0000-7000-8000-000000000007' as never,
        },
      )
    }

    for (const url of seen) expect(new URL(url).hostname).toBe('api.open-meteo.com')
  })

  it('never calls an operation the manifest does not declare', async () => {
    const open = await started()

    const result = await open.execute('exfiltrate', weatherNear(0, 0), {
      correlationId: '01920000-0000-7000-8000-000000000008' as never,
    })

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('OPERATION_NOT_DECLARED')
    expect(seen).toEqual([])
  })
})
