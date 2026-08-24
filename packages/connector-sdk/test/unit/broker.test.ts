import {
  type CredentialRequest,
  type CredentialSource,
  createCredentialBroker,
  DEFAULT_LEASE_MS,
  recordingObserver,
} from '@friday/connector-sdk'
import {
  type ConnectorManifest,
  ConnectorManifestSchema,
  createEventRegistry,
  err,
  type FridayError,
  fridayError,
  isErr,
  isOk,
  type NewEvent,
  NewEventSchema,
  ok,
  type PrincipalId,
  type Result,
  registerConnectorEventTypes,
  uuidv7,
} from '@friday/contracts'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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
      description: 'List notes',
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

const SECRET = 'not-a-real-key-value'

let clock: number
let recorded: NewEvent[]
let source: CredentialSource

function request(overrides: Partial<CredentialRequest> = {}): CredentialRequest {
  return {
    connectorId: 'example-notes',
    operationId: 'list-notes',
    scopes: ['notes.read'],
    correlationId: uuidv7(),
    ...overrides,
  }
}

beforeEach(() => {
  clock = 1_000
  recorded = []
  source = {
    read: vi.fn(() => ok(SECRET) as Result<string, FridayError>),
    revoke: vi.fn(() => ok(undefined) as Result<void, FridayError>),
  }
})

function broker(overrides = {}) {
  return createCredentialBroker({
    manifests: [MANIFEST],
    source,
    now: () => clock,
    observer: recordingObserver(
      { record: (event) => recorded.push(event) },
      { principalId: 'usr_owner' as PrincipalId, now: () => clock },
    ),
    ...overrides,
  })
}

describe('what it refuses before a secret is even read', () => {
  it('refuses a scope the manifest does not declare', async () => {
    // ★ Checked before the read, so a connector overreaching never causes the
    // secret to be materialised at all.
    const result = await broker().issue(request({ scopes: ['notes.delete'] }))

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('SCOPE_NOT_DECLARED')
    expect(source.read).not.toHaveBeenCalled()
  })

  it('refuses a connector it has never heard of', async () => {
    // Without a manifest there is nothing to check scopes against, and
    // handing over the stored value anyway would be issuing an unbounded
    // credential to something nobody declared.
    const result = await broker().issue(request({ connectorId: 'not-declared' }))

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('SCOPE_NOT_DECLARED')
    expect(source.read).not.toHaveBeenCalled()
  })

  it('refuses a request naming no scope at all', async () => {
    const result = await broker().issue(request({ scopes: [] }))

    expect(isErr(result)).toBe(true)
    expect(source.read).not.toHaveBeenCalled()
  })

  it('records nothing when it refuses', async () => {
    await broker().issue(request({ scopes: ['notes.delete'] }))

    expect(recorded).toEqual([])
  })
})

describe('what it hands over', () => {
  it('issues a credential for a declared scope', async () => {
    const result = await broker().issue(request())

    expect(isOk(result)).toBe(true)
    if (isOk(result)) {
      expect(result.value.reveal()).toBe(SECRET)
      expect(result.value.scopes).toEqual(['notes.read'])
    }
  })

  it('gives it a lease, so a connector cannot hold it indefinitely', async () => {
    const result = await broker().issue(request())

    if (isOk(result)) expect(result.value.expiresAt).toBe(clock + DEFAULT_LEASE_MS)
  })

  it('hands over something that redacts itself', async () => {
    // The broker must not be the place a secret escapes.
    const result = await broker().issue(request())

    if (isOk(result)) {
      expect(`${result.value}`).not.toContain(SECRET)
      expect(JSON.stringify(result.value)).not.toContain(SECRET)
    }
  })

  it('passes a revoked credential through as revoked', async () => {
    // ★ "You disconnected this" and "this was never set up" need different
    // answers, so the broker does not flatten them into one failure.
    source.read = vi.fn(() =>
      err(fridayError({ code: 'CREDENTIAL_REVOKED', message: 'disconnected' })),
    )

    const result = await broker().issue(request())

    expect(isErr(result)).toBe(true)
    if (isErr(result)) expect(result.error.code).toBe('CREDENTIAL_REVOKED')
  })
})

describe('revoking', () => {
  it('withdraws through the store', async () => {
    expect(isOk(await broker().revoke('example-notes'))).toBe(true)
    expect(source.revoke).toHaveBeenCalledWith('example-notes')
  })

  it('revokes a connector FRIDAY no longer declares', async () => {
    // ★ Refusing to withdraw access because the thing holding it is no longer
    // declared would be exactly backwards.
    const result = await broker().revoke('a-connector-since-removed')

    expect(isOk(result)).toBe(true)
    expect(source.revoke).toHaveBeenCalledWith('a-connector-since-removed')
  })

  it('records nothing when the store could not withdraw it', async () => {
    // Saying it was revoked when it was not is the worst available outcome.
    source.revoke = vi.fn(() =>
      err(fridayError({ code: 'CREDENTIAL_UNAVAILABLE', message: 'keychain locked' })),
    )

    const result = await broker().revoke('example-notes')

    expect(isErr(result)).toBe(true)
    expect(recorded).toEqual([])
  })
})

describe('what reaches the record', () => {
  it('records why a credential was issued, not merely that it was', async () => {
    const correlationId = uuidv7()

    await broker().issue(request({ correlationId }))

    const [issued] = recorded
    expect(issued?.type).toBe('credential.issued')
    expect(issued?.correlationId).toBe(correlationId)
    expect(issued?.payload).toMatchObject({
      connectorId: 'example-notes',
      operationId: 'list-notes',
      scopes: ['notes.read'],
    })
  })

  it('never records the secret', async () => {
    await broker().issue(request())
    await broker().revoke('example-notes')

    expect(JSON.stringify(recorded)).not.toContain(SECRET)
  })

  it('records a revocation', async () => {
    await broker().revoke('example-notes')

    const [event] = recorded
    expect(event?.type).toBe('credential.revoked')
    expect(event?.payload).toMatchObject({ connectorId: 'example-notes', requestedBy: 'owner' })
  })

  it('produces events the log would accept', async () => {
    const registry = registerConnectorEventTypes(createEventRegistry())

    await broker().issue(request())
    await broker().revoke('example-notes')

    expect(recorded).toHaveLength(2)
    for (const event of recorded) {
      expect(NewEventSchema.safeParse(event).success, `${event.type} malformed`).toBe(true)

      const validated = registry.validate({
        type: event.type,
        payloadVersion: event.payloadVersion ?? 1,
        payload: event.payload,
      })
      expect(validated.ok, `${event.type} would be refused by the bus`).toBe(true)
    }
  })

  it('keeps credential events off the machine', async () => {
    await broker().issue(request())

    for (const event of recorded) expect(event.sensitivity).toBe('private')
  })
})
