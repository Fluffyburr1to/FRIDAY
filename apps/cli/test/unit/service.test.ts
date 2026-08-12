import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
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
  const ours = renderPlist(TEMPLATE, PATHS)

  it('accepts a plist FRIDAY wrote', () => {
    expect(isOurs(ours)).toBe(true)
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
})
