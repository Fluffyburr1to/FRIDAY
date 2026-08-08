import { registerGuardianEventTypes } from '@friday/contracts'
import type { EventBus } from '@friday/kernel'

/**
 * @friday/clerk — records what the Guardian decided, and decides nothing.
 *
 * The seam between the component that decides and the log that remembers.
 * `packages/guardian` answers questions and stays a pure, synchronous function
 * of the rules; `packages/kernel` records events and knows nothing about
 * authorization. Neither claims the job of writing down what was decided, and
 * this package is that job.
 *
 * Two entry points, because the two halves need different things:
 *
 * - `createApprovalClerk` raises and settles approvals. It needs a store and a
 *   bus. **It needs no Guardian** — Chapter 19's rules about an answer live in
 *   the approval registry — which is what lets `apps/core` settle an approval
 *   without building a policy engine and a capability signer it never uses.
 * - `createAuthorizingClerk` asks the Guardian and records the answer. It
 *   needs a Guardian, and composes the first.
 *
 * Reference: docs/adr/0031-the-clerk-records-what-the-guardian-decided.md ·
 * docs/adr/0032-the-guardians-state-moves-into-the-event-log-database.md
 */

export {
  type ApprovalClerk,
  type ApprovalClerkOptions,
  type ClerkRequestInput,
  createApprovalClerk,
  type RecordedRequest,
  type RecordedResponse,
} from './approval-clerk.js'

export {
  type ApprovalExplanation,
  type AuthorizingClerk,
  type AuthorizingClerkOptions,
  createAuthorizingClerk,
  type DecisionRecorder,
  type RecordedDecision,
} from './authorizing-clerk.js'

export { type CapturedWrite, type DeferredApprovalStore, deferWrites } from './deferred-store.js'

/**
 * Teaches a bus the Guardian's event types.
 *
 * ★ This is the only place it happens, and that is a safety property rather
 * than tidiness. `publish` refuses a type the registry does not know, so a
 * process that never called this — a recovery tool, `friday events emit`, a
 * script written in two years — **cannot record an approval**, even if it
 * supplies the exact type string. Registering these globally in the kernel
 * would hand every holder of a bus the ability to forge one.
 *
 * Call it once per bus, at composition. Registering twice throws, which is
 * correct: two components disagreeing about an event's shape is a bug, not a
 * condition to recover from.
 *
 * @param bus - The bus the clerk will publish through.
 * @returns The same bus, so composition can be chained.
 */
export function registerClerkEventTypes(bus: EventBus): EventBus {
  registerGuardianEventTypes(bus.registry)
  return bus
}
