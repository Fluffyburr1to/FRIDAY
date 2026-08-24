import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type ConnectorOperation,
  egressPermits,
  mayRetry,
  requiresDryRun,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

/**
 * The fixture is deliberately fictional.
 *
 * Chapter 14 illustrates the manifest with Google Calendar, but which service
 * FRIDAY connects to first is an owner decision that has not been made. A test
 * fixture naming a real provider would read like that decision had been taken
 * quietly, so this exercises the same shape against a service that does not
 * exist.
 */
function validManifest(overrides: Partial<ConnectorManifest> = {}): unknown {
  return {
    id: 'example-calendar',
    service: 'Example Calendar',
    version: '1.0.0',
    auth: {
      type: 'oauth2',
      scopes: ['calendar.readonly', 'calendar.events'],
      scopeJustification: {
        'calendar.readonly': 'Read events to detect conflicts and prepare briefings',
        'calendar.events': 'Create and modify events you have approved',
      },
    },
    egress: {
      hosts: ['api.example.com', 'oauth2.example.com'],
      dataCategories: ['calendar_events', 'contact_emails'],
      transmitsPersonalData: true,
      dataRetentionByProvider: 'Per the provider terms; not controlled by FRIDAY',
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
      {
        id: 'create-event',
        description: 'Create an event you approved',
        riskClass: 'medium',
        idempotent: false,
        irreversible: false,
        reads: [],
        writes: ['calendar_events'],
        timeoutMs: 30_000,
      },
      {
        id: 'delete-event',
        description: 'Delete an event you approved',
        riskClass: 'high',
        idempotent: true,
        irreversible: true,
        reads: [],
        writes: ['calendar_events'],
        timeoutMs: 30_000,
      },
    ],
    rateLimits: { requestsPerMinute: 60, burstSize: 10 },
    healthCheck: { operation: 'list-events', intervalSeconds: 300 },
    supportsDryRun: true,
    ...overrides,
  }
}

function parse(manifest: unknown): ConnectorManifest {
  const result = ConnectorManifestSchema.safeParse(manifest)
  if (!result.success) throw new Error(`fixture should parse: ${result.error.message}`)
  return result.data
}

describe('the manifest as a whole', () => {
  it('accepts a manifest that declares everything it does', () => {
    expect(ConnectorManifestSchema.safeParse(validManifest()).success).toBe(true)
  })

  it('refuses a connector id that is not kebab-case', () => {
    for (const id of ['Example_Calendar', 'exampleCalendar', 'example calendar', '']) {
      expect(ConnectorManifestSchema.safeParse(validManifest({ id })).success).toBe(false)
    }
  })
})

describe('the egress allowlist', () => {
  it('refuses a connector that declares no hosts', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.egress = { ...(manifest.egress as object), hosts: [] }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses a wildcard, because a wildcard is not an allowlist', () => {
    for (const host of ['*', '*.example.com', '.example.com']) {
      const manifest = validManifest() as Record<string, unknown>
      manifest.egress = { ...(manifest.egress as object), hosts: [host] }
      expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
    }
  })

  it('refuses anything that is not a bare hostname', () => {
    for (const host of [
      'https://api.example.com',
      'api.example.com/v3',
      'api.example.com:443',
      'API.example.com',
      'localhost',
    ]) {
      const manifest = validManifest() as Record<string, unknown>
      manifest.egress = { ...(manifest.egress as object), hosts: [host] }
      expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
    }
  })

  it('permits exactly the declared hosts and nothing else', () => {
    const manifest = parse(validManifest())
    expect(egressPermits(manifest, 'api.example.com')).toBe(true)
    expect(egressPermits(manifest, 'oauth2.example.com')).toBe(true)
    expect(egressPermits(manifest, 'evil.example.com')).toBe(false)
    expect(egressPermits(manifest, 'example.com')).toBe(false)
  })

  it('does not let a declared host imply its subdomains', () => {
    const manifest = parse(validManifest())
    expect(egressPermits(manifest, 'cdn.api.example.com')).toBe(false)
    expect(egressPermits(manifest, 'api.example.com.evil.test')).toBe(false)
  })

  it('compares hosts case-insensitively, because DNS does', () => {
    const manifest = parse(validManifest())
    expect(egressPermits(manifest, 'API.Example.com')).toBe(true)
  })

  it('refuses a data category that is not a snake_case token', () => {
    for (const category of ['Calendar Events', 'calendar-events', '']) {
      const manifest = validManifest() as Record<string, unknown>
      manifest.egress = { ...(manifest.egress as object), dataCategories: [category] }
      expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
    }
  })
})

describe('scope justification', () => {
  it('refuses a scope that was not justified', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.auth = {
      type: 'oauth2',
      scopes: ['calendar.readonly', 'calendar.events'],
      scopeJustification: { 'calendar.readonly': 'Read events' },
    }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses a justification for a scope that was not requested', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.auth = {
      type: 'oauth2',
      scopes: ['calendar.readonly'],
      scopeJustification: {
        'calendar.readonly': 'Read events',
        'mail.send': 'Left over from a copied manifest',
      },
    }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses an unauthenticated connector that still asks for scopes', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.auth = { type: 'none', scopes: ['calendar.readonly'], scopeJustification: {} }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })
})

describe('operations', () => {
  it('refuses two operations claiming the same id', () => {
    const manifest = validManifest() as Record<string, unknown>
    const operations = manifest.operations as ConnectorOperation[]
    manifest.operations = [operations[0], { ...operations[0] }]
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses an unbounded call', () => {
    const manifest = validManifest() as Record<string, unknown>
    const operations = manifest.operations as ConnectorOperation[]
    manifest.operations = [{ ...operations[0], timeoutMs: 0 }]
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses an irreversible operation classified below high', () => {
    const manifest = validManifest() as Record<string, unknown>
    const operations = manifest.operations as ConnectorOperation[]
    manifest.operations = [
      operations[0],
      { ...operations[1], irreversible: true, riskClass: 'medium' },
    ]
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('accepts an irreversible operation classified high or above', () => {
    for (const riskClass of ['high', 'critical'] as const) {
      const manifest = validManifest() as Record<string, unknown>
      const operations = manifest.operations as ConnectorOperation[]
      manifest.operations = [operations[0], { ...operations[2], riskClass }]
      expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(true)
    }
  })
})

describe('dry run is mandatory for writes', () => {
  it('refuses a connector that writes but cannot preview', () => {
    const manifest = validManifest({ supportsDryRun: false })
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('allows a read-only connector to omit dry run', () => {
    const manifest = validManifest({ supportsDryRun: false }) as Record<string, unknown>
    const operations = manifest.operations as ConnectorOperation[]
    manifest.operations = [operations[0]]
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(true)
  })

  it('says which operations need a preview', () => {
    const manifest = parse(validManifest())
    expect(manifest.operations.map((op) => requiresDryRun(op))).toEqual([false, true, true])
  })
})

describe('the retry rule', () => {
  it('refuses to retry a non-idempotent operation', () => {
    const manifest = parse(validManifest())
    expect(manifest.operations.map((op) => mayRetry(op))).toEqual([true, false, true])
  })
})

describe('the health check', () => {
  it('refuses a health check naming an operation that does not exist', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.healthCheck = { operation: 'no-such-operation', intervalSeconds: 300 }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })

  it('refuses a probe frequent enough to be the load it is measuring', () => {
    const manifest = validManifest() as Record<string, unknown>
    manifest.healthCheck = { operation: 'list-events', intervalSeconds: 1 }
    expect(ConnectorManifestSchema.safeParse(manifest).success).toBe(false)
  })
})
