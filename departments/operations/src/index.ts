/**
 * operations — FRIDAY's first department.
 *
 * ★ Chosen first because it exercises the entire framework — manifest,
 * capabilities, events, policies, the Guardian — at **zero external risk**. It
 * touches no personal data and calls no external service, so the milestone
 * that proves the machinery works cannot also be the milestone that sends an
 * email to the wrong person.
 *
 * ★ **Two capabilities, and the pair is the point.** `run-self-check` runs
 * without asking. `compact-event-log` must ask, every time, and no standing
 * grant can cover it. Between them they prove both halves of the M5 done-when:
 * work that proceeds, and work that stops for the owner.
 *
 * ★ **Neither decides whether it is allowed.** A capability describes what it
 * would do and asks; the Guardian decides. Nothing in this department reads a
 * policy, and `departments/README.md` makes that a boundary rule rather than a
 * convention: *no department implements authorization.*
 *
 * See: README.md · docs/01-bible/13-department-architecture.md
 */

export {
  type CompactRequest,
  type CompactResult,
  compactEventLog,
  runSelfCheck,
  type SelfCheckRequest,
  type SelfCheckResult,
} from './capabilities.js'
