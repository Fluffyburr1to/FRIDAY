import type { FridayError, ModelRequest, ModelResponse, Result } from '@friday/contracts'

/**
 * The port every model provider implements.
 *
 * ★ **This is the seam Principle 5 is made of.** A vendor sits behind this
 * interface and nowhere else — swapping one is writing another file in this
 * package, not editing a thousand call sites. ADR-0008 puts the whole of
 * FRIDAY's vendor-neutrality on it, which is why it is deliberately small: a
 * wide port is one only some vendors can fill.
 *
 * Reference: docs/adr/0008-model-router.md
 */
export interface ModelProvider {
  /** Stable, and recorded on every invocation. Never chosen by a caller. */
  readonly name: string

  /**
   * ★ Whether this provider keeps data on the machine.
   *
   * The one property routing actually branches on. A provider that answers
   * `true` may serve `private` and above; one that answers `false` may not,
   * ever, under any configuration — see `router.ts`.
   *
   * It is a property of the provider rather than a configuration flag on
   * purpose. A flag can be set wrongly in a file nobody reads; this can only
   * be wrong in code, in a diff, in this package.
   */
  readonly isLocal: boolean

  /** Which capabilities it can serve. A request outside this is not offered. */
  readonly capabilities: readonly string[]

  /**
   * Whether it can be reached right now.
   *
   * Separate from `serve` because routing has to distinguish *"the local model
   * is not installed"* from *"the local model failed"*. The first is a
   * configuration state the owner can fix and the message should say so; the
   * second is an incident.
   */
  isAvailable(): Promise<boolean>

  /**
   * Runs one request.
   *
   * Implementations own their own timeout — `request.timeoutMs` is a ceiling,
   * not a suggestion, and a provider that hangs holds a plan open.
   *
   * @param request - What was asked for, already validated.
   * @returns The response and what it cost, or a typed failure.
   */
  serve(request: ModelRequest): Promise<Result<ModelResponse, FridayError>>
}
