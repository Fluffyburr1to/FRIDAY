import { type ApprovalRequest, type FridayError, ok, type Result } from '@friday/contracts'

/**
 * Where approval requests live.
 *
 * This is the store whose durability Milestone 2 is demonstrated against: a
 * request has to survive a restart and still be answerable days later. That
 * property belongs to the implementation `packages/storage` provides, not to
 * this interface — but it is the reason the interface exists rather than a map
 * being used directly.
 *
 * Every method returns `Result` — ADR-0027. It matters most here: an approval
 * the owner answered, whose write silently failed, would be an answer that
 * never happened.
 *
 * Reference: docs/01-bible/19-approval-system.md
 */
export interface ApprovalStore {
  put(request: ApprovalRequest): Result<void, FridayError>
  get(id: string): Result<ApprovalRequest | undefined, FridayError>
  replace(request: ApprovalRequest): Result<void, FridayError>

  /**
   * Every request still waiting on the owner, oldest first.
   *
   * This is what the dashboard's "needs you" panel reads. Article III depends
   * on the owner noticing, so the ordering surfaces the thing closest to
   * expiring rather than the newest.
   *
   * @param principalId - Whose requests to list. Omitted lists every
   *   principal's, which is what the expiry sweep needs — a request must lapse
   *   on time whether or not anyone is currently looking at that account.
   */
  listPending(principalId?: string): Result<readonly ApprovalRequest[], FridayError>
}

/**
 * An in-memory approval store.
 *
 * For tests only. Approvals held in memory do not survive a restart, which is
 * precisely the property Milestone 2 exists to demonstrate — so this is never
 * the right choice in a running FRIDAY.
 *
 * @returns A store backed by a map.
 */
export function createInMemoryApprovalStore(): ApprovalStore {
  const byId = new Map<string, ApprovalRequest>()

  return {
    put(request) {
      byId.set(request.id, request)
      return ok(undefined)
    },

    get(id) {
      return ok(byId.get(id))
    },

    replace(request) {
      byId.set(request.id, request)
      return ok(undefined)
    },

    listPending(principalId) {
      return ok(
        [...byId.values()]
          .filter(
            (request) =>
              request.status === 'pending' &&
              (principalId === undefined || request.principalId === principalId),
          )
          .sort((left, right) => left.createdAt - right.createdAt),
      )
    },
  }
}
