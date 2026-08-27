import { z } from 'zod'

/**
 * Error codes — a closed enumeration.
 *
 * Closed on purpose: every client is compile-checked against the complete set,
 * so a new failure mode cannot be introduced without every handler being shown
 * to the compiler. An open `string` code would let a new error silently fall
 * through every `switch` in the system.
 *
 * Codes are stable identifiers. The `message` is what changes; the code is what
 * anything downstream branches on.
 *
 * Reference: docs/01-bible/30-coding-standards.md · Chapter 20
 */
export const ERROR_CODES = [
  // ── Validation ──────────────────────────────────────────────────────────
  'VALIDATION_FAILED',
  'EVENT_TYPE_UNREGISTERED',
  'EVENT_PAYLOAD_INVALID',
  'EVENT_TYPE_MALFORMED',

  // ── The event log ───────────────────────────────────────────────────────
  'CHAIN_BROKEN',
  'EVENT_LOG_UNWRITABLE',
  'SEQUENCE_CONFLICT',

  // ── Storage ─────────────────────────────────────────────────────────────
  'STORAGE_UNAVAILABLE',
  'STORAGE_WRITE_FAILED',
  'MIGRATION_FAILED',
  'NOT_FOUND',

  // ── Secrets and encryption ──────────────────────────────────────────────
  'ENCRYPTION_KEY_UNAVAILABLE',
  'DECRYPTION_FAILED',

  // ── Configuration ───────────────────────────────────────────────────────
  'CONFIG_INVALID',
  'CONFIG_UNREADABLE',

  // ── Dispatch ────────────────────────────────────────────────────────────
  //
  // `NOT_IMPLEMENTED` is its own code because "declared but not built yet" is
  // a different fact from both a refusal and a malfunction. A department
  // manifest is a promise about what FRIDAY can do; when the code behind one
  // is missing, she must say so in those words rather than fail in a way that
  // reads as broken — or, far worse, report success for work that did not
  // happen.
  'NOT_IMPLEMENTED',
  'SUBSCRIBER_FAILED',
  'TIMEOUT',
  'SHUTTING_DOWN',

  // ── Thinking ────────────────────────────────────────────────────────────
  //
  // Two failures, kept apart for the same reason `NOT_AUTHORIZED` and
  // `APPROVAL_REQUIRED` are. `MODEL_UNAVAILABLE` covers both "nothing can do
  // this" and the far more important "this is private and there is no local
  // model" — a refusal FRIDAY makes on purpose, not a fault.
  // `BUDGET_EXHAUSTED` is FRIDAY stopping rather than spending, which is a
  // correct outcome and must never read as a malfunction: a caller that
  // retried it would be defeating the one control on an overnight loop.
  'MODEL_UNAVAILABLE',
  'BUDGET_EXHAUSTED',

  // ── The network boundary ────────────────────────────────────────────────
  //
  // `EGRESS_BLOCKED` is a refusal FRIDAY makes on purpose and must never read
  // as a malfunction: a connector reached for a host its manifest does not
  // declare, and the request did not happen. It is kept apart from
  // `CONNECTOR_UNAVAILABLE` — the external service failing — because retrying
  // an unavailable service is correct and retrying a blocked one would be an
  // attempt to defeat the allowlist.
  'EGRESS_BLOCKED',
  'CONNECTOR_UNAVAILABLE',

  // Three failures of FRIDAY's own making, kept apart from the two above
  // because those blame the provider and these blame us. A diagnostic that
  // conflated them would send someone to read a provider's status page while
  // the bug sat in this repository.
  //
  // `CONNECTOR_NOT_READY`  — used before `initialize`, or after `shutdown`.
  // `OPERATION_NOT_DECLARED` — asked for something its manifest does not list.
  // `CONNECTOR_FAULTED`   — the connector threw. Chapter 14 expects connectors
  //   to be the component most likely written quickly, by an AI, or by a third
  //   party, so one misbehaving must not take the kernel down with it.
  // Nobody's fault: the caller stopped wanting the answer. Distinct from
  // `TIMEOUT` because reporting an abandoned call as a timeout blames the
  // provider for a decision FRIDAY made, and distinct from a failure because
  // it is not one — retrying it would be reviving work already dropped.
  'CANCELLED',

  // ── Credentials ─────────────────────────────────────────────────────────
  //
  // `SCOPE_NOT_DECLARED` is a refusal FRIDAY makes on purpose: a connector
  // asked for permission its own manifest does not list. It is kept apart
  // from `CREDENTIAL_UNAVAILABLE` — no usable credential exists — because the
  // first is a connector overreaching and the second is setup that is not
  // finished. One is a security event and the other is a chore.
  'SCOPE_NOT_DECLARED',
  'CREDENTIAL_UNAVAILABLE',
  'CREDENTIAL_REVOKED',

  // ★ Distinct from `CREDENTIAL_REVOKED`: a lease that ran out is not a
  // decision anyone made. Asking again is the correct response to this one and
  // the wrong response to the other, so a caller must be able to tell them
  // apart without reading a message.
  'CREDENTIAL_EXPIRED',

  'CONNECTOR_NOT_READY',
  'OPERATION_NOT_DECLARED',
  'CONNECTOR_FAULTED',

  // ── Authorization ───────────────────────────────────────────────────────
  //
  // `NOT_AUTHORIZED` and `APPROVAL_REQUIRED` are distinct on purpose. The
  // first is an answer — no, and asking will not change it. The second is a
  // pause: the plan suspends and resumes if the owner says yes. A caller that
  // treated them the same would either abandon work the owner would have
  // approved, or retry something already refused.
  'NOT_AUTHORIZED',
  'APPROVAL_REQUIRED',
  'APPROVAL_ALREADY_RESOLVED',
  'CAPABILITY_INVALID',
  'STEP_UP_REQUIRED',
  'SURFACE_NOT_PERMITTED',
  'POLICY_INVALID',
  'POLICY_SET_EMPTY',
  'GRANT_INVALID',
] as const

export const ErrorCodeSchema = z.enum(ERROR_CODES)

/** One of the closed set of failure modes FRIDAY can report. */
export type ErrorCode = z.infer<typeof ErrorCodeSchema>

export const FridayErrorSchema = z.object({
  code: ErrorCodeSchema,

  /**
   * Plain language, written for the owner rather than for a programmer.
   * Chapter 30 requires this on every error, and Article II makes it load
   * bearing: a failure the owner cannot understand is a failure they cannot
   * act on.
   */
  message: z.string().min(1),

  /** Ties the failure to the request it belongs to, in the audit trail. */
  correlationId: z.string().min(1).optional(),

  /**
   * Structured detail for a machine reader. Never contains a secret value —
   * the redaction layer in @friday/telemetry is a second line of defence, not
   * the first.
   */
  detail: z.record(z.string(), z.unknown()).optional(),

  /** The lower-level failure this one wraps, if any. */
  cause: z.string().optional(),
})

/** A typed failure. Every `Result` error branch in FRIDAY carries this shape. */
export type FridayError = z.infer<typeof FridayErrorSchema>

/**
 * Builds a typed error.
 *
 * @param input - The code, the plain-language message, and any optional
 *   correlation, detail, or cause.
 * @returns A `FridayError` ready to place in a `Result` error branch.
 */
export function fridayError(input: {
  code: ErrorCode
  message: string
  correlationId?: string | undefined
  detail?: Record<string, unknown> | undefined
  cause?: unknown
}): FridayError {
  const error: {
    code: ErrorCode
    message: string
    correlationId?: string
    detail?: Record<string, unknown>
    cause?: string
  } = { code: input.code, message: input.message }

  if (input.correlationId !== undefined) error.correlationId = input.correlationId
  if (input.detail !== undefined) error.detail = input.detail
  if (input.cause !== undefined) error.cause = describeCause(input.cause)

  return error
}

/**
 * Renders an unknown thrown value as a string safe to place in an error.
 *
 * `catch` variables are `unknown` under our compiler settings, and the thing
 * caught is frequently not an `Error` — a rejected promise can carry anything.
 * Stack traces are deliberately excluded: they belong in the system log, where
 * the redaction layer sees them, not in a value that may be rendered to the
 * owner or written into an event payload.
 *
 * @param cause - Whatever was caught.
 * @returns A single-line description.
 */
function describeCause(cause: unknown): string {
  if (cause instanceof Error) return `${cause.name}: ${cause.message}`
  if (typeof cause === 'string') return cause
  return Object.prototype.toString.call(cause)
}
