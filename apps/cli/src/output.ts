/**
 * Writing to the terminal.
 *
 * `console` is banned repository-wide, and not only as a style rule: every
 * console method bypasses the logger's redaction layer, and a leaked
 * credential in stderr is exactly as bad as one in stdout. The CLI's job IS
 * printing, so it writes to the streams directly — deliberately, in one place,
 * where the decision is visible.
 *
 * Output is human-readable by default and `--json` for machines. The JSON form
 * is not an afterthought: it is what makes the CLI scriptable, and it is what
 * the recovery runbooks parse.
 *
 * Reference: docs/01-bible/34-disaster-recovery.md
 */

export interface Output {
  /** A line of human-readable text. Suppressed entirely in JSON mode. */
  line(text: string): void

  /** One JSON object per line, or nothing in human mode. */
  json(value: unknown): void

  /** A problem, for someone who does not read code. Always shown. */
  problem(text: string): void

  readonly isJson: boolean
}

export interface OutputOptions {
  json: boolean
  stdout?: NodeJS.WritableStream
  stderr?: NodeJS.WritableStream
}

/**
 * Creates the output surface.
 *
 * @param options - Whether to emit JSON, and the streams to write to.
 * @returns The output surface.
 */
export function createOutput(options: OutputOptions): Output {
  const stdout = options.stdout ?? process.stdout
  const stderr = options.stderr ?? process.stderr

  return {
    isJson: options.json,

    line(text) {
      if (!options.json) stdout.write(`${text}\n`)
    },

    json(value) {
      if (options.json) stdout.write(`${JSON.stringify(value)}\n`)
    },

    problem(text) {
      // Always written, in both modes, and to stderr — so `friday verify
      // --json | jq` still shows the reason when it fails.
      stderr.write(`${text}\n`)
    },
  }
}

/** Exit codes, so the runbooks and CI can branch on them. */
export const EXIT = {
  ok: 0,

  /** The command ran and found a problem — a broken chain, a missing log. */
  problem: 1,

  /** The command was used wrongly. Distinct, so a typo is not read as a fault. */
  usage: 2,
} as const

export type ExitCode = (typeof EXIT)[keyof typeof EXIT]

/**
 * Renders a timestamp for a human reading a terminal.
 *
 * Local time, seconds precision. The event log stores milliseconds since the
 * epoch — the display format is a display concern and never round-trips back
 * into anything.
 *
 * @param millis - Milliseconds since the Unix epoch.
 * @returns A local `HH:MM:SS` string.
 */
export function formatTime(millis: number): string {
  return new Date(millis).toLocaleTimeString('en-GB', { hour12: false })
}

/**
 * Renders a byte count for a human.
 *
 * @param bytes - The size in bytes.
 * @returns A short string such as `1.4 MB`.
 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(2)} GB`
}
