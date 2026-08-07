/**
 * `Result` — the return type for anything that can fail in normal operation.
 *
 * Chapter 30 draws the line precisely: a network call, a validation, a
 * permission denial, a missing row — all of those are ordinary outcomes and
 * return a `Result`. A `throw` is reserved for genuine bugs and states that
 * should be impossible.
 *
 * The reason this matters more here than in most codebases: an exception is
 * invisible in a signature. Neither the owner nor an AI assistant reading
 * `appendEvent(...)` in isolation can tell that it might throw. A `Result`
 * return type makes failure part of the contract and the compiler forces the
 * caller to deal with it.
 *
 * Reference: docs/01-bible/30-coding-standards.md
 */

/** A successful outcome carrying a value. */
export interface Ok<T> {
  readonly ok: true
  readonly value: T
}

/** A failed outcome carrying a typed error. */
export interface Err<E> {
  readonly ok: false
  readonly error: E
}

/**
 * The outcome of an operation that can fail as part of normal use.
 *
 * Discriminate on `.ok` — TypeScript narrows both branches from it.
 */
export type Result<T, E> = Ok<T> | Err<E>

/**
 * Wraps a value as a successful result.
 *
 * @param value - The value the operation produced.
 * @returns A result that callers will narrow to `Ok`.
 */
export function ok<T>(value: T): Ok<T> {
  return { ok: true, value }
}

/**
 * Wraps an error as a failed result.
 *
 * @param error - The typed error describing what went wrong.
 * @returns A result that callers will narrow to `Err`.
 */
export function err<E>(error: E): Err<E> {
  return { ok: false, error }
}

/**
 * Narrows a result to its success branch.
 *
 * @param result - The result to inspect.
 * @returns True when the operation succeeded.
 */
export function isOk<T, E>(result: Result<T, E>): result is Ok<T> {
  return result.ok
}

/**
 * Narrows a result to its failure branch.
 *
 * @param result - The result to inspect.
 * @returns True when the operation failed.
 */
export function isErr<T, E>(result: Result<T, E>): result is Err<E> {
  return !result.ok
}

/**
 * Returns the value, or a fallback when the operation failed.
 *
 * Deliberately the ONLY unwrapping helper in this module. A `unwrap()` that
 * throws on failure re-introduces exactly the invisible control flow that
 * `Result` exists to remove, and it is the first thing that gets reached for
 * when a caller is in a hurry.
 *
 * @param result - The result to read.
 * @param fallback - Returned when the result is an error.
 * @returns The success value, or the fallback.
 */
export function unwrapOr<T, E>(result: Result<T, E>, fallback: T): T {
  return result.ok ? result.value : fallback
}
