import {
  type Actor,
  type CorrelationId,
  type NewEvent,
  type PrincipalId,
  SYSTEM_ACTOR,
} from '@friday/contracts'
import type { CredentialObserver } from './broker.js'
import type { ConnectorObserver } from './runtime.js'

/**
 * Turns what the runtime saw into events for the log.
 *
 * ★ This package does not know the event bus exists, and the kernel does not
 * know connectors exist. The adapter builds a complete `NewEvent` and hands it
 * to a sink; wiring that sink to the bus is one line in whatever composes the
 * system. That is what keeps the dependency arrow pointing the right way —
 * a kernel that imported `connector-sdk` would have inverted it.
 *
 * ★★ **These events are recorded after the fact, and that is a real
 * difference from the rest of FRIDAY.** Chapter 10's rule is that writing the
 * event *is* how the action happens — for a plan or an approval, if she cannot
 * record it, she does not do it. An outbound HTTP call cannot work that way:
 * the call either reached someone or it did not, and no amount of recording
 * afterwards changes that. So a crash between a request and its record loses
 * the record, and the audit trail would show a call that never ended rather
 * than one that never happened.
 *
 * `security.egress.blocked` is exempt from that worry and it is the one that
 * matters most: nothing left the machine, so recording it late loses nothing.
 *
 * Reference: docs/01-bible/14-connector-framework.md · Chapter 10 · Chapter 22
 */

export interface ConnectorEventSink {
  /**
   * Called once per observation.
   *
   * Must not throw: a connector's outbound path is not the place to discover
   * that the log is unwritable, and a throw here would surface as a connector
   * fault. Delivery and durability are the caller's to decide.
   */
  record(event: NewEvent): void
}

export interface RecordingOptions {
  /** Whose data these concern. Every event names a principal. */
  readonly principalId: PrincipalId

  /** Defaults to the system actor: FRIDAY's machinery, not the owner. */
  readonly actor?: Actor | undefined

  /** Injected so a recorded time is testable. */
  readonly now: () => number
}

/**
 * Builds the observer that writes a connector's behaviour to the log.
 *
 * @param sink - Where finished events go.
 * @param options - Whose data, on whose behalf, and the clock.
 * @returns An observer to hand to `createConnectorRuntime`.
 */
export function recordingObserver(
  sink: ConnectorEventSink,
  options: RecordingOptions,
): ConnectorObserver & CredentialObserver {
  const actor = options.actor ?? SYSTEM_ACTOR

  /** Every connector event shares these, so none can be forgotten on one. */
  function event(
    type: string,
    payload: Record<string, unknown>,
    correlationId?: string | undefined,
  ): NewEvent {
    return {
      type,
      actor,
      principalId: options.principalId,
      occurredAt: options.now(),

      // ★ `private`, matching the ceilings the types declare — and `private`
      // rather than `internal` because in this codebase `internal` means
      // eligible to be sent to a cloud model. These name which providers the
      // owner uses and when, which is exactly the disclosure the connector
      // design exists to minimise.
      //
      // None of them carries a credential, a request body, or a response body,
      // so there is nothing here for Chapter 22's redaction layer to catch.
      sensitivity: 'private',
      payload,
      ...(correlationId === undefined ? {} : { correlationId: correlationId as CorrelationId }),
    }
  }

  return {
    onBlocked: (blocked) => {
      // ★ The one Chapter 14 requires to raise a diagnostic. A connector — or
      // something that has taken one over — tried to reach somewhere it never
      // declared, and a refusal nobody is told about teaches the owner nothing.
      sink.record(
        event('security.egress.blocked', {
          connectorId: blocked.connectorId,
          operationId: blocked.operationId,
          host: blocked.host,
          reason: blocked.reason,
        }),
      )
    },

    onCalled: (call) => {
      sink.record(
        event(
          'connector.called',
          {
            connectorId: call.connectorId,
            operationId: call.operationId,
            outcome: call.outcome,
            status: call.status,
            durationMs: call.durationMs,
            attempts: call.attempts,
            errorCode: call.errorCode,
          },
          call.correlationId,
        ),
      )
    },

    onDegraded: (degraded) => {
      sink.record(
        event('connector.degraded', {
          connectorId: degraded.connectorId,
          reason: degraded.reason,
          consecutiveFailures: degraded.consecutiveFailures,
          retryAt: degraded.retryAt,
        }),
      )
    },

    onRecovered: (recovered) => {
      sink.record(
        event('connector.recovered', {
          connectorId: recovered.connectorId,
          degradedForMs: recovered.degradedForMs,
        }),
      )
    },

    onIssued: (issued) => {
      // ★ The scopes and the operation, never the value. "The calendar
      // connector used your key at 14:02" is far less useful than
      // "…to run create-event, for the plan you approved".
      sink.record(
        event(
          'credential.issued',
          {
            connectorId: issued.connectorId,
            operationId: issued.operationId,
            scopes: [...issued.scopes],
            expiresAt: issued.expiresAt,
          },
          issued.correlationId,
        ),
      )
    },

    onRevoked: (revoked) => {
      sink.record(
        event('credential.revoked', {
          connectorId: revoked.connectorId,
          requestedBy: revoked.requestedBy,
          reason: revoked.reason,
        }),
      )
    },
  }
}
