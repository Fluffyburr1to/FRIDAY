import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { isOurs, renderPlist, resolveServicePaths, SERVICE_LABEL } from '../../src/index.js'

/**
 * The LaunchAgent definition, and the guard that decides what may be deleted.
 *
 * ── What this tier can and cannot prove ─────────────────────────────────────
 *
 * **Automatically tested (here):** that the template renders into a plist with
 * the settings Chapter 33 requires, that no placeholder survives, that nothing
 * secret reaches the file, that installing from a source checkout is refused,
 * and that the deletion guard rejects a plist FRIDAY cannot account for. All of
 * it is string and filesystem work, so it runs on the Ubuntu runner unchanged.
 *
 * **Not tested here, and deliberately not faked:** `launchctl load`, starting
 * at login, surviving a logout, and the locked-Keychain race. Those need a Mac
 * with a login session, and a test that skipped itself on CI would report
 * coverage this milestone has not earned — which is the exact failure mode M3
 * was criticised for.
 *
 * Reference: docs/01-bible/33-deployment-strategy.md
 *            docs/adr/0036-packaging-delivers-friday-init-provisions.md §5
 */

const TEMPLATE = readFileSync(
  new URL('../../../../infra/launchd/com.friday.core.plist.tmpl', import.meta.url),
  'utf8',
)

const PATHS = {
  artifact: '/Users/owner/.local/friday/0.1.0',
  coreEntry: '/Users/owner/.local/friday/0.1.0/node_modules/@friday/core/dist/index.js',
  node: '/usr/local/bin/node',
  stdoutLog: '/Users/owner/Library/Logs/FRIDAY/friday-core.out.log',
  stderrLog: '/Users/owner/Library/Logs/FRIDAY/friday-core.err.log',
} as const

describe('the LaunchAgent definition', () => {
  const plist = renderPlist(TEMPLATE, PATHS)

  it('leaves no placeholder unfilled', () => {
    // A surviving placeholder is a plist launchd rejects, or worse accepts with
    // a literal `{{NODE}}` as the program.
    expect(plist).not.toMatch(/{{[A-Z_]+}}/)
  })

  it('runs the packaged core with an absolute Node', () => {
    // A LaunchAgent starts with a minimal environment and no useful PATH, so a
    // bare `node` would not be found.
    expect(plist).toContain(`<string>${PATHS.node}</string>`)
    expect(plist).toContain(`<string>${PATHS.coreEntry}</string>`)
  })

  it('carries the settings Chapter 33 requires', () => {
    expect(plist).toContain(`<key>Label</key>\n  <string>${SERVICE_LABEL}</string>`)
    expect(plist).toMatch(/<key>RunAtLoad<\/key>\s*<true\/>/)
    expect(plist).toMatch(/<key>KeepAlive<\/key>\s*<true\/>/)
    expect(plist).toMatch(/<key>ThrottleInterval<\/key>\s*<integer>10<\/integer>/)
    expect(plist).toMatch(/<key>ProcessType<\/key>\s*<string>Background<\/string>/)
    expect(plist).toMatch(/<key>Nice<\/key>\s*<integer>5<\/integer>/)
  })

  it('keeps KeepAlive unconditional rather than keyed on how she exited', () => {
    // ★ `KeepAlive` as a dictionary — `SuccessfulExit`, `Crashed` — would make
    // FRIDAY's own diagnosis of why she stopped into a decision about whether
    // to start again. Chapter 33 says restart regardless.
    expect(plist).not.toMatch(/<key>KeepAlive<\/key>\s*<dict>/)
  })

  it('sends both streams somewhere readable', () => {
    // Without these, launchd discards whatever she wrote before stopping, and
    // a failed start is indistinguishable from a silent one.
    expect(plist).toContain(`<key>StandardOutPath</key>\n  <string>${PATHS.stdoutLog}</string>`)
    expect(plist).toContain(`<key>StandardErrorPath</key>\n  <string>${PATHS.stderrLog}</string>`)
  })

  it('is an agent definition, not a daemon one', () => {
    // Article V. A LaunchDaemon runs as root at boot and cannot reach the
    // owner's Keychain, which is the one thing FRIDAY needs from the session.
    expect(plist).not.toContain('<key>UserName</key>')
    expect(plist).not.toContain('<key>GroupName</key>')
    expect(plist).not.toMatch(/<key>RootDirectory<\/key>/)
  })

  it('carries nothing secret, and no environment block to hide one in', () => {
    // ★ A plist is world-readable and survives in backups. Key material reaches
    // FRIDAY through the Keychain and by no other route — so the safest
    // property is that there is nowhere here to put one.
    expect(plist).not.toContain('<key>EnvironmentVariables</key>')

    // The keyword scan runs over the *data*, with the comments removed. The
    // template's own prose says the word "secret" while explaining that none
    // may appear, and a check that cannot tell those apart would either fail
    // forever or force the documentation out of the file.
    const data = plist.replace(/<!--[\s\S]*?-->/g, '')

    for (const forbidden of ['password', 'secret', 'token', 'credential', 'key-ref']) {
      expect(data.toLowerCase()).not.toContain(forbidden)
    }
  })

  it('has no comment that smuggles a value back in', () => {
    // The scan above ignores comments, so this asserts separately that they
    // hold prose rather than anything shaped like a key.
    const comments = plist.match(/<!--[\s\S]*?-->/g)?.join('\n') ?? ''

    expect(comments).not.toMatch(/[A-Za-z0-9+/]{40,}={0,2}/)
  })

  it('substitutes only what it was given', () => {
    // An unknown placeholder is left alone rather than replaced with
    // `undefined`, which would be a plist that looks filled in and is not.
    expect(renderPlist('<string>{{NOPE}}</string>', PATHS)).toContain('{{NOPE}}')
  })
})

describe('finding the installed copy', () => {
  it('resolves every path in the install contract from a real artifact layout', () => {
    // ★ The success path, which was previously proven only by one manual probe.
    // A real directory tree rather than a mock: the whole risk in
    // `resolveServicePaths` is path arithmetic, and a mock would assert the
    // answer rather than derive it. Built to match what `pnpm deploy` produces
    // under the hoisted layout ADR-0038 chose.
    const root = mkdtempSync(join(tmpdir(), 'friday-artifact-'))

    try {
      const cliDist = join(root, 'node_modules/@friday/cli/dist/commands')
      const coreDist = join(root, 'node_modules/@friday/core/dist')

      mkdirSync(cliDist, { recursive: true })
      mkdirSync(coreDist, { recursive: true })
      mkdirSync(join(root, 'share'), { recursive: true })
      writeFileSync(join(coreDist, 'index.js'), '')
      writeFileSync(join(root, 'share/com.friday.core.plist.tmpl'), TEMPLATE)

      const resolved = resolveServicePaths({
        // Exactly where the built module sits in an artifact.
        moduleUrl: pathToFileURL(join(cliDist, 'service.js')).href,
        execPath: '/usr/local/bin/node',
        logDirectory: '/Users/owner/Library/Logs/FRIDAY',
      })

      expect(resolved.ok).toBe(true)
      if (!resolved.ok) return

      // Artifact root, derived — not asserted by construction.
      expect(realpathSync(resolved.value.artifact)).toBe(realpathSync(root))

      // The core entry the plist will name, and it must actually be there.
      expect(resolved.value.coreEntry).toBe(join(root, 'node_modules/@friday/core/dist/index.js'))
      expect(existsSync(resolved.value.coreEntry)).toBe(true)

      // The template the command will read, at the location ADR-0036 §1 names.
      expect(existsSync(join(resolved.value.artifact, 'share/com.friday.core.plist.tmpl'))).toBe(
        true,
      )

      // The logs, under the configured directory rather than anywhere invented.
      expect(resolved.value.stdoutLog).toBe('/Users/owner/Library/Logs/FRIDAY/friday-core.out.log')
      expect(resolved.value.stderrLog).toBe('/Users/owner/Library/Logs/FRIDAY/friday-core.err.log')
      expect(resolved.value.node).toBe('/usr/local/bin/node')

      // And the whole contract renders into a plist launchd could act on.
      const plist = renderPlist(TEMPLATE, resolved.value)
      expect(plist).not.toMatch(/{{[A-Z_]+}}/)
      expect(isOurs(plist)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('refuses to install a service from a source checkout', () => {
    // The arithmetic that finds the artifact from a packaged CLI yields the
    // directory above the repository when run from the workspace. A service
    // pointing into somebody's projects folder would appear to work until the
    // checkout moved, so this must be an error rather than a guess.
    const resolved = resolveServicePaths({
      moduleUrl: import.meta.url,
      execPath: '/usr/local/bin/node',
      logDirectory: '/tmp/logs',
    })

    expect(resolved.ok).toBe(false)

    if (!resolved.ok) {
      expect(resolved.error.message).toContain('installed copy')
      expect(resolved.error.message).toContain('release.ts')
    }
  })
})

describe('the guard on what may be deleted', () => {
  // ★ A real installation on disk, because ownership is now a claim about the
  // filesystem: ADR-0036 §5 requires the program path to point *inside a FRIDAY
  // install*, and a string cannot settle that. The fictional paths this suite
  // used before were rejected by the fixed guard — correctly, and that is the
  // whole point of the change.
  let root: string
  let ours: string

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'friday-guard-'))
    mkdirSync(join(root, 'node_modules/@friday/cli'), { recursive: true })
    mkdirSync(join(root, 'node_modules/@friday/core/dist'), { recursive: true })
    writeFileSync(join(root, 'node_modules/@friday/core/dist/index.js'), '')

    ours = renderPlist(TEMPLATE, {
      ...PATHS,
      artifact: root,
      coreEntry: join(root, 'node_modules/@friday/core/dist/index.js'),
    })
  })

  afterEach(() => {
    rmSync(root, { recursive: true, force: true })
  })

  it('accepts a plist FRIDAY wrote, pointing at an install that is really there', () => {
    expect(isOurs(ours)).toBe(true)
  })

  it('refuses once the installation it points at is gone', () => {
    // Uninstalling FRIDAY by deleting her directory must not leave a plist that
    // still reads as hers — there is nothing left to prove ownership against.
    rmSync(join(root, 'node_modules/@friday/core'), { recursive: true, force: true })

    expect(isOurs(ours)).toBe(false)
  })

  it('refuses a tree that is only half a FRIDAY', () => {
    // An install is both applications the bundle names (ADR-0037 §2). A lone
    // `@friday/core` directory somebody happened to create is not one.
    rmSync(join(root, 'node_modules/@friday/cli'), { recursive: true, force: true })

    expect(isOurs(ours)).toBe(false)
  })

  it('refuses when something other than node would be run', () => {
    expect(isOurs(ours.replace('/usr/local/bin/node', '/usr/bin/curl'))).toBe(false)
  })

  it('refuses a decoy hidden in a nested dictionary', () => {
    // ★ Found by hostile probing of the fix, not by review. The guard read the
    // first `ProgramArguments` anywhere in the file, so a decoy inside an
    // unrelated nested dict — `Sockets` here — appeared earlier than the real
    // one and satisfied it, while launchd would obey the top-level entry and
    // run curl. Only top-level keys count now.
    const decoy = ours
      .replace(
        '<key>ProgramArguments</key>',
        '<key>Sockets</key>\n  <dict>\n    <key>ProgramArguments</key>\n    <array>' +
          `<string>/usr/local/bin/node</string><string>${join(root, 'node_modules/@friday/core/dist/index.js')}</string>` +
          '</array>\n  </dict>\n  <key>ProgramArguments</key>',
      )
      .replace(
        /<key>ProgramArguments<\/key>\n {2}<array>\n {4}<string>\/usr\/local\/bin\/node<\/string>[\s\S]*?<\/array>/,
        '<key>ProgramArguments</key>\n  <array><string>/usr/bin/curl</string><string>x</string></array>',
      )

    expect(isOurs(decoy)).toBe(false)
  })

  it('is not confused by the nested dictionaries a real plist may carry', () => {
    // The counterpart: skipping nested dictionaries must not make the parser
    // lose the keys that come after one.
    const withNested = ours.replace(
      '<key>ProgramArguments</key>',
      '<key>KeepAlive</key>\n  <dict><key>SuccessfulExit</key><false/></dict>\n  <key>ProgramArguments</key>',
    )

    expect(isOurs(withNested)).toBe(true)
  })

  it('refuses when extra arguments have been appended', () => {
    // The shape is pinned to what this command writes: an interpreter and the
    // entry. `node --eval <something> core.js` is not a plist FRIDAY produced.
    const extra = ours.replace(
      '<array>',
      '<array>\n    <string>--experimental-loader=/tmp/evil.mjs</string>',
    )

    expect(isOurs(extra)).toBe(false)
  })

  it('refuses a file that merely carries her name', () => {
    // ★ The label proves nothing — anyone can write a file called
    // `com.friday.core.plist`. What `uninstall` needs before deleting is
    // evidence that the file points at a FRIDAY, and only the program path is
    // that evidence.
    const impostor = `<plist><dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/curl</string><string>http://example.invalid</string></array>
</dict></plist>`

    expect(isOurs(impostor)).toBe(false)
  })

  it('refuses a FRIDAY-shaped plist under somebody else’s label', () => {
    expect(isOurs(ours.replace(SERVICE_LABEL, 'com.example.other'))).toBe(false)
  })

  it('refuses an empty or unparseable file', () => {
    expect(isOurs('')).toBe(false)
    expect(isOurs('not a plist at all')).toBe(false)
  })

  it('refuses a plist that runs something else but mentions FRIDAY elsewhere', () => {
    // ★ Demonstrated bypass. The guard searched the whole file for the core
    // path, so any field could satisfy it — here `WorkingDirectory` does, while
    // the thing launchd would actually run is curl. Uninstall would have
    // unloaded and deleted somebody else's job.
    const impostor = `<plist version="1.0"><dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>/usr/bin/curl</string><string>http://example.invalid</string></array>
  <key>WorkingDirectory</key>
  <string>/anywhere/node_modules/@friday/core/dist/index.js</string>
</dict></plist>`

    expect(isOurs(impostor)).toBe(false)
  })

  it('refuses a plist pointing at a FRIDAY install that does not exist', () => {
    // ★ Demonstrated bypass. ADR-0036 §5 requires the program path to point
    // *inside a FRIDAY install*; a FRIDAY-shaped string is not an install, and
    // the guard never looked at the filesystem.
    const ghost = `<plist version="1.0"><dict>
  <key>Label</key>
  <string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <string>/nonexistent/node_modules/@friday/core/dist/index.js</string>
  </array>
</dict></plist>`

    expect(isOurs(ghost)).toBe(false)
  })
})
