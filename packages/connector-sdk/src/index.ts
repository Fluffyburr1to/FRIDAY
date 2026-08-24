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
export {
  type BlockedEgress,
  type BlockedEgressReason,
  type ConnectorFetch,
  type ConnectorFetchOptions,
  createConnectorFetch,
} from './egress.js'
