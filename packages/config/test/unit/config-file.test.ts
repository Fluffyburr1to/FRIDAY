import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type EnvSource, loadConfig } from '@friday/config'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * An environment with nothing set, pointed at a data directory that does not
 * exist.
 *
 * The empty object would be simpler and would be wrong: `loadConfig` looks for
 * `config.toml` in the data directory, and with no `FRIDAY_DATA_DIR` that is
 * the real one under `~/Library/Application Support`. These tests would then
 * pass or fail depending on whether the machine running them happens to have a
 * config file — which is the kind of flakiness that gets blamed on the test
 * runner for a week.
 */
const NO_ENV: EnvSource = {
  FRIDAY_DATA_DIR: join(tmpdir(), `friday-absent-${process.pid}`),
}

describe('the configuration file layer', () => {
  let directory: string

  /** A data directory with no config file in it, so tests stay isolated. */
  function inEmptyDataDir(): EnvSource {
    return { FRIDAY_DATA_DIR: directory }
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-config-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('ignores a file that does not exist', () => {
    // Most installations never have one, and treating absence as a failure
    // would make the zero-configuration start impossible.
    const result = loadConfig({ env: NO_ENV, configFile: join(directory, 'nope.toml') })

    expect(result.ok).toBe(true)
  })

  it('applies a TOML file over the defaults', () => {
    const path = join(directory, 'config.toml')
    writeFileSync(path, '[server]\nport = 7999\n\n[logging]\nlevel = "warn"\n')

    const result = loadConfig({ env: NO_ENV, configFile: path })

    expect(result.ok && result.value.server.port).toBe(7999)
    expect(result.ok && result.value.logging.level).toBe('warn')
  })

  it('finds config.toml in the data directory without being told to', () => {
    // ★ The behaviour that makes the file layer real. Before this, a config
    // file only loaded if something passed --config, which meant in practice
    // that nobody's config file was ever read.
    writeFileSync(join(directory, 'config.toml'), '[server]\nport = 7777\n')

    const result = loadConfig({ env: inEmptyDataDir() })

    expect(result.ok && result.value.server.port).toBe(7777)
  })

  it('keeps comments out of the way, which is why TOML was chosen', () => {
    writeFileSync(
      join(directory, 'config.toml'),
      [
        '# Why 7999: 7420 collides with something else on this machine.',
        '[server]',
        'port = 7999',
      ].join('\n'),
    )

    expect(loadConfig({ env: inEmptyDataDir() }).ok).toBe(true)
  })

  it('accepts a JSON file by extension', () => {
    // Not a second blessed format — a file written by a script or an
    // installer is JSON far more often than it is TOML.
    const path = join(directory, 'config.json')
    writeFileSync(path, JSON.stringify({ server: { port: 7999 } }))

    const result = loadConfig({ env: NO_ENV, configFile: path })

    expect(result.ok && result.value.server.port).toBe(7999)
  })

  it('lets an explicit file win over the one in the data directory', () => {
    writeFileSync(join(directory, 'config.toml'), '[server]\nport = 7777\n')

    const elsewhere = join(directory, 'other.toml')
    writeFileSync(elsewhere, '[server]\nport = 7888\n')

    const result = loadConfig({ env: inEmptyDataDir(), configFile: elsewhere })

    expect(result.ok && result.value.server.port).toBe(7888)
  })

  it('lets the environment win over the file', () => {
    const path = join(directory, 'config.toml')
    writeFileSync(path, '[server]\nport = 7999\n')

    const result = loadConfig({ env: { FRIDAY_PORT: '8123' }, configFile: path })

    expect(result.ok && result.value.server.port).toBe(8123)
  })

  it('refuses a TOML file that exists and is malformed', () => {
    // Silently ignoring it means running with settings the owner believes
    // they changed, which is worse than refusing to start.
    const path = join(directory, 'config.toml')
    writeFileSync(path, '[server\nport = ')

    const result = loadConfig({ env: NO_ENV, configFile: path })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIG_INVALID')
      expect(result.error.message).toContain('not valid TOML')
    }
  })

  it('names the line when the parser knows it', () => {
    // Most of what someone needs to fix the file, and the reason a real
    // parser was worth a dependency.
    const path = join(directory, 'config.toml')
    writeFileSync(path, '[server]\nport = 7999\nbroken = = 1\n')

    const result = loadConfig({ env: NO_ENV, configFile: path })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message.length).toBeGreaterThan('not valid TOML'.length)
  })

  it('refuses a JSON file that exists and is malformed', () => {
    const path = join(directory, 'config.json')
    writeFileSync(path, '{ not json')

    const result = loadConfig({ env: NO_ENV, configFile: path })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('not valid JSON')
  })

  it('reports a file it cannot read', () => {
    const result = loadConfig({ env: NO_ENV, configFile: directory })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('CONFIG_UNREADABLE')
  })

  it('reads nested tables the way the schema is shaped', () => {
    writeFileSync(
      join(directory, 'config.toml'),
      [
        'principalId = "usr_someone"',
        '',
        '[budgets]',
        'perAgentCents = 20',
        'perPlanCents = 90',
        '',
        '[keychain]',
        'fieldKeyRef = "a-different-key"',
      ].join('\n'),
    )

    const result = loadConfig({ env: inEmptyDataDir() })

    expect(result.ok && result.value.principalId).toBe('usr_someone')
    expect(result.ok && result.value.budgets.perPlanCents).toBe(90)
    expect(result.ok && result.value.keychain.fieldKeyRef).toBe('a-different-key')
    // Untouched groups keep their defaults rather than being erased.
    expect(result.ok && result.value.budgets.perDayCents).toBe(800)
  })
})
