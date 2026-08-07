import { homedir } from 'node:os'
import { isAtLeastAsSensitiveAs, type Sensitivity } from '@friday/contracts'

/**
 * Three-layer redaction.
 *
 * Logs are the most common accidental data leak in software: a developer logs
 * a request object to debug something, the object contains an access token,
 * and the token is now in a file, in a backup, and possibly in a bug report.
 *
 * Chapter 22 specifies three layers because one is not enough, and each one
 * catches what the others miss:
 *
 *   1. **Classification at the source** — a value the caller marked as
 *      `private` or `secret` is replaced regardless of what it looks like.
 *   2. **Pattern scrubbing** — strings shaped like credentials are replaced
 *      even when nobody classified them. This is the layer that saves you when
 *      layer 1 was forgotten, which it will be.
 *   3. **Deny-listed key names** — a field called `password` is replaced
 *      whatever its value and whatever its declared classification.
 *
 * All three are tested. Redaction that is not tested is redaction that
 * silently stops working after a refactor, and the failure is invisible until
 * someone reads a log.
 *
 * Reference: docs/01-bible/22-logging-standards.md
 */

export const REDACTED = '[REDACTED]'

/**
 * Layer 3. Any field whose name contains one of these is replaced, whatever
 * it holds.
 *
 * Fragments are letters only, and keys are stripped to letters before the
 * comparison. That is what makes one entry cover `apiKey`, `api_key`,
 * `API_KEY`, and `x-api-key` — a field name is written four ways across a
 * codebase, and a deny-list that only catches one of them is a deny-list that
 * reads as if it works.
 */
const DENIED_KEY_FRAGMENTS = [
  'password',
  'passwd',
  'passphrase',
  'secret',
  'token',
  'apikey',
  'authorization',
  'auth',
  'cookie',
  'refresh',
  'credential',
  'privatekey',
  'session',
  'signature',
  'bearer',
  'otp',
  'pin',
] as const

/**
 * Layer 2. Strings shaped like credentials.
 *
 * Deliberately specific rather than "anything long and random": a generic
 * high-entropy rule redacts UUIDs, hashes, and correlation IDs, which are the
 * things you most need in a log. Each pattern below names a real credential
 * format, so adding one is a decision rather than a tuning exercise.
 */
const SECRET_VALUE_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, // HTTP Authorization values
  /\beyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g, // JWTs
  /\bsk-(?:ant-)?[A-Za-z0-9_-]{16,}/g, // Anthropic and OpenAI keys
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g, // GitHub tokens
  /\bxox[baprs]-[A-Za-z0-9-]{10,}/g, // Slack tokens
  /\bAKIA[0-9A-Z]{16}\b/g, // AWS access key IDs
  /\bAIza[0-9A-Za-z_-]{35}\b/g, // Google API keys
  /-----BEGIN[A-Z ]*PRIVATE KEY-----[\s\S]*?-----END[A-Z ]*PRIVATE KEY-----/g,
]

/** Email addresses are logged with the local part masked, never in full. */
const EMAIL_PATTERN = /\b([A-Za-z0-9._%+-])[A-Za-z0-9._%+-]*@([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/g

/**
 * A value the caller has classified.
 *
 * Layer 1 is a marker rather than a schema walk because at Milestone 1 nothing
 * declares sensitivity per *field* — event types declare a ceiling for the
 * whole payload. When per-field classification exists, this becomes the
 * fallback for values that arrive outside a schema, and it should stay: the
 * call site is the one place that always knows what a value is.
 */
export interface ClassifiedValue {
  readonly __fridaySensitivity: Sensitivity
  readonly value: unknown
}

/**
 * Marks a value with its sensitivity so the logger can decide about it.
 *
 * @param sensitivity - How closely the value must be held.
 * @param value - The value itself.
 * @returns A marker the redactor recognises. Anything `private` or above is
 *   replaced before it reaches the log.
 */
export function classified(sensitivity: Sensitivity, value: unknown): ClassifiedValue {
  return { __fridaySensitivity: sensitivity, value }
}

function isClassified(value: unknown): value is ClassifiedValue {
  return (
    typeof value === 'object' &&
    value !== null &&
    '__fridaySensitivity' in value &&
    'value' in value
  )
}

/**
 * Scrubs a string: credential shapes, email addresses, and the home directory.
 *
 * The home-directory rule looks cosmetic and is not — an absolute path names
 * the account it belongs to, and paths end up in error messages constantly.
 *
 * @param input - The string to scrub.
 * @returns The scrubbed string.
 */
export function scrubString(input: string): string {
  let output = input

  for (const pattern of SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, REDACTED)
  }

  output = output.replace(EMAIL_PATTERN, (_match, first: string, domain: string) => {
    return `${first}***@${domain}`
  })

  const home = homedir()
  if (home.length > 1) {
    output = output.replaceAll(home, '~')
  }

  return output
}

/**
 * Whether a field name is on the deny-list.
 *
 * @param key - The field name, in any casing.
 * @returns True when the field must be redacted whatever it holds.
 */
export function isDeniedKey(key: string): boolean {
  const letters = key.toLowerCase().replaceAll(/[^a-z]/g, '')
  return DENIED_KEY_FRAGMENTS.some((fragment) => letters.includes(fragment))
}

/** Deep enough for real log payloads; shallow enough to bound the work. */
const MAX_DEPTH = 8

/**
 * Applies all three layers to an arbitrary value.
 *
 * Cycles are broken rather than followed — a log call that hangs the process
 * is a worse outcome than a truncated object, and request objects are
 * routinely self-referential.
 *
 * @param value - Anything a caller passed to the logger.
 * @returns A structurally similar value, safe to write to disk.
 */
export function redact(value: unknown): unknown {
  return redactAt(value, 0, new WeakSet())
}

function redactAt(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return '[TRUNCATED: max depth]'

  if (typeof value === 'string') return scrubString(value)
  if (value === null || typeof value !== 'object') return value

  if (isClassified(value)) {
    // Layer 1. `private` and `secret` never reach the log; `public` and
    // `internal` still go through the other two layers.
    return isAtLeastAsSensitiveAs(value.__fridaySensitivity, 'private')
      ? REDACTED
      : redactAt(value.value, depth + 1, seen)
  }

  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)

  if (value instanceof Error) return redactError(value, depth, seen)
  if (Array.isArray(value)) return value.map((entry) => redactAt(entry, depth + 1, seen))

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    output[key] = isDeniedKey(key) ? REDACTED : redactAt(entry, depth + 1, seen)
  }
  return output
}

/**
 * Errors are serialised by hand.
 *
 * `Object.entries` on an Error returns nothing useful — `name`, `message`, and
 * `stack` are all non-enumerable — so an error logged without this becomes an
 * empty object, which is the single most annoying thing a log can contain.
 */
function redactError(error: Error, depth: number, seen: WeakSet<object>): Record<string, unknown> {
  const output: Record<string, unknown> = {
    type: error.name,
    message: scrubString(error.message),
  }

  if (typeof error.stack === 'string') output.stack = scrubString(error.stack)
  if (error.cause !== undefined) output.cause = redactAt(error.cause, depth + 1, seen)

  return output
}
