import type { FridayConfig } from '@friday/config'
import { err, type FridayError, fridayError, ok, type Result } from '@friday/contracts'
import { type EventStore, type KeyProvider, openEventsReadOnly } from '@friday/storage'

/**
 * What every procedure is given.
 *
 * Deliberately one field. The context is the seam where this app's
 * composition-only rule is either kept or quietly lost: anything added here is
 * something a procedure can reach for, so it stays the smallest set that the
 * shipped screens actually use.
 *
 * ── Why the reader is read-only ─────────────────────────────────────────────
 *
 * At Milestone 2 the dashboard observes the event log and cannot cause
 * anything to be written to it. That is not a limitation to be worked around
 * later — it is what lets this API exist before the Guardian is on the route,
 * because there is no action to authorize. The milestone that adds the first
 * mutation is the milestone that puts the Guardian in front of every mutation
 * (Chapter 20, rule 3).
 *
 * See: README.md · docs/adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md
 */
export interface CoreContext {
  readonly events: EventStore
}

/** A context, plus the handle that has to be released when the server stops. */
export interface OpenedContext {
  readonly context: CoreContext
  close(): void
}

/**
 * Opens the event log for reading and builds the context around it.
 *
 * Fails loudly when the log cannot be opened. A dashboard that renders an
 * empty list when the truth is "the log is unreadable" would be a transparency
 * surface reporting the opposite of what is happening, which is worse than no
 * surface at all — see README rule 6.
 *
 * The key provider is a parameter rather than something constructed here, per
 * ADR-0020. It is what lets a test open a real database with a real event in
 * it without reaching the machine's Keychain — and a test that cannot run
 * without the Keychain is a test that does not run in CI.
 *
 * @param input - The loaded configuration and the key provider.
 * @returns The context and its close function, or why the log could not be read.
 */
export function openContext(input: {
  config: FridayConfig
  keys: KeyProvider
}): Result<OpenedContext, FridayError> {
  const { config, keys } = input

  const reader = openEventsReadOnly({
    eventsDbPath: config.paths.eventsDb,
    keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!reader.ok) {
    return err(
      fridayError({
        code: reader.error.code,
        message: reader.error.message,
        detail: reader.error.detail,
        cause: reader.error.cause,
      }),
    )
  }

  return ok({
    context: { events: reader.value.events },
    close: reader.value.close,
  })
}
