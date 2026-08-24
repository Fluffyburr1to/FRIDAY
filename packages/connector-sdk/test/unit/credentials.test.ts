import {
  type CredentialRequest,
  checkRequestedScopes,
  credentialRequestFor,
  isCredentialLive,
  issuedCredential,
} from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  type CorrelationId,
  isErr,
  isOk,
} from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const MANIFEST: ConnectorManifest = ConnectorManifestSchema.parse({
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
    dataRetentionByProvider: 'Per the provider terms',
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
  ],
  rateLimits: { requestsPerMinute: 60, burstSize: 10 },
  healthCheck: { operation: 'list-notes', intervalSeconds: 300 },
  supportsDryRun: false,
})

function request(overrides: Partial<CredentialRequest> = {}): CredentialRequest {
  return {
    connectorId: 'example-notes',
    operationId: 'list-notes',
    scopes: ['notes.read'],
    correlationId: 'cor_1',
    ...overrides,
  }
}

const SECRET = 'ya29.super-secret-token-value'

function credential(expiresAt = 60_000) {
  return issuedCredential({
    connectorId: 'example-notes',
    scopes: ['notes.read'],
    expiresAt,
    token: SECRET,
  })
}

describe('a credential does not leak by being handled', () => {
  it('redacts when interpolated into a string', () => {
    // ★ The commonest way a secret escapes: someone builds an error message.
    expect(`token=${credential()}`).toBe('token=[redacted credential]')
  })

  it('redacts when serialised', () => {
    expect(JSON.stringify(credential())).toBe('"[redacted credential]"')
  })

  it('redacts inside a larger object being logged', () => {
    const line = JSON.stringify({ connector: 'example-notes', credential: credential() })

    expect(line).not.toContain(SECRET)
  })

  it('does not expose the secret by spreading or enumerating', () => {
    // Closed over rather than stored as a property, so a `{...credential}`
    // that gets logged carries nothing.
    const spread = { ...credential() }

    expect(JSON.stringify(spread)).not.toContain(SECRET)
    expect(Object.values(spread)).not.toContain(SECRET)
  })

  it('gives the secret only to something that asks for it by name', () => {
    // `reveal` is one greppable word, so every real use is visible in review.
    expect(credential().reveal()).toBe(SECRET)
  })

  it('still says which connector and scopes it is for', () => {
    // Redaction must not make the credential useless to a diagnostic.
    const issued = credential()

    expect(issued.connectorId).toBe('example-notes')
    expect(issued.scopes).toEqual(['notes.read'])
  })
})

describe('a credential expires', () => {
  it('is live before its expiry and dead after', () => {
    const issued = credential(1_000)

    expect(isCredentialLive(issued, 999)).toBe(true)
    expect(isCredentialLive(issued, 1_000)).toBe(false)
    expect(isCredentialLive(issued, 1_001)).toBe(false)
  })
})

describe('scope minimisation, enforced at issuance', () => {
  it('approves a scope the connector declared', () => {
    const result = checkRequestedScopes(MANIFEST, request())

    expect(isOk(result)).toBe(true)
    if (isOk(result)) expect(result.value).toEqual(['notes.read'])
  })

  it('refuses a scope the connector did not declare', () => {
    // ★ Chapter 14: the narrowest point in the system, and the right place to
    // refuse. Even if the underlying grant is broader, the connector gets only
    // what its own manifest justified.
    const result = checkRequestedScopes(MANIFEST, request({ scopes: ['notes.delete'] }))

    expect(isErr(result)).toBe(true)
    if (isErr(result)) {
      expect(result.error.code).toBe('SCOPE_NOT_DECLARED')
      expect(result.error.detail).toMatchObject({ undeclared: ['notes.delete'] })
    }
  })

  it('refuses the whole request when any one scope is undeclared', () => {
    // Not a partial grant: quietly dropping the bad scope would let a
    // connector discover what it can get away with.
    const result = checkRequestedScopes(
      MANIFEST,
      request({ scopes: ['notes.read', 'notes.delete'] }),
    )

    expect(isErr(result)).toBe(true)
  })

  it('refuses a request that names no scope at all', () => {
    // An empty request is not "everything" — it is a connector that forgot to
    // say what it needs, and reading it as the full grant is exactly the
    // over-broad issuance the manifest exists to prevent.
    expect(isErr(checkRequestedScopes(MANIFEST, request({ scopes: [] })))).toBe(true)
  })

  it('refuses a connector asking for another connector credential', () => {
    const result = checkRequestedScopes(MANIFEST, request({ connectorId: 'example-mail' }))

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('SCOPE_NOT_DECLARED')
  })

  it('carries the correlation id onto the refusal', () => {
    // So a refused issuance is traceable to the request that caused it.
    const result = checkRequestedScopes(MANIFEST, request({ scopes: [], correlationId: 'cor_9' }))

    if (isErr(result)) expect(result.error.correlationId).toBe('cor_9')
  })
})

describe('building the request', () => {
  it('names the connector, the operation, and the call', () => {
    // ★ The operation is here so the audit trail records WHY a credential was
    // issued, not merely that it was.
    const built = credentialRequestFor(MANIFEST, 'list-notes', ['notes.read'], {
      correlationId: 'cor_7' as CorrelationId,
    })

    expect(built).toEqual({
      connectorId: 'example-notes',
      operationId: 'list-notes',
      scopes: ['notes.read'],
      correlationId: 'cor_7',
    })
  })
})
