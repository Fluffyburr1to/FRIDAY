/**
 * Argument parsing.
 *
 * Hand-written rather than a library, and this is the one place in FRIDAY
 * where that is not a close call. The recovery commands must work when
 * everything else is broken — `friday panic --revoke-all` is reached for
 * precisely when something has gone badly wrong — and every dependency this
 * app carries is one more thing that can be the reason it will not start.
 *
 * Node 24 ships `util.parseArgs`, which would do most of this. It is not used
 * because its error behaviour on an unknown flag is to throw, and a CLI that
 * throws a stack trace at a typo is not one you want to meet during an
 * incident.
 *
 * Reference: apps/cli/README.md · docs/01-bible/34-disaster-recovery.md
 */

export interface ParsedArgs {
  /** `events tail` parses to `['events', 'tail']`. */
  readonly command: readonly string[]

  /** `--since 12` and `--json`. A bare flag parses to `true`. */
  readonly flags: Readonly<Record<string, string | true>>
}

/**
 * Parses `process.argv`-style arguments.
 *
 * @param argv - The arguments after the program name.
 * @returns The command path and the flags.
 */
export function parseArgs(argv: readonly string[]): ParsedArgs {
  const command: string[] = []
  const flags: Record<string, string | true> = {}

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i]
    if (token === undefined) continue

    if (!token.startsWith('-')) {
      command.push(token)
      continue
    }

    const name = token.replace(/^--?/, '')

    // `--since=12` and `--since 12` both work, because both get typed.
    if (name.includes('=')) {
      const [key, ...rest] = name.split('=')
      if (key !== undefined) flags[key] = rest.join('=')
      continue
    }

    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith('-')) {
      flags[name] = next
      i += 1
    } else {
      flags[name] = true
    }
  }

  return { command, flags }
}

/**
 * Reads a flag as a number.
 *
 * @param flags - The parsed flags.
 * @param name - The flag to read.
 * @param fallback - Used when the flag is absent.
 * @returns The number, or `undefined` when the flag was present but not a
 *   number — which the caller reports as a usage error rather than silently
 *   falling back, because a mistyped `--since` would otherwise print the whole
 *   log instead of the tail.
 */
export function numberFlag(
  flags: ParsedArgs['flags'],
  name: string,
  fallback: number,
): number | undefined {
  const value = flags[name]
  if (value === undefined) return fallback
  if (value === true) return undefined

  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

/**
 * Reads a flag as a string.
 *
 * @param flags - The parsed flags.
 * @param name - The flag to read.
 * @returns The value, or `undefined` when absent or given without one.
 */
export function stringFlag(flags: ParsedArgs['flags'], name: string): string | undefined {
  const value = flags[name]
  return typeof value === 'string' ? value : undefined
}
