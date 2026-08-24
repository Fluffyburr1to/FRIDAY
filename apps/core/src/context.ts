import {
  type ApprovalClerk,
  type AuthorizingClerk,
  createApprovalClerk,
  createAuthorizingClerk,
  registerClerkEventTypes,
} from '@friday/clerk'
import type { FridayConfig } from '@friday/config'
import {
  err,
  type FridayError,
  type FridayEvent,
  fridayError,
  ok,
  type PrincipalId,
  type Result,
} from '@friday/contracts'
import { createVitalsReader, type VitalsReader } from '@friday/diagnostics'
import {
  createCapabilityIssuer,
  createGrantRegistry,
  createGuardian,
  loadPolicySet,
} from '@friday/guardian'
import { announceStart, createEventBus } from '@friday/kernel'
import { type EventStore, type KeyProvider, openStorage } from '@friday/storage'
import { type AskSession, createAskSession } from './ask.js'
import { coreVersion } from './version.js'

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

/**
 * Narrows a store to the five reading methods, at runtime as well as in types.
 *
 * ★ `EventReader` alone is a `Pick<>`, which is a promise the compiler keeps
 * and the running program does not: handing a procedure the whole `EventStore`
 * under a narrower type leaves `append` sitting on the object, one `as` or one
 * untyped call away. A test asserting the boundary found exactly that.
 *
 * Copying the five methods out is what makes ADR-0029's "translates, never
 * stores" true by construction rather than by the type annotation nobody
 * re-reads. The methods are closures over the store's own state and use no
 * `this`, so they carry correctly.
 */
function readerOver(store: EventStore): EventReader {
  return {
    readAfter: store.readAfter,
    readLatest: store.readLatest,
    latestSeq: store.latestSeq,
    count: store.count,
    verifyChain: store.verifyChain,
  }
}

export interface CoreContext {
  readonly events: EventReader

  /**
   * Settling approvals, and recording that they were settled.
   *
   * ★ The clerk decides nothing about whether an answer is permitted — it
   * applies Chapter 19's rules through the approval registry, including
   * step-up. This app supplies the answer and the surface it arrived on, and
   * no more than that.
   *
   * ★ This is also the only way anything in this app reaches the event log,
   * and it is deliberately not a way to write to it. The clerk offers the
   * specific lifecycle transitions an answer actually is; there is no method
   * on it that records an event FRIDAY did not cause. The bus itself is built
   * in `openContext` and never leaves it. See ADR-0021 and ADR-0031.
   */
  readonly approvals: ApprovalClerk

  /**
   * What the FRIDAY runtime is doing.
   *
   * ★ Stateful, and shared across requests on purpose. CPU utilisation is a
   * rate, so the reader diffs each poll against the previous one — building a
   * fresh reader per request would throw that history away and force a cold
   * sample every second.
   *
   * It observes this process and the volume her databases sit on; there is no
   * action to authorize, which is why it sits here rather than behind the
   * Guardian.
   *
   * See docs/adr/0042-hud-vitals-are-friday-scoped-per-chapter-29.md
   */
  readonly vitals: VitalsReader

  /** Whose data this instance serves. The multi-user seam, read from config. */
  readonly principalId: PrincipalId
}

/** A context, plus the handle that has to be released when the server stops. */
export interface OpenedContext {
  readonly context: CoreContext

  /**
   * Asking the Guardian, and recording what it answered.
   *
   * ★ Deliberately **not** on `CoreContext`. A tRPC procedure that could
   * authorize would be a procedure that decides when FRIDAY acts, and this app
   * translates rather than decides (ADR-0029). It lives out here so that
   * startup — which is not a request from anybody — can put FRIDAY's own
   * housekeeping through the Guardian, and no procedure can reach it.
   *
   * See docs/adr/0031-the-clerk-records-what-the-guardian-decided.md
   */
  readonly authorizing: AuthorizingClerk

  /**
   * Recording that FRIDAY started.
   *
   * ★ Deliberately **not** on `CoreContext`, and deliberately not the bus. A
   * procedure that could publish would be a way to record an event FRIDAY did
   * not cause — the concern ADR-0021 names and the reason the bus stays private
   * to this module. This is one closure over one call, reachable only by
   * startup, which is not a request from anybody.
   *
   * It is the first write of every run and the gate on everything after it:
   * Chapter 10 says she will not act if she cannot record, so a failure here
   * means she has not started rather than that a detail is missing.
   *
   * See docs/adr/0044-apps-core-records-that-friday-started-before-she-checks-herself.md
   */
  announceStarted(): Promise<Result<FridayEvent, FridayError>>

  /**
   * Asking FRIDAY to do something — the whole path, composed once.
   *
   * ★ Built HERE, where the bus is, and for the same reason the bus stays
   * here: a session can record that a plan advanced, and nothing that merely
   * serves a request should be able to. It sits on `OpenedContext` rather than
   * `CoreContext` so no tRPC procedure can reach it.
   *
   * ★ A `Result`, because loading the departments can fail and that must not
   * stop FRIDAY starting. A misconfigured departments directory means she
   * cannot *do* anything; it does not mean she cannot report her own health or
   * let the owner read the log — and those are exactly the surfaces someone
   * needs in order to work out why. The failure is carried, named, and shown
   * when something tries to use it.
   */
  readonly ask: Result<AskSession, FridayError>

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

  // ★ Before anything is opened or created. A run that cannot load its rules
  // is a run that must not start, and failing here means it has not yet made a
  // database, a WAL file, or any other trace of an attempt. The loader already
  // refuses an empty rule set for the reason that matters: a Guardian with no
  // rules refuses everything, which is a broken system that looks like a
  // strict one. See ADR-0033.
  const policies = loadPolicySet(config.paths.policiesDir)
  if (!policies.ok) return err(policies.error)

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

  // ★ The bus is built here and stays here. Nothing on `CoreContext` can
  // publish, so a procedure cannot record an arbitrary event — it can only ask
  // the clerk to settle an approval, which is a transition the owner actually
  // caused. ADR-0021 names the concern: a way to write directly to the log is
  // a way to record an action FRIDAY did not take.
  const bus = createEventBus({ storage: storage.value, principalId: config.principalId })

  // The Guardian's event types are registered on this bus and nowhere else, so
  // only a process that composed a clerk can record one. See ADR-0031.
  registerClerkEventTypes(bus)

  // Read once, at construction, so a signing key FRIDAY cannot reach is
  // reported now rather than discovered on the first action she was about to
  // take. Nothing provisions this Keychain entry yet, so on a fresh machine
  // this is where startup stops — deliberately, and with the key named. See
  // ADR-0033's closing note.
  const capabilities = createCapabilityIssuer({ store: storage.value.guardian.capabilities, keys })

  if (!capabilities.ok) {
    storage.value.close()
    return err(capabilities.error)
  }

  const approvals = createApprovalClerk({ approvals: storage.value.guardian.approvals, bus })

  const authorizing = createAuthorizingClerk({
    guardian: createGuardian({
      policies: policies.value,
      capabilities: capabilities.value,
      grants: createGrantRegistry({ store: storage.value.guardian.grants }),
    }),
    clerk: approvals,
    bus,
    decisions: storage.value.guardian.decisions,
  })

  return ok({
    context: {
      events: readerOver(storage.value.events),
      approvals,

      // The data directory rather than `/`: Chapter 29's metric is
      // `friday_disk_free_bytes`, the headroom on the volume holding her own
      // databases.
      vitals: createVitalsReader({ dataDir: config.paths.dataDir }),

      principalId: config.principalId,
    },

    announceStarted: () =>
      announceStart({ bus, principalId: config.principalId, version: coreVersion() }),

    authorizing,

    ask: createAskSession({
      config,
      storage: storage.value,
      bus,
      authorizing,
      capabilities: capabilities.value,
    }),

    close: storage.value.close,
  })
}
