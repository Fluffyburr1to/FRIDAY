import {
  createOpenMeteoConnector,
  OPEN_METEO_MANIFEST,
  weatherNear,
} from '@friday/connector-open-meteo'
import { describeConnectorContract } from './conformance.js'

/**
 * FRIDAY's first real connector, against the same suite every connector must
 * pass — the one proven to fail in `conformance.test.ts`.
 *
 * ★ **No external call happens here.** The fixtures below answer as
 * Open-Meteo would, from shapes taken from its published documentation. No
 * account exists, no key exists, and nothing in this repository has contacted
 * the service.
 */

/** Answers as Open-Meteo does, in the shape its documentation describes. */
function fixtures(url: string): Promise<Response> {
  const target = new URL(url)

  if (target.hostname !== 'api.open-meteo.com') {
    return Promise.resolve(new Response('wrong host', { status: 404 }))
  }

  if (target.searchParams.has('daily')) {
    return Promise.resolve(
      new Response(
        JSON.stringify({
          latitude: 55.95,
          longitude: -3.19,
          daily: {
            time: ['2026-08-24', '2026-08-25'],
            weather_code: [3, 61],
            temperature_2m_max: [18.4, 16.1],
            temperature_2m_min: [11.2, 10.8],
          },
        }),
        { status: 200 },
      ),
    )
  }

  return Promise.resolve(
    new Response(
      JSON.stringify({
        latitude: 55.95,
        longitude: -3.19,
        current: {
          time: '2026-08-24T14:00',
          temperature_2m: 17.3,
          apparent_temperature: 15.9,
          weather_code: 3,
          wind_speed_10m: 12.6,
        },
      }),
      { status: 200 },
    ),
  )
}

describeConnectorContract({
  manifest: OPEN_METEO_MANIFEST,

  // One sample per declared operation. A missing entry fails the suite rather
  // than skipping the operation — see conformance.ts.
  samples: {
    'current-weather': weatherNear(55.953_252_1, -3.188_267_4),
    'daily-forecast': weatherNear(55.953_252_1, -3.188_267_4),
  },

  respond: fixtures,
  create: createOpenMeteoConnector,
})
