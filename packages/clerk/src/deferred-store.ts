import { type ApprovalRequest, ok } from '@friday/contracts'
import type { ApprovalStore } from '@friday/guardian'

/**
 * An approval store that captures writes instead of performing them.
 *
 * ★ This is what keeps the registry's rules and the transaction boundary from
 * fighting each other. `ApprovalRegistry` validates and writes in one call —
 * which is correct, and which would put the write *outside* the append
 * transaction if the registry held the real store. Handing it this one instead
 * means the write is captured, the clerk carries it into the transaction, and
 * a request that could not be recorded was never stored either.
 *
 * Reads pass straight through, because the rules the registry applies —
 * already settled? already expired? — must be checked against what is really
 * in the database, not against anything held here.
 *
 * The captured write is taken synchronously, before the clerk awaits anything,
 * so no second operation can interleave and claim it.
 *
 * Reference: docs/adr/0031 · docs/adr/0032 — amendment of 2026-08-08
 */

/** A write the registry made, held until the transaction can take it. */
export interface CapturedWrite {
  readonly kind: 'put' | 'replace'
  readonly request: ApprovalRequest
}

export interface DeferredApprovalStore {
  /** The store to hand the registry. */
  readonly store: ApprovalStore

  /**
   * Takes everything captured since the last call, clearing it.
   *
   * A list rather than a single write because the expiry sweep settles every
   * lapsed request in one call. Raising and answering each produce exactly one.
   */
  take(): readonly CapturedWrite[]
}

/**
 * Wraps a store so its writes are captured rather than performed.
 *
 * @param real - The store that actually persists, used for every read.
 * @returns The wrapper and the way to collect what was written.
 */
export function deferWrites(real: ApprovalStore): DeferredApprovalStore {
  let captured: CapturedWrite[] = []

  return {
    store: {
      put(request) {
        captured.push({ kind: 'put', request })
        return ok(undefined)
      },

      replace(request) {
        captured.push({ kind: 'replace', request })
        return ok(undefined)
      },

      get(id) {
        return real.get(id)
      },

      listPending(principalId) {
        return real.listPending(principalId)
      },
    },

    take() {
      const held = captured
      captured = []
      return held
    },
  }
}
