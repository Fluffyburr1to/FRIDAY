/**
 * The relocation gate.
 *
 * ── The invariant ───────────────────────────────────────────────────────────
 *
 * **A release artifact must not contain references to the build machine's
 * filesystem, and must not require the build machine's filesystem in order to
 * execute.**
 *
 * Both halves matter and they fail differently. Requiring the build machine is
 * a bundle that runs for the person who made it and is inert everywhere else —
 * the failure ADR-0033 exists to prevent, and the one `--legacy` produces while
 * exiting 0. Merely *containing* the path is not fatal, but it discloses the
 * builder's directory layout inside something we intend to hand to a machine,
 * and it is the kind of residue that stops being noticed once it is normal.
 *
 * ── Why the audit reads everything ──────────────────────────────────────────
 *
 * Because the leaks were not where the design predicted. ADR-0037 §6a named the
 * root `package.json`. Measuring the real artifact found the path in five
 * places, only one of which was that file: the lockfile, pnpm's `.modules.yaml`,
 * and two node-gyp leftovers inside `better-sqlite3` carried it as well. A gate
 * that checked the predicted location would have passed an artifact with four
 * live leaks in it.
 *
 * So this walks the whole tree, reads every regular file as bytes, and checks
 * directory names and symlink targets too. Bytes rather than text on purpose: a
 * path compiled into a native addon is a leak, and reading only `.json` would
 * miss it.
 *
 * Reference: docs/adr/0037-the-bundle-is-a-package-that-names-what-ships.md §6
 *            docs/adr/0036-packaging-delivers-friday-init-provisions.md §1
 */

import { readdirSync, readFileSync, readlinkSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'

/** One thing wrong with the artifact. Every finding fails the release. */
export interface Finding {
  readonly kind: 'build-path' | 'dangling-symlink' | 'escaping-symlink' | 'missing'

  /** Artifact-relative, so a finding reads the same on any machine. */
  readonly path: string

  readonly detail: string
}

export interface AuditRequest {
  /** The extracted or deployed artifact root. */
  readonly root: string

  /**
   * Absolute paths that must appear nowhere — the staging directory the
   * artifact was built in, and the builder's home.
   */
  readonly forbidden: readonly string[]
}

/**
 * What the artifact must contain to be worth shipping.
 *
 * Presence rather than correctness: that `@friday/core` is here at all is the
 * defect ADR-0037 exists to close, and the shipped rules and the native driver
 * are the two things that have historically gone missing without a build
 * failing. Each is a glob-free, exact expectation so the failure names a path.
 */
const REQUIRED = [
  'node_modules/@friday/cli',
  'node_modules/@friday/core',
  'node_modules/.bin/friday',
] as const

/**
 * Walks every entry beneath a directory without following symlinks.
 *
 * `lstat` semantics throughout — a symlink is an entry to inspect, never a
 * door to walk through. Following them would visit the virtual store many
 * times over and could leave the artifact entirely.
 */
function* walk(directory: string): Generator<{ path: string; entry: string }> {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)

    yield { path, entry: entry.name }

    if (entry.isDirectory() && !entry.isSymbolicLink()) yield* walk(path)
  }
}

/** Reports whether a resolved path is inside the artifact. */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)

  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Checks one symlink.
 *
 * Two distinct failures. **Dangling** means the target is not there, which
 * after extraction means the archive did not carry what it pointed at.
 * **Escaping** means the target resolves outside the artifact — the `--legacy`
 * failure exactly, and the one that runs perfectly on the machine that built it.
 */
function auditSymlink(root: string, path: string): Finding[] {
  const findings: Finding[] = []
  const target = resolve(path, '..', readlinkSync(path))

  if (!isInside(root, target)) {
    findings.push({
      kind: 'escaping-symlink',
      path: relative(root, path),
      detail: `points outside the artifact, to ${target}`,
    })
  }

  try {
    statSync(path)
  } catch {
    findings.push({
      kind: 'dangling-symlink',
      path: relative(root, path),
      detail: 'target does not exist',
    })
  }

  return findings
}

/**
 * Searches a file's bytes for any forbidden path.
 *
 * Read as a `Buffer` and matched with `includes`, so this sees a path baked
 * into a compiled addon exactly as it sees one in JSON.
 */
function auditContents(root: string, path: string, forbidden: readonly string[]): Finding[] {
  let bytes: Buffer

  try {
    bytes = readFileSync(path)
  } catch {
    // Unreadable is not a leak. It surfaces as a missing-content finding if it
    // was something we required.
    return []
  }

  return forbidden
    .filter((needle) => bytes.includes(needle))
    .map((needle) => ({
      kind: 'build-path' as const,
      path: relative(root, path),
      detail: `contains the build path ${needle}`,
    }))
}

/**
 * Audits an artifact against the relocation invariant.
 *
 * @param request - The artifact root and the paths that must not appear.
 * @returns Every finding. An empty array is the only passing result.
 */
export function auditArtifact(request: AuditRequest): Finding[] {
  const root = resolve(request.root)
  const findings: Finding[] = []

  for (const required of REQUIRED) {
    try {
      statSync(join(root, required))
    } catch {
      findings.push({
        kind: 'missing',
        path: required,
        detail: 'required content is not in the artifact',
      })
    }
  }

  findings.push(...auditRequiredPayload(root))

  for (const { path, entry } of walk(root)) {
    // A directory *name* can carry the build path even when nothing inside it
    // does — pnpm encodes the source location into the virtual store's entries.
    //
    // ★ It encodes them with `+` where the path has `/`, so a literal search
    // finds nothing. Checking only the literal form left this gate blind to the
    // one leak it was most specifically written for; a planted fixture caught
    // it. Both spellings are checked.
    for (const needle of encodings(request.forbidden)) {
      if (entry.includes(needle)) {
        findings.push({
          kind: 'build-path',
          path: relative(root, path),
          detail: `the name encodes the build path ${needle}`,
        })
      }
    }

    const stats = statSync(path, { throwIfNoEntry: false, bigint: false })
    const isLink = readlinkSafe(path) !== undefined

    if (isLink) {
      findings.push(...auditSymlink(root, path))
      continue
    }

    if (stats?.isFile() === true) {
      findings.push(...auditContents(root, path, request.forbidden))
    }
  }

  return findings
}

/**
 * Every spelling a forbidden path can appear in.
 *
 * The literal path, and pnpm's virtual-store encoding of it, which substitutes
 * `+` for `/` — so `/private/tmp/x` becomes `+private+tmp+x` inside a directory
 * name. Deduplicated, because a path with no separators has one spelling.
 */
function encodings(forbidden: readonly string[]): string[] {
  return [...new Set(forbidden.flatMap((path) => [path, path.replaceAll('/', '+')]))]
}

/** Reads a symlink target, or `undefined` when the entry is not a symlink. */
function readlinkSafe(path: string): string | undefined {
  try {
    return readlinkSync(path)
  } catch {
    return undefined
  }
}

/**
 * Checks the two payloads that have gone missing before without failing a build.
 *
 * Both are located by searching rather than by a fixed path, because pnpm's
 * virtual store names its directories itself and this audit must not depend on
 * the shape of those names — the thing it is partly here to watch.
 */
function auditRequiredPayload(root: string): Finding[] {
  const findings: Finding[] = []
  const store = join(root, 'node_modules/.pnpm')

  const policies = findFirst(
    store,
    (path, entry) => entry.endsWith('.json') && path.includes(`${'guardian'}/policies/`),
  )

  if (policies === undefined) {
    findings.push({
      kind: 'missing',
      path: 'node_modules/.pnpm/**/guardian/policies/*.json',
      detail:
        'the shipped authorization rules are not in the artifact; `friday init` seeds from them',
    })
  }

  const prebuild = findFirst(
    store,
    (_path, entry) => entry === 'darwin-arm64.node' || entry === 'darwin-x64.node',
  )

  if (prebuild === undefined) {
    findings.push({
      kind: 'missing',
      path: 'node_modules/.pnpm/better-sqlite3@*/**/prebuilds/darwin-*.node',
      detail: 'no macOS prebuild for the SQLite driver; the artifact would need a compiler',
    })
  }

  return findings
}

/** First entry beneath a directory matching a predicate, or `undefined`. */
function findFirst(
  directory: string,
  matches: (path: string, entry: string) => boolean,
): string | undefined {
  try {
    for (const { path, entry } of walk(directory)) {
      if (matches(path, entry)) return path
    }
  } catch {
    return undefined
  }

  return undefined
}

/**
 * Renders findings for a terminal.
 *
 * @param findings - What the audit returned.
 * @returns A block of text, or an empty string when there is nothing wrong.
 */
export function describeFindings(findings: readonly Finding[]): string {
  return findings
    .map((finding) => `  ${finding.kind}: ${finding.path}\n    ${finding.detail}`)
    .join('\n')
}
