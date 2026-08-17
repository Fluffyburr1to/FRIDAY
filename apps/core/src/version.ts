import { readFileSync } from 'node:fs'

/**
 * What this build calls itself when FRIDAY records that she started.
 *
 * ★ Read from the package's own manifest rather than baked into the source.
 * [`tools/scripts/release.ts`](../../../tools/scripts/release.ts) reads the
 * artifact's `package.json` to report what shipped, so taking the same file
 * here means the version in the log and the version in the release report
 * cannot drift — there is one answer, not two. It is deliberately not a
 * constant: a number written here would become the second answer.
 *
 * ── Why it is read by path ──────────────────────────────────────────────────
 *
 * `exports` names only `.`, so `import.meta.resolve('@friday/core/package.json')`
 * fails with `ERR_PACKAGE_PATH_NOT_EXPORTED` — the same resolution ADR-0035
 * records hitting for the shipped policies. `dist/` sits one level below the
 * package root in the checkout and in a deployed bundle alike, because `files`
 * ships `dist` and the manifest travels beside it.
 *
 * ── ★ Why an unreadable manifest is not an error ────────────────────────────
 *
 * It reports `unknown`, and never a guess. A fabricated version is a claim
 * about which build is running, and a wrong one sends whoever is debugging a
 * failed start to the wrong source. ADR-0042 settled the general shape: a
 * reading nobody took is reported as absent rather than as a plausible number.
 *
 * It is also not fatal. FRIDAY not knowing her own version is worth recording
 * honestly; it is not a reason to refuse to start, and `system.started` matters
 * more than the label on it.
 *
 * @returns The version from the manifest, or `unknown` when it cannot be read.
 */
export function coreVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      version?: unknown
    }

    return typeof manifest.version === 'string' && manifest.version !== ''
      ? manifest.version
      : 'unknown'
  } catch {
    return 'unknown'
  }
}
