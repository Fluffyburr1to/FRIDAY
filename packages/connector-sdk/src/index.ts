/**
 * @friday/connector-sdk — the public surface.
 *
 * Connectors are the only components with network access, and this package is
 * what makes them uniform enough that privacy and reliability are enforceable
 * at one boundary rather than in every connector's judgment.
 *
 * The manifest itself lives in `@friday/contracts`, not here — a rule this SDK
 * enforced alone would be a rule a connector could sidestep before the SDK was
 * ever involved.
 *
 * See: README.md · docs/01-bible/14-connector-framework.md
 */
// ── The contract a connector implements ─────────────────────────────────────

export {
  type BrokerOptions,
  type CredentialObserver,
  type CredentialSource,
  createCredentialBroker,
  DEFAULT_LEASE_MS,
} from './broker.js'
export {
  BREAKER_STATES,
  type BreakerPolicy,
  type BreakerState,
  type CircuitBreaker,
  createCircuitBreaker,
  DEFAULT_BREAKER_POLICY,
  tripsBreaker,
} from './circuit-breaker.js'
export type {
  AnyOperationMap,
  Connector,
  ConnectorContext,
  ConnectorOperationMap,
  DryRunResult,
  OperationContext,
} from './connector.js'
export { operationById } from './connector.js'
// ── Credentials: asked for, never held ──────────────────────────────────────
export {
  type CredentialBroker,
  type CredentialRequest,
  checkRequestedScopes,
  credentialRequestFor,
  type IssuedCredential,
  isCredentialLive,
  issuedCredential,
  type RevocationRequest,
} from './credentials.js'
// ── The boundary its requests pass through ──────────────────────────────────
export {
  type BlockedEgress,
  type BlockedEgressReason,
  type ConnectorFetch,
  type ConnectorFetchOptions,
  type ConnectorRequestInit,
  createConnectorFetch,
} from './egress.js'
// ── The rules it cannot break by being careless ─────────────────────────────
export {
  CONNECTOR_STATES,
  type ConnectorState,
  type SupervisedConnector,
  superviseConnector,
} from './lifecycle.js'
// ── Reliability, implemented once rather than per connector ─────────────────
export {
  createRateLimiter,
  type RateLimitDecision,
  type RateLimiter,
  type RateLimits,
  rateLimiterFor,
} from './rate-limit.js'
// ── What she did, on the record ─────────────────────────────────────────────
export {
  type ConnectorEventSink,
  type RecordingOptions,
  recordingObserver,
} from './recording.js'
export {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  isRetryableStatus,
  isTransient,
  mayRepeat,
  nextRetryDelay,
  type RetryDelay,
  type RetryPolicy,
  retryAfterMs,
  shouldRetry,
} from './retry.js'
// ── The whole outbound path, composed in one place ──────────────────────────
export {
  type ConnectorObserver,
  type ConnectorRuntime,
  type ConnectorRuntimeOptions,
  createConnectorRuntime,
} from './runtime.js'
