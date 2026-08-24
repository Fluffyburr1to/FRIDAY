import type { Authorised, ExecutableStep } from '@friday/chief-of-staff'
import { err, type FridayError, fridayError, type Result } from '@friday/contracts'
import { compactEventLog, runSelfCheck } from '@friday/operations'
import type { Storage } from '@friday/storage'

/**
 * Doing the work, once the Guardian has said it may be done.
 *
 * ★ This is the bottom of the stack and the only place a real capability is
 * called. It takes an `Authorised` — the value only `executor.authorise` can
 * produce — so there is no path here that has not been through the Guardian,
 * and no second dispatcher anybody could add without it being obvious.
 *
 * ★ **It performs, and decides nothing.** No permission is read here, no risk
 * is classified, and no capability is skipped on this side. A dispatcher that
 * checked anything would be a second authority sitting under the first, and
 * the disagreement between them would be invisible.
 *
 * Reference: docs/01-bible/13-department-architecture.md · docs/adr/0040
 */

/** How long the compaction leaves alone, when nothing says otherwise. */
const KEEP_RECENT_MS = 90 * 24 * 60 * 60 * 1000

/**
 * Builds the dispatcher for the departments this build ships with.
 *
 * ★ Keyed on the action declared in the manifest, so the manifest and the code
 * cannot drift apart quietly: an action the manifest declares and this does not
 * implement is refused by name, at the moment the step runs, rather than
 * silently doing nothing and reporting success.
 *
 * @param storage - What the capabilities need and do not own.
 * @returns A `PerformCapability` for the executor.
 */
export function createDispatcher(storage: Storage) {
  const perform = (
    _authorised: Authorised,
    step: ExecutableStep,
  ): Promise<Result<unknown, FridayError>> => {
    if (step.actionType === 'diagnostics.self-check.run') {
      return runSelfCheck(
        {},
        {
          verifyChain: () => {
            const checked = storage.events.verifyChain({})

            return Promise.resolve(
              checked.ok
                ? ({
                    ok: true,
                    value: { intact: checked.value.intact, checked: checked.value.eventsChecked },
                  } as const)
                : checked,
            )
          },
        },
      )
    }

    if (step.actionType === 'operations.log.compact') {
      return compactEventLog(
        { olderThanMs: KEEP_RECENT_MS },
        {
          // ★ Not implemented, and refused rather than faked. A compaction
          // that reported success without rewriting anything would be the
          // worst possible thing to stub: the owner would be told the record
          // was reorganised when it was not, by the one capability whose whole
          // subject is the trustworthiness of the record.
          compact: () =>
            Promise.resolve(
              err(
                fridayError({
                  code: 'NOT_IMPLEMENTED',
                  message:
                    'FRIDAY can be asked to compact her record, and she asked you first — ' +
                    'but she cannot actually do it yet, so she has not.',
                  detail: { action: step.actionType },
                }),
              ),
            ),
        },
      )
    }

    return Promise.resolve(
      err(
        fridayError({
          code: 'NOT_IMPLEMENTED',
          message: `A department declares "${step.actionType}" but nothing in this build performs it.`,
          detail: { action: step.actionType, department: step.department },
        }),
      ),
    )
  }

  return perform
}
