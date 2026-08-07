import { existsSync } from 'node:fs'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createEventBus } from '@friday/kernel'
import { openEventsReadOnly, openStorage } from '@friday/storage'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode, formatTime } from '../output.js'

/**
 * `friday events tail` and `friday events emit`.
 *
 * Together these are how Milestone 1 is demonstrated: emit a test event in one
 * terminal, watch it appear in another. Not impressive, and real — and the
 * whole point of the roadmap's "demonstrable outcome" rule is that six months
 * of foundation work has something you can actually look at.
 *
 * Reference: docs/01-bible/39-roadmap.md
 */

/** How often the tail looks for new events. */
const POLL_INTERVAL_MS = 400

/**
 * Watches the event log.
 *
 * Polling rather than a file watcher or a socket, because at Milestone 1 there
 * is no core service to subscribe to, and SQLite has no notification
 * mechanism. Four hundred milliseconds is imperceptible to a person watching a
 * terminal and costs one indexed query. When the core service arrives at M3,
 * this becomes a subscription and the polling goes away.
 *
 * @param input - The context, where to start, and how to stop.
 * @returns The exit code, once the tail is stopped.
 */
export async function runTail(input: {
  context: CommandContext
  sinceSeq: number | undefined
  count: number
  signal?: AbortSignal | undefined
}): Promise<ExitCode> {
  const { context, count, signal } = input
  const { config, out } = context

  if (!existsSync(config.paths.eventsDb)) {
    out.problem('There is no event log yet. Run `friday events emit` to create one.')
    return EXIT.problem
  }

  const reader = openEventsReadOnly({
    eventsDbPath: config.paths.eventsDb,
    keys: context.keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!reader.ok) {
    out.problem(reader.error.message)
    return EXIT.problem
  }

  try {
    // Default to the last `count` events rather than the whole log. Someone
    // running `events tail` wants to see what is happening now; printing four
    // months of history first is not that.
    let cursor = input.sinceSeq ?? Math.max(0, reader.value.events.latestSeq() - count)

    if (signal !== undefined) out.line(`Watching ${config.paths.eventsDb} — Ctrl-C to stop.`)

    while (signal?.aborted !== true) {
      const batch = reader.value.events.readAfter({ afterSeq: cursor })

      if (!batch.ok) {
        out.problem(batch.error.message)
        return EXIT.problem
      }

      for (const event of batch.value) {
        writeEvent(context, event)
        cursor = event.seq
      }

      if (signal === undefined) return EXIT.ok
      await wait(POLL_INTERVAL_MS, signal)
    }

    return EXIT.ok
  } finally {
    reader.value.close()
  }
}

function writeEvent(
  context: CommandContext,
  event: {
    seq: number
    type: string
    occurredAt: number
    actor: { type: string; id: string }
    correlationId?: string | undefined
    payload: Record<string, unknown>
  },
): void {
  context.out.line(
    `${String(event.seq).padStart(6)}  ${formatTime(event.occurredAt)}  ${event.type.padEnd(28)}  ${event.actor.id}`,
  )

  context.out.json(event)
}

/**
 * Emits a test event.
 *
 * The one command at Milestone 1 that opens the log for writing. It exists so
 * the tail has something to show, and it stays afterwards as the cheapest
 * possible end-to-end check that the bus is alive.
 *
 * @param input - The context and the note to record.
 * @returns The exit code.
 */
export async function runEmit(input: { context: CommandContext; note: string }): Promise<ExitCode> {
  const { context, note } = input
  const { config, out } = context

  const storage = openStorage({
    mainDbPath: config.paths.mainDb,
    eventsDbPath: config.paths.eventsDb,
    keys: context.keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!storage.ok) {
    out.problem(storage.error.message)
    return EXIT.problem
  }

  try {
    const bus = createEventBus({ storage: storage.value, principalId: config.principalId })

    const published = await bus.publish({
      type: 'test.event.emitted',
      actor: SYSTEM_ACTOR,
      principalId: config.principalId,
      payload: { note },
      sensitivity: 'internal',
    })

    if (!published.ok) {
      out.problem(published.error.message)
      return EXIT.problem
    }

    out.line(`Recorded event ${published.value.seq} — ${published.value.type}`)
    out.json(published.value)

    return EXIT.ok
  } finally {
    storage.value.close()
  }
}

/** A cancellable sleep, so Ctrl-C does not wait out the poll interval. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)

    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer)
        resolve()
      },
      { once: true },
    )
  })
}
