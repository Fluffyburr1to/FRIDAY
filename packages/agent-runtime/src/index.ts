/**
 * @friday/agent-runtime — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ★ Agents are the least trustworthy component in FRIDAY: they run
 * AI-generated behaviour over untrusted content, and the architecture treats
 * them accordingly. This package is what makes *"an agent cannot do anything;
 * it can only ask"* true rather than intended.
 *
 * What is here at M5: the manifest boundary, the Guardian mediator, the
 * per-invocation spend ledger, and the termination rules. Worker isolation and
 * the execution loop follow in their own changes.
 *
 * See: README.md · docs/01-bible/11-agent-framework.md
 */

export {
  type AuthorizeFn,
  createMediator,
  type MediationOutcome,
  type Mediator,
  type MediatorOptions,
  type ToolRequest,
} from './mediator.js'
export {
  describeExceeded,
  type ExceededDimension,
  openSpendLedger,
  type SpendLedger,
  type SpendLedgerOptions,
} from './spend.js'
