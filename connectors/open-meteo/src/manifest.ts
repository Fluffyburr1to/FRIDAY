import { type ConnectorManifest, ConnectorManifestSchema } from '@friday/contracts'

/**
 * What this connector declares before it may do anything.
 *
 * ★ **`auth.type` is `none`, and that is the reason this connector is first.**
 * Open-Meteo needs no account, no API key, and no signup, so FRIDAY holds no
 * credential for it — nothing to store, leak, renew, or revoke. ADR-0048 chose
 * weather over calendar to minimise disclosure on the first real integration,
 * and a provider requiring no identity at all is the strongest form of that.
 *
 * ★★ **One host.** Open-Meteo also runs a geocoding service for turning place
 * names into coordinates, and it is deliberately absent: it is a second host,
 * and a place name is a different disclosure from a coordinate. Adding it is a
 * manifest change with a visible audit record, which is exactly the friction
 * ADR-0047 accepted.
 *
 * Reference: docs/01-bible/14-connector-framework.md · ADR-0048 · ADR-0051
 */
export const OPEN_METEO_MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
  id: 'open-meteo',
  service: 'Open-Meteo',
  version: '1.0.0',

  auth: { type: 'none', scopes: [], scopeJustification: {} },

  egress: {
    hosts: ['api.open-meteo.com'],

    // ★ Two categories, not one. The privacy dashboard must be able to tell
    // "roughly where I live, daily" from "exactly where I was on Tuesday".
    dataCategories: ['coarse_location', 'precise_location'],

    transmitsPersonalData: true,
    dataRetentionByProvider:
      'Open-Meteo states it does not require an account and does not track users; retention is theirs and not controlled by FRIDAY.',
  },

  operations: [
    {
      id: 'current-weather',
      description: 'What the weather is like right now, where you are',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['coarse_location'],
      writes: [],
      timeoutMs: 10_000,
    },
    {
      id: 'daily-forecast',
      description: 'What the weather will be like over the next few days',
      riskClass: 'low',
      idempotent: true,
      irreversible: false,
      reads: ['coarse_location'],
      writes: [],
      timeoutMs: 10_000,
    },
  ],

  // Well inside Open-Meteo's published free-tier allowance. FRIDAY asking
  // about the weather more than once a second would be a bug, not a need.
  rateLimits: { requestsPerMinute: 60, burstSize: 10 },

  healthCheck: { operation: 'current-weather', intervalSeconds: 900 },

  // Nothing here writes, so there is nothing to preview.
  supportsDryRun: false,
})

/** Where every request goes. Declared above and enforced by the SDK. */
export const OPEN_METEO_HOST = 'api.open-meteo.com'
