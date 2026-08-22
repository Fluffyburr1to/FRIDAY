import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type EnvSource, loadConfig } from '@friday/config'
import { describe, expect, it } from 'vitest'

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

describe('loadConfig', () => {
  it('starts with no configuration at all', () => {
    // Being able to run with zero configuration is what makes the recovery
    // commands usable when the config file is itself the problem.
    const result = loadConfig({ env: NO_ENV })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.env).toBe('development')
      expect(result.value.server.port).toBe(7420)
      expect(result.value.principalId).toBe('usr_owner')
    }
  })

  it('derives the three database paths from the data directory', () => {
    const result = loadConfig({
      env: NO_ENV,
      overrides: { paths: { dataDir: '/tmp/friday-data' } },
    })

    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.value.paths.mainDb).toBe('/tmp/friday-data/friday.db')
      expect(result.value.paths.eventsDb).toBe('/tmp/friday-data/events.db')
      expect(result.value.paths.cacheDb).toBe('/tmp/friday-data/cache.db')
    }
  })

  it('lets an explicit database path win over the derived one', () => {
    const result = loadConfig({
      env: NO_ENV,
      overrides: { paths: { dataDir: '/tmp/friday-data', eventsDb: '/elsewhere/events.db' } },
    })

    expect(result.ok && result.value.paths.eventsDb).toBe('/elsewhere/events.db')
    expect(result.ok && result.value.paths.mainDb).toBe('/tmp/friday-data/friday.db')
  })

  it('applies the environment over the defaults', () => {
    const result = loadConfig({ env: { FRIDAY_ENV: 'production', FRIDAY_PORT: '8080' } })

    expect(result.ok && result.value.env).toBe('production')
    expect(result.ok && result.value.server.port).toBe(8080)
  })

  it('applies overrides over the environment', () => {
    const result = loadConfig({
      env: { FRIDAY_PORT: '8080' },
      overrides: { server: { port: 9090 } },
    })

    expect(result.ok && result.value.server.port).toBe(9090)
  })

  it('does not let an unset variable erase a default', () => {
    // The classic layered-config bug: merging `{ host: undefined }` over the
    // default and wiping it. It only shows up when a variable is NOT set.
    const result = loadConfig({ env: { FRIDAY_PORT: '8080' } })

    expect(result.ok && result.value.server.host).toBe('127.0.0.1')
  })

  it('treats an empty variable as unset', () => {
    const result = loadConfig({ env: { FRIDAY_HOST: '' } })

    expect(result.ok && result.value.server.host).toBe('127.0.0.1')
  })

  it('rejects a non-numeric port, naming the field', () => {
    const result = loadConfig({ env: { FRIDAY_PORT: 'eight thousand' } })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.code).toBe('CONFIG_INVALID')
      expect(result.error.message).toContain('server.port')
    }
  })

  it('rejects a boolean that is neither true nor false rather than guessing', () => {
    // FRIDAY_BACKUP_ENABLED=yes silently meaning "false" is how someone
    // discovers months later that nothing was ever backed up.
    const result = loadConfig({ env: { FRIDAY_BACKUP_ENABLED: 'yes' } })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('FRIDAY_BACKUP_ENABLED')
  })

  it('accepts true and false in any casing', () => {
    const result = loadConfig({ env: { FRIDAY_OTEL_ENABLED: 'TRUE' } })

    expect(result.ok && result.value.telemetry.otelEnabled).toBe(true)
  })

  it('refuses to listen on anything but loopback', () => {
    // Article IV, checked rather than trusted. Binding to 0.0.0.0 would expose
    // every plan, memory, and approval to anything on the network.
    const result = loadConfig({ env: { FRIDAY_HOST: '0.0.0.0' } })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('loopback')
  })

  it('refuses a privileged port', () => {
    expect(loadConfig({ env: { FRIDAY_PORT: '80' } }).ok).toBe(false)
  })

  it('refuses backups that are enabled with nowhere to go', () => {
    const result = loadConfig({ env: { FRIDAY_BACKUP_ENABLED: 'true', FRIDAY_BACKUP_BUCKET: '' } })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('bucket')
  })

  it('accepts backups that are enabled with a bucket', () => {
    const result = loadConfig({
      env: { FRIDAY_BACKUP_ENABLED: 'true', FRIDAY_BACKUP_BUCKET: 'friday-backups' },
    })

    expect(result.ok).toBe(true)
  })

  it('refuses a plan budget below one agent’s budget', () => {
    // It would halt every plan on its first step — a configuration that looks
    // conservative and is actually a full stop.
    const result = loadConfig({
      env: { FRIDAY_BUDGET_PER_AGENT_CENTS: '100', FRIDAY_BUDGET_PER_PLAN_CENTS: '50' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('perPlanCents')
  })

  it('★ refuses a plan-approval threshold at or above the per-plan ceiling', () => {
    // ★ Chapter 12's TRIGGER and Chapter 35's CEILING are different things,
    // and the relationship between them is load-bearing. A threshold at or
    // above the ceiling can never fire — the plan is suspended by its budget
    // first — which would silently disable the cost condition and leave plan
    // approval driven by risk alone. That is a coherent policy and it must be
    // chosen deliberately, never arrived at by two numbers in two chapters
    // quietly disagreeing.
    for (const threshold of ['50', '51', '500']) {
      const result = loadConfig({
        env: {
          FRIDAY_BUDGET_PER_PLAN_CENTS: '50',
          FRIDAY_PLAN_APPROVAL_THRESHOLD_CENTS: threshold,
        },
      })

      expect(result.ok, `a threshold of ${threshold} should be refused`).toBe(false)
      if (!result.ok) expect(result.error.message).toContain('planApprovalThresholdCents')
    }
  })

  it('accepts a plan-approval threshold below the ceiling', () => {
    const result = loadConfig({
      env: {
        FRIDAY_BUDGET_PER_PLAN_CENTS: '50',
        FRIDAY_PLAN_APPROVAL_THRESHOLD_CENTS: '25',
      },
    })

    expect(result.ok && result.value.budgets.planApprovalThresholdCents).toBe(25)
  })

  it('defaults the threshold to half the per-plan ceiling', () => {
    const result = loadConfig({ env: {} })

    expect(result.ok && result.value.budgets.planApprovalThresholdCents).toBe(25)
    expect(result.ok && result.value.budgets.perPlanCents).toBe(50)
  })

  it('refuses a daily budget below a single plan’s budget', () => {
    const result = loadConfig({
      env: { FRIDAY_BUDGET_PER_PLAN_CENTS: '900', FRIDAY_BUDGET_PER_DAY_CENTS: '800' },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.message).toContain('perDayCents')
  })

  it('reports every invalid field, not only the first', () => {
    const result = loadConfig({ env: { FRIDAY_PORT: '80', FRIDAY_ENV: 'chaos' } })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('server.port')
      expect(result.error.message).toContain('env')
    }
  })

  it('rejects a non-loopback OTLP endpoint only when it is not a URL at all', () => {
    expect(loadConfig({ env: { FRIDAY_OTEL_ENDPOINT: 'not a url' } }).ok).toBe(false)
  })

  it('never returns a secret value, only Keychain references', () => {
    // ★ The property that makes a stolen config file worthless.
    const result = loadConfig({ env: NO_ENV })

    expect(result.ok && result.value.keychain.anthropicKeyRef).toBe('anthropic-api-key')
    expect(JSON.stringify(result)).not.toContain('sk-')
  })
})
