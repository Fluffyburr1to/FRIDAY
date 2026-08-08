import {
  createEventRegistry,
  type EventRegistry,
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  type NewEvent,
  ok,
  type PrincipalId,
  type Result,
  registerCoreEventTypes,
  SYSTEM_ACTOR,
} from '@friday/contracts'
import type { ChainVerification, Storage } from '@friday/storage'
import { createSilentLogger, type Logger } from '@friday/telemetry'
import { createLane, DEFAULT_RETRY_POLICY, type Lane, type RetryPolicy } from './async-lane.js'
import {
  type AsyncSubscriber,
  matches,
  type SyncSubscriber,
  type Unsubscribe,
} from './subscribers.js'

/**
 * The event bus.
 *
 * Three properties define it, and all three are load-bearing:
 *
 *   1. **Durable before dispatch.** The event is committed to `events.db`
 *      before any handler is notified. A crash mid-dispatch loses nothing.
 *   2. **Totally ordered.** Gapless sequence numbers. One authoritative
 *      history, which is what makes replay and explanation possible.
 *   3. **At-least-once delivery.** Handlers must be idempotent.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

export interface EventBusOptions {
  storage: Storage

  /** Whose data this instance holds. Stamped on events that omit it. */
  principalId: PrincipalId

  logger?: Logger

  /** Overridden in tests so a backoff does not take real seconds. */
  retry?: RetryPolicy

  /** Injectable for the same reason. */
  sleep?: (ms: number) => Promise<void>
}

/**
 * Work that must happen in the same transaction as the event describing it.
 *
 * ★ Runs INSIDE the append transaction, and receives the event exactly as it
 * was written — including the `id` and `seq` assigned during the append, which
 * do not exist before it. If it throws, the event is rolled back with it.
 *
 * This is what lets a caller keep authoritative state and its record from ever
 * disagreeing: the two become one write. The bus stays domain-agnostic — it
 * offers the transaction, and knows nothing about what is written inside it.
 *
 * Synchronous by type, for the reason `SyncSubscriber` is: a promise cannot be
 * awaited inside a SQLite transaction, and one that was would have its failure
 * escape the rollback.
 *
 * Reference: docs/adr/0032 — amendment of 2026-08-08
 */
export type TransactionalRecord = (event: FridayEvent) => void

export interface EventBus {
  /**
   * Records an event and dispatches it.
   *
   * @param event - The event to publish. Its payload is validated against the
   *   registered schema for its type first; an unregistered or malformed event
   *   is refused rather than written.
   * @param onRecorded - Optional work to perform inside the append
   *   transaction, after the row is written and before it is committed.
   *   Omitting it produces exactly the behaviour every existing caller has.
   * @returns The recorded event, or a typed error.
   */
  publish(
    event: NewEvent,
    onRecorded?: TransactionalRecord,
  ): Promise<Result<FridayEvent, FridayError>>

  subscribeSync(subscriber: SyncSubscriber): Unsubscribe
  subscribeAsync(subscriber: AsyncSubscriber): Unsubscribe

  /** Replays anything each async subscriber missed while it was not running. */
  start(): Promise<Result<void, FridayError>>

  /** Drains the queues and stops. Safe to call twice. */
  stop(): Promise<void>

  /** The event type registry. Departments register their types through it. */
  readonly registry: EventRegistry

  verifyChain(input?: { fromSeq?: number | undefined }): Result<ChainVerification, FridayError>

  latestSeq(): number
}

/**
 * Creates the event bus.
 *
 * @param options - Storage, the principal, and the retry policy.
 * @returns A bus with the core event types already registered.
 */
export function createEventBus(options: EventBusOptions): EventBus {
  const { storage, principalId } = options
  const logger = (options.logger ?? createSilentLogger()).child({ module: 'kernel.event-bus' })
  const retry = options.retry ?? DEFAULT_RETRY_POLICY
  const sleep = options.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)))

  const registry = registerCoreEventTypes(createEventRegistry())
  const syncSubscribers: SyncSubscriber[] = []
  const asyncSubscribers = new Map<string, { subscriber: AsyncSubscriber; lane: Lane }>()

  let running = false

  /**
   * Publishes `system.degraded` when a lane gives up repeatedly.
   *
   * Article II: the owner sees it. A subscriber that has quietly stopped
   * keeping up is exactly the kind of failure that is invisible until someone
   * wonders why something stopped happening a month ago.
   */
  function reportDegraded(input: { subscriberId: string; reason: string }): void {
    void bus.publish({
      type: 'system.degraded',
      actor: SYSTEM_ACTOR,
      principalId,
      payload: { component: input.subscriberId, reason: input.reason, recoverable: true },
      sensitivity: 'internal',
    })
  }

  const bus: EventBus = {
    registry,

    // Returns a promise without awaiting anything, and stays that way on
    // purpose. SQLite is synchronous, so publishing genuinely does not need to
    // wait — but the `EventBus` interface exists so this can become NATS or a
    // Postgres outbox if FRIDAY ever spans processes (Chapter 10), and those
    // are asynchronous. A synchronous signature here would mean changing every
    // call site in the system on the day that happens.
    // biome-ignore lint/suspicious/useAwait: see above — the async signature is the swappable interface
    async publish(event, onRecorded) {
      // Chapter 10, rule 4: an unregistered or invalid event fails loudly at
      // the source. AI assistants will add event types, and a malformed one
      // accepted quietly corrupts the log for every future reader.
      const validated = registry.validate({
        type: event.type,
        payloadVersion: event.payloadVersion ?? 1,
        payload: event.payload,
      })

      if (!validated.ok) return validated

      const recorded = storage.events.append({
        event: {
          type: event.type,
          occurredAt: event.occurredAt,
          actor: event.actor,
          principalId: event.principalId,
          subject: event.subject,
          causationId: event.causationId,
          correlationId: event.correlationId,
          traceId: event.traceId,
          payload: validated.value,
          payloadVersion: event.payloadVersion ?? 1,
          sensitivity: event.sensitivity,
        },

        // ★ The sync lane runs inside the append transaction. A throw here
        // rolls the write back and the event never happened — which is the
        // guarantee that the audit trail and the system state cannot disagree.
        onRecorded: (written) => {
          // The publisher's own transactional work runs first, because it is
          // the authoritative state this event describes, and a subscriber
          // projecting the same event should see it already applied.
          onRecorded?.(written)

          for (const subscriber of syncSubscribers) {
            if (matches(subscriber.pattern, written.type)) subscriber.handle(written)
          }
        },
      })

      if (!recorded.ok) return recorded

      // Durable before dispatch: nothing below this line can lose the event.
      for (const { subscriber, lane } of asyncSubscribers.values()) {
        if (matches(subscriber.pattern, recorded.value.type)) lane.enqueue(recorded.value)
      }

      logger.debug(
        { correlationId: recorded.value.correlationId, seq: recorded.value.seq },
        `recorded ${recorded.value.type}`,
      )

      return recorded
    },

    subscribeSync(subscriber) {
      syncSubscribers.push(subscriber)

      return () => {
        const index = syncSubscribers.indexOf(subscriber)
        if (index >= 0) syncSubscribers.splice(index, 1)
      }
    },

    subscribeAsync(subscriber) {
      if (asyncSubscribers.has(subscriber.id)) {
        throw new TypeError(
          `A subscriber called "${subscriber.id}" is already registered. ` +
            'Subscriber IDs are the key their checkpoint is stored under, so they must be unique.',
        )
      }

      const lane = createLane({
        subscriber,
        checkpoints: storage.checkpoints,
        logger,
        retry,
        onDegraded: reportDegraded,
        sleep,
      })

      asyncSubscribers.set(subscriber.id, { subscriber, lane })

      return () => {
        lane.stop()
        asyncSubscribers.delete(subscriber.id)
      }
    },

    // Asynchronous for the same reason as `publish`: catch-up is a read from
    // SQLite today and a network replay under any other bus implementation.
    // biome-ignore lint/suspicious/useAwait: see `publish`
    async start() {
      if (running) return ok(undefined)
      running = true

      // ★ Catch-up. Each subscriber resumes from its last acknowledged
      // sequence number, so events published while it was down are delivered.
      // This is the other half of at-least-once: without it, "the audit trail
      // is the message bus" would only be true while the process was up.
      for (const { subscriber, lane } of asyncSubscribers.values()) {
        const from = storage.checkpoints.lastAcked(subscriber.id)
        const missed = storage.events.readAfter({ afterSeq: from })

        if (!missed.ok) return missed

        for (const event of missed.value) {
          if (matches(subscriber.pattern, event.type)) lane.enqueue(event)
        }
      }

      return ok(undefined)
    },

    async stop() {
      running = false

      await Promise.all([...asyncSubscribers.values()].map(({ lane }) => lane.drain()))

      for (const { lane } of asyncSubscribers.values()) lane.stop()
    },

    verifyChain(input) {
      return storage.events.verifyChain(input)
    },

    latestSeq() {
      return storage.events.latestSeq()
    },
  }

  return bus
}

/**
 * Publishes the event that says FRIDAY is running.
 *
 * Its own function because the failure matters: if she cannot record that she
 * started, she cannot record anything, and Chapter 10 says she stops rather
 * than proceeding unrecorded.
 *
 * @param input - The bus, the principal, and the version to record.
 * @returns The recorded event, or the reason she should not continue.
 */
export async function announceStart(input: {
  bus: EventBus
  principalId: PrincipalId
  version: string
}): Promise<Result<FridayEvent, FridayError>> {
  const published = await input.bus.publish({
    type: 'system.started',
    actor: SYSTEM_ACTOR,
    principalId: input.principalId,
    payload: { version: input.version, nodeVersion: process.version, pid: process.pid },
    sensitivity: 'internal',
  })

  if (!published.ok) {
    return err(
      fridayError({
        code: 'EVENT_LOG_UNWRITABLE',
        message:
          'FRIDAY could not record that she started, so she has not started. ' +
          'She does not run when she cannot write her audit trail.',
        cause: published.error.message,
      }),
    )
  }

  return published
}
