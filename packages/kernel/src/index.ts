/**
 * @friday/kernel — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * The property to preserve: the event log is FRIDAY's message bus AND her
 * audit trail, and they are the same thing. That is why the audit trail cannot
 * fall out of sync with reality — writing the event *is* how the action
 * happens. If FRIDAY cannot record, she does not act.
 *
 * See: README.md · docs/01-bible/10-event-bus.md
 */

export { backoffFor, DEFAULT_RETRY_POLICY, type RetryPolicy } from './async-lane.js'
export { announceStart, createEventBus, type EventBus, type EventBusOptions } from './event-bus.js'
export {
  type CompactionPlan,
  DEFAULT_RETENTION,
  isProtectedType,
  PROTECTED_PATTERNS,
  planCompaction,
  protectedEventIds,
  type RetentionPolicy,
  RetentionPolicySchema,
  TIERS,
  type Tier,
  tierOf,
} from './retention.js'
export {
  type AsyncSubscriber,
  matches,
  type SyncSubscriber,
  type Unsubscribe,
} from './subscribers.js'
