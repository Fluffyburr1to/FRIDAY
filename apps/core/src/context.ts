import type { FridayConfig } from '@friday/config'
import {
  err,
  type FridayError,
  fridayError,
  ok,
  type PrincipalId,
  type Result,
} from '@friday/contracts'
import { type ApprovalRegistry, createApprovalRegistry } from '@friday/guardian'
import { type EventStore, type KeyProvider, openStorage } from '@friday/storage'

/**
 * What every procedure is given.
 *
 * Deliberately small. The context is the seam where this app's
 * composition-only rule is either kept or quietly lost: anything added here is
 * something a procedure can reach for, so it stays the smallest set that the
 * shipped screens actually use.
 *
 * See: README.md · docs/adr/0029-apps-core-begins-at-milestone-2-to-serve-the-dashboard.md
 */

/**
 * The event log, minus every way of writing to it.
 *
 * `openStorage` hands back a store that can append, because the kernel needs
 * that. This app does not, and narrowing the type here is what keeps ADR-0029's
 * "translates, never stores" rule true by construction rather than by everyone
 * remembering it. A procedure that tried to record an event would not compile.
 *
 * The concern is specific and named in ADR-0021: something that can write
 * directly to the log is a way to record an action FRIDAY did not take.
 */
export type EventReader = Pick<
  EventStore,
  'readAfter' | 'readLatest' | 'latestSeq' | 'count' | 'verifyChain'
>

export interface CoreContext {
  readonly events: EventReader

  /**
   * Raising and settling approvals.
   *
   * ★ The registry decides nothing about whether an answer is permitted — it
   * enforces Chapter 19's rules on the answer itself, including step-up. This
   * app supplies the answer and the surface it arrived on, and no more than
   * that.
   */
  readonly approvals: ApprovalRegistry

  /** Whose data this instance serves. The multi-user seam, read from config. */
  readonly principalId: PrincipalId
}

/** A context, plus the handle that has to be released when the server stops. */
export interface OpenedContext {
  readonly context: CoreContext
  close(): void
}

/**
 * Opens storage and builds the context around it.
 *
 * Fails loudly when the databases cannot be opened. A dashboard that renders
 * an empty list when the truth is "the log is unreadable" would be a
 * transparency surface reporting the opposite of what is happening, which is
 * worse than no surface at all — see README rule 6.
 *
 * The key provider is a parameter rather than something constructed here, per
 * ADR-0020. It is what lets a test open a real database with real events in it
 * without reaching the machine's Keychain — and a test that cannot run without
 * the Keychain is a test that does not run in CI.
 *
 * @param input - The loaded configuration and the key provider.
 * @returns The context and its close function, or why storage could not be opened.
 */
export function openContext(input: {
  config: FridayConfig
  keys: KeyProvider
}): Result<OpenedContext, FridayError> {
  const { config, keys } = input

  const storage = openStorage({
    eventsDbPath: config.paths.eventsDb,
    mainDbPath: config.paths.mainDb,
    keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!storage.ok) {
    return err(
      fridayError({
        code: storage.error.code,
        message: storage.error.message,
        detail: storage.error.detail,
        cause: storage.error.cause,
      }),
    )
  }

  return ok({
    context: {
      events: storage.value.events,
      approvals: createApprovalRegistry({ store: storage.value.guardian.approvals }),
      principalId: config.principalId,
    },
    close: storage.value.close,
  })
}
