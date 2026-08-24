import {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  isTransient,
  mayRepeat,
  type OperationContext,
  type RetryPolicy,
  shouldRetry,
} from '@friday/connector-sdk'
import type { ConnectorOperation, CorrelationId, ErrorCode, FridayError } from '@friday/contracts'
import { ERROR_CODES, fridayError } from '@friday/contracts'
import { describe, expect, it } from 'vitest'

const READ: ConnectorOperation = {
  id: 'list-events',
  description: 'List events',
  riskClass: 'low',
  idempotent: true,
  irreversible: false,
  reads: ['calendar_events'],
  writes: [],
  timeoutMs: 30_000,
}

/** The operation the whole rule exists for: repeating it repeats the effect. */
const SEND: ConnectorOperation = {
  ...READ,
  id: 'send-message',
  idempotent: false,
  reads: [],
  writes: ['messages'],
  riskClass: 'medium',
}

const CALL: OperationContext = { correlationId: 'cor_1' as CorrelationId }
const KEYED: OperationContext = { ...CALL, idempotencyKey: 'idem_1' }

function fail(code: ErrorCode): FridayError {
  return fridayError({ code, message: 'x' })
}

describe('which failures are worth trying again', () => {
  it.each(['TIMEOUT', 'CONNECTOR_UNAVAILABLE'] as const)('retries %s', (code) => {
    expect(isTransient(fail(code))).toBe(true)
  })

  it('never retries a blocked egress', () => {
    // ★ Trying again is not resilience here. It is an attempt to get around
    // the allowlist, and it must never be something the framework does by
    // itself.
    expect(isTransient(fail('EGRESS_BLOCKED'))).toBe(false)
  })

  it('never retries the connector throwing', () => {
    // The bug is in this repository. Running it again just runs the bug.
    expect(isTransient(fail('CONNECTOR_FAULTED'))).toBe(false)
  })

  it.each([
    'NOT_AUTHORIZED',
    'APPROVAL_REQUIRED',
    'BUDGET_EXHAUSTED',
    'VALIDATION_FAILED',
  ] as const)('never retries %s', (code) => {
    expect(isTransient(fail(code))).toBe(false)
  })

  it('treats every other failure as permanent by default', () => {
    // ★ An allowlist, not a denylist: a failure mode added to ErrorCode later
    // must default to NOT being retried. Retrying something that can never
    // succeed hammers a service; failing to retry something transient is just
    // a call that did not happen.
    const retried = ERROR_CODES.filter((code) => isTransient(fail(code)))

    expect(retried).toEqual(['TIMEOUT', 'CONNECTOR_UNAVAILABLE'])
  })
})

describe('which operations may be repeated at all', () => {
  it('repeats an idempotent operation freely', () => {
    expect(mayRepeat(READ, CALL)).toBe(true)
  })

  it('refuses to repeat a non-idempotent operation', () => {
    // Chapter 14: "Retrying a non-idempotent operation is how you send an
    // email three times."
    expect(mayRepeat(SEND, CALL)).toBe(false)
  })

  it('repeats a non-idempotent operation only when the provider can dedupe it', () => {
    expect(mayRepeat(SEND, KEYED)).toBe(true)
  })

  it('does not accept an empty key as a key', () => {
    expect(mayRepeat(SEND, { ...CALL, idempotencyKey: '' })).toBe(false)
  })
})

describe('the decision as a whole', () => {
  const policy = DEFAULT_RETRY_POLICY
  const base = { error: fail('TIMEOUT'), operation: READ, context: CALL, policy }

  it('retries while attempts remain', () => {
    expect(shouldRetry({ ...base, attempt: 1 })).toBe(true)
    expect(shouldRetry({ ...base, attempt: 2 })).toBe(true)
  })

  it('stops at the last attempt rather than one past it', () => {
    expect(shouldRetry({ ...base, attempt: policy.maxAttempts })).toBe(false)
  })

  it('refuses a non-idempotent operation even on a transient failure', () => {
    // ★ The condition that must never be traded away: a timeout is exactly
    // when a caller most wants to retry, and exactly when the provider may
    // already have done the thing.
    expect(shouldRetry({ ...base, attempt: 1, operation: SEND })).toBe(false)
  })

  it('allows a non-idempotent operation once it carries a key', () => {
    expect(shouldRetry({ ...base, attempt: 1, operation: SEND, context: KEYED })).toBe(true)
  })

  it('refuses a permanent failure however many attempts remain', () => {
    expect(shouldRetry({ ...base, attempt: 1, error: fail('EGRESS_BLOCKED') })).toBe(false)
  })

  it('can be disabled entirely by a policy of one attempt', () => {
    expect(shouldRetry({ ...base, attempt: 1, policy: { ...policy, maxAttempts: 1 } })).toBe(false)
  })
})

describe('how long to wait', () => {
  const policy: RetryPolicy = { maxAttempts: 10, baseDelayMs: 1_000, maxDelayMs: 30_000 }
  const highest = () => 0.999_999_9
  const lowest = () => 0

  it('doubles the ceiling with each failed attempt', () => {
    expect(backoffDelayMs(1, policy, highest)).toBe(999)
    expect(backoffDelayMs(2, policy, highest)).toBe(1_999)
    expect(backoffDelayMs(3, policy, highest)).toBe(3_999)
    expect(backoffDelayMs(4, policy, highest)).toBe(7_999)
  })

  it('stops doubling at the ceiling', () => {
    // 2^9 * 1000 would be 512 seconds. A connector that waited that long
    // would look broken rather than patient.
    expect(backoffDelayMs(9, policy, highest)).toBe(29_999)
    expect(backoffDelayMs(10, policy, highest)).toBe(29_999)
  })

  it('jitters across the whole range, rather than only near the top', () => {
    // ★ Full jitter is the point, not a refinement. Fixed backoff
    // synchronises every client that failed at the same moment, so they all
    // return together and knock the recovering service straight back over.
    expect(backoffDelayMs(4, policy, lowest)).toBe(0)
    expect(backoffDelayMs(4, policy, () => 0.5)).toBe(4_000)
    expect(backoffDelayMs(4, policy, highest)).toBe(7_999)
  })

  it('never exceeds the ceiling, at any attempt or any roll', () => {
    for (let attempt = 1; attempt <= 20; attempt++) {
      for (const random of [lowest, () => 0.5, highest]) {
        const delay = backoffDelayMs(attempt, policy, random)
        expect(delay).toBeGreaterThanOrEqual(0)
        expect(delay).toBeLessThanOrEqual(policy.maxDelayMs)
      }
    }
  })
})
