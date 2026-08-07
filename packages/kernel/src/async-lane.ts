import type { FridayEvent } from '@friday/contracts'
import type { CheckpointStore } from '@friday/storage'
import type { Logger } from '@friday/telemetry'
import type { AsyncSubscriber } from './subscribers.js'

/**
 * The async lane: one queue per subscriber, with retries and a dead letter.
 *
 * A single lane would force a choice between two bad options — everything
 * synchronous, where a slow department blocks the whole system, or everything
 * asynchronous, where the audit trail lags reality and a crash loses records
 * the Constitution requires. Two lanes gives correctness where correctness
 * matters and isolation everywhere else.
 *
 * Reference: docs/01-bible/10-event-bus.md
 */

export interface RetryPolicy {
  /** First delay. Doubles each attempt. */
  readonly baseMs: number

  /** Ceiling on the delay, so a broken subscriber retries hourly, not never. */
  readonly maxMs: number

  /** Attempts before the event is dead-lettered and the queue moves on. */
  readonly maxAttempts: number
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  baseMs: 1_000,
  maxMs: 300_000,
  maxAttempts: 8,
}

/** Consecutive dead letters before the subscriber is called degraded. */
const DEGRADED_AFTER = 3

export interface LaneOptions {
  subscriber: AsyncSubscriber
  checkpoints: CheckpointStore
  logger: Logger
  retry: RetryPolicy

  /** Called when a subscriber crosses into degraded. Publishes `system.degraded`. */
  onDegraded: (input: { subscriberId: string; reason: string }) => void

  /** Injectable so tests do not wait real seconds for a backoff. */
  sleep: (ms: number) => Promise<void>
}

export interface Lane {
  readonly subscriberId: string

  /** Adds an event to this subscriber's queue and wakes the pump. */
  enqueue(event: FridayEvent): void

  /** Resolves when the queue is empty and nothing is in flight. */
  drain(): Promise<void>

  /** Stops after the current event. Queued events stay queued for next start. */
  stop(): void

  readonly depth: number
  readonly isDegraded: boolean
}

/**
 * Creates a lane for one subscriber.
 *
 * @param options - The subscriber, its checkpoint store, and the retry policy.
 * @returns The lane.
 */
export function createLane(options: LaneOptions): Lane {
  const { subscriber, checkpoints, logger, retry, onDegraded, sleep } = options

  const queue: FridayEvent[] = []
  let pumping = false
  let stopped = false
  let consecutiveFailures = 0
  let degraded = false
  let idle: Promise<void> = Promise.resolve()
  let markIdle: () => void = () => undefined

  function pump(): void {
    if (pumping || stopped) return
    pumping = true

    idle = new Promise((resolve) => {
      markIdle = resolve
    })

    // Deliberately floated: the pump owns its own errors and its lifetime is
    // the bus's, not the caller's. `drain()` is how anyone waits for it.
    void run().finally(() => {
      pumping = false
      markIdle()
    })
  }

  async function run(): Promise<void> {
    while (!stopped) {
      const event = queue.shift()
      if (event === undefined) return

      await deliver(event)
    }
  }

  async function deliver(event: FridayEvent): Promise<void> {
    for (let attempt = 1; attempt <= retry.maxAttempts; attempt += 1) {
      try {
        await subscriber.handle(event)

        checkpoints.acknowledge({ subscriberId: subscriber.id, seq: event.seq })
        consecutiveFailures = 0
        return
      } catch (cause) {
        const isLast = attempt === retry.maxAttempts
        report({ event, attempt, cause, isLast })

        if (isLast) {
          abandon(event, attempt, cause)
          return
        }

        await sleep(backoffFor(attempt, retry))
      }
    }
  }

  /**
   * Logs a failed attempt.
   *
   * A retry that succeeded is a `warn` and a final give-up is an `error`,
   * following Chapter 22's test: would you want to be interrupted about this?
   * A transient failure the system recovered from is not worth interrupting
   * anyone over, and logging it as an error trains the reader to ignore errors.
   */
  function report(input: {
    event: FridayEvent
    attempt: number
    cause: unknown
    isLast: boolean
  }): void {
    const { event, attempt, cause, isLast } = input

    logger[isLast ? 'error' : 'warn'](
      {
        correlationId: event.correlationId,
        subscriberId: subscriber.id,
        eventSeq: event.seq,
        attempt,
        err: cause,
      },
      isLast
        ? `${subscriber.id} gave up on event ${event.seq} after ${attempt} attempts`
        : `${subscriber.id} failed on event ${event.seq}; retrying`,
    )
  }

  /**
   * Records the failure, moves past the event, and advances the checkpoint.
   *
   * Advancing the checkpoint past a dead-lettered event is deliberate: without
   * it, a restart would replay the same poisoned event forever and the
   * subscriber would never see anything newer. The record in `dead_letters`
   * is what keeps that from being a silent loss.
   */
  function abandon(event: FridayEvent, attempts: number, cause: unknown): void {
    checkpoints.deadLetter({
      subscriberId: subscriber.id,
      eventSeq: event.seq,
      attempts,
      error: cause instanceof Error ? `${cause.name}: ${cause.message}` : String(cause),
    })

    checkpoints.acknowledge({ subscriberId: subscriber.id, seq: event.seq })

    consecutiveFailures += 1
    if (consecutiveFailures >= DEGRADED_AFTER && !degraded) {
      degraded = true
      onDegraded({
        subscriberId: subscriber.id,
        reason: `${subscriber.id} has failed ${consecutiveFailures} events in a row and is no longer keeping up.`,
      })
    }
  }

  return {
    subscriberId: subscriber.id,

    enqueue(event) {
      queue.push(event)
      pump()
    },

    async drain() {
      // Loop rather than await once: a handler can enqueue nothing, but a
      // retry can extend the current pump past the moment we checked.
      while (pumping || queue.length > 0) {
        await idle
      }
    },

    stop() {
      stopped = true
    },

    get depth() {
      return queue.length
    },

    get isDegraded() {
      return degraded
    },
  }
}

/**
 * Exponential backoff, capped.
 *
 * @param attempt - The attempt that just failed, from 1.
 * @param retry - The policy.
 * @returns Milliseconds to wait before the next attempt.
 */
export function backoffFor(attempt: number, retry: RetryPolicy): number {
  return Math.min(retry.baseMs * 2 ** (attempt - 1), retry.maxMs)
}
