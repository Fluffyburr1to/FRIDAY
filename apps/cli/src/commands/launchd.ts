import { execFileSync } from 'node:child_process'
import { existsSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'

/**
 * Talking to launchd, and deciding what FRIDAY is allowed to delete.
 *
 * Separated from the commands because both halves are load-bearing safety
 * checks that must be testable without a Mac: one decides whether a file may be
 * removed, the other decides whether an operation actually worked.
 *
 * Reference: docs/adr/0036-packaging-delivers-friday-init-provisions.md §5
 *            docs/01-bible/33-deployment-strategy.md
 */

/** The agent's name. `isOurs` proves ownership partly by it. */
export const SERVICE_LABEL = 'com.friday.core'

/** Where core's entry point sits inside an installed artifact. */
const CORE_ENTRY_SUFFIX = join('node_modules', '@friday', 'core', 'dist', 'index.js')

/** What a subprocess did, in the detail needed to tell success from noise. */
export interface CommandResult {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
}

/**
 * Decides whether a `launchctl` invocation actually worked.
 *
 * ★ **Exit code alone is not enough, and this is measured rather than
 * defensive.** On macOS 26.6, `launchctl unload` against a job that is not
 * loaded prints `Unload failed: 5: Input/output error` and exits **0**. A
 * helper that trusted the status would report a failure as a success — and in
 * the install path that means telling the owner FRIDAY will start at login when
 * launchd refused the job.
 *
 * So a non-zero status is a failure, and so is a zero status with a complaint
 * on stderr. The cost of the second rule is a false alarm on some future
 * chatty-but-successful invocation, which is the safe direction: it reports a
 * problem that is not there rather than hiding one that is.
 *
 * @param result - What the subprocess returned.
 * @returns The reason it failed, or `undefined` when it succeeded.
 */
export function launchctlFailure(result: CommandResult): string | undefined {
  const said = (result.stderr.trim() !== '' ? result.stderr : result.stdout).trim()

  if (result.status !== 0) return said === '' ? `exited ${result.status ?? 'abnormally'}` : said

  return /\b(fail(ed|ure)?|error|denied|not permitted)\b/i.test(result.stderr) ? said : undefined
}

/** Runs `launchctl`, capturing both streams rather than throwing. */
export function runLaunchctl(args: readonly string[]): CommandResult {
  try {
    const stdout = execFileSync('/bin/launchctl', args, {
      encoding: 'utf8',
      timeout: 30_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    return { status: 0, stdout, stderr: '' }
  } catch (cause) {
    const failed = cause as { status?: unknown; stdout?: unknown; stderr?: unknown }

    return {
      status: typeof failed.status === 'number' ? failed.status : null,
      stdout: typeof failed.stdout === 'string' ? failed.stdout : '',
      stderr: typeof failed.stderr === 'string' ? failed.stderr : String(cause),
    }
  }
}

/** The service's address in the per-user domain. */
export function serviceTarget(uid: number): string {
  return `gui/${uid}/${SERVICE_LABEL}`
}

/**
 * Asks launchd whether the agent is actually registered.
 *
 * ★ This is the only honest confirmation that `install` worked. `bootstrap`
 * accepting a file proves the file parsed, not that a job exists — and "the
 * plist was accepted as input" is precisely the success condition that must not
 * be invented.
 *
 * @param uid - The owner's user id.
 * @param run - The runner, injectable so a test can drive it.
 * @returns Whether launchd knows about the service.
 */
export function isRegistered(uid: number, run = runLaunchctl): boolean {
  return launchctlFailure(run(['print', serviceTarget(uid)])) === undefined
}

/**
 * Pulls one key out of a plist's outermost dictionary.
 *
 * A deliberately small parser rather than a dependency or a shell out to
 * `plutil`: this has to run on the Linux CI runner, and the guard below is
 * worth more when the thing that reads the file is the thing under test.
 *
 * It reads only what ownership depends on, and it is strict — anything it
 * cannot parse confidently yields `undefined`, which makes the guard refuse.
 * **Refusing wrongly leaves a file alone; accepting wrongly deletes one.**
 */
function readTopLevel(contents: string): Map<string, string | string[]> {
  const found = new Map<string, string | string[]>()
  const text = contents.replace(/<!--[\s\S]*?-->/g, '')
  const opened = text.indexOf('<dict>')

  if (opened === -1) return found

  let at = opened + '<dict>'.length

  while (at < text.length) {
    const keyAt = text.indexOf('<key>', at)
    const closed = text.indexOf('</dict>', at)

    // The outer dictionary ended before another key began.
    if (keyAt === -1 || (closed !== -1 && closed < keyAt)) break

    const keyEnd = text.indexOf('</key>', keyAt)

    if (keyEnd === -1) break

    const name = text.slice(keyAt + '<key>'.length, keyEnd).trim()
    const after = keyEnd + '</key>'.length
    const rest = text.slice(after)

    const asString = /^\s*<string>([\s\S]*?)<\/string>/.exec(rest)

    if (asString?.[1] !== undefined) {
      if (!found.has(name)) found.set(name, asString[1])
      at = after + asString[0].length
      continue
    }

    const asArray = /^\s*<array>([\s\S]*?)<\/array>/.exec(rest)

    if (asArray?.[1] !== undefined) {
      if (!found.has(name)) {
        found.set(
          name,
          [...asArray[1].matchAll(/<string>([\s\S]*?)<\/string>/g)].map((match) => match[1] ?? ''),
        )
      }

      at = after + asArray[0].length
      continue
    }

    // ★ A nested dictionary is skipped whole, and this is the point of parsing
    // rather than searching. A hostile probe found that a decoy
    // `ProgramArguments` inside an unrelated nested dict — `Sockets`, say —
    // appeared earlier in the file than the real one and satisfied the guard,
    // while launchd would obey the top-level entry running something else.
    // Descending would reintroduce exactly that.
    const nested = /^\s*<dict>/.exec(rest)

    at = nested === null ? skipScalar(text, after) : skipDict(text, after + nested[0].length)
  }

  return found
}

/** Advances past a balanced nested `<dict>`, given an index just inside it. */
function skipDict(text: string, from: number): number {
  let depth = 1
  let at = from

  while (depth > 0 && at < text.length) {
    const open = text.indexOf('<dict>', at)
    const close = text.indexOf('</dict>', at)

    if (close === -1) return text.length

    if (open !== -1 && open < close) {
      depth += 1
      at = open + '<dict>'.length
      continue
    }

    depth -= 1
    at = close + '</dict>'.length
  }

  return at
}

/** Advances past a value this parser does not need — `<true/>`, `<integer>`. */
function skipScalar(text: string, from: number): number {
  const scalar = /^\s*<([a-z]+)(\s*\/>|>[\s\S]*?<\/\1>)/.exec(text.slice(from))

  return scalar === null ? from + 1 : from + scalar[0].length
}

/** One top-level value, or `undefined` when it is absent or not readable. */
function plistValue(contents: string, key: string): string | readonly string[] | undefined {
  return readTopLevel(contents).get(key)
}

/** True when `child` is the same path as, or beneath, `parent`. */
function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child)

  // ★ Segment-wise rather than `startsWith`, which would accept
  // `/x/friday-evil` as being inside `/x/friday`.
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/**
 * Reports whether a path is core's entry inside a real FRIDAY installation.
 *
 * ADR-0036 §5 requires the program path to point **inside a FRIDAY install**,
 * which is a claim about the filesystem and cannot be settled by looking at the
 * string. An installation is a tree that holds both applications the bundle
 * names — `@friday/cli` and `@friday/core` (ADR-0037 §2).
 *
 * Symlinks are resolved before the containment check so that a link pointing
 * out of the tree cannot borrow its trustworthiness.
 */
function pointsIntoAnInstall(programPath: string): boolean {
  if (!isAbsolute(programPath)) return false
  if (!programPath.endsWith(CORE_ENTRY_SUFFIX)) return false

  let real: string

  try {
    if (!statSync(programPath).isFile()) return false
    real = realpathSync(programPath)
  } catch {
    // Not there. A FRIDAY-shaped path is not an installation.
    return false
  }

  const root = resolve(dirname(real), '..', '..', '..', '..')

  if (!isWithin(root, real)) return false

  return (
    existsSync(join(root, 'node_modules', '@friday', 'cli')) &&
    existsSync(join(root, 'node_modules', '@friday', 'core'))
  )
}

/**
 * Reports whether a plist is one FRIDAY wrote, and may therefore remove.
 *
 * ── What "ownership" has to mean ────────────────────────────────────────────
 *
 * Three things together, and each closes a demonstrated hole:
 *
 * 1. **The label is ours.** Necessary, and on its own worth nothing — anyone
 *    can write a file with that name in it.
 * 2. **The program launchd would run is core.** The previous version searched
 *    the whole file, so a job running `/usr/bin/curl` passed as long as a
 *    FRIDAY path appeared in any other field. Only `ProgramArguments` decides
 *    what runs, so only `ProgramArguments` may decide ownership.
 * 3. **That program is inside an installation that exists.** ADR-0036 §5 says
 *    "points inside a FRIDAY install", and a path that resolves to nothing is
 *    not one.
 *
 * The shape is pinned too: exactly an interpreter and core's entry, which is
 * what this command writes. Anything else is something FRIDAY did not produce,
 * and she does not delete what she cannot account for.
 *
 * @param contents - The plist on disk.
 * @returns Whether it is safe to remove.
 */
export function isOurs(contents: string): boolean {
  if (plistValue(contents, 'Label') !== SERVICE_LABEL) return false

  const program = plistValue(contents, 'ProgramArguments')

  if (!Array.isArray(program) || program.length !== 2) return false

  const [interpreter, entry] = program as readonly string[]

  if (interpreter === undefined || entry === undefined) return false

  // The interpreter is checked by name rather than by inspecting the binary:
  // this command always writes `process.execPath`, so anything else is a file
  // FRIDAY did not write, and refusing costs only a manual deletion.
  if (basename(interpreter) !== 'node') return false

  return pointsIntoAnInstall(entry)
}
