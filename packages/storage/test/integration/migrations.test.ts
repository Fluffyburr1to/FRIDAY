import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * Migrations: forward-only, snapshotted, and idempotent.
 *
 * Forward-only is only safe because of the snapshot. Recovery from a bad
 * migration is restore-from-snapshot, and a runner that migrated without one
 * would turn "we can always go back" into a claim with nothing behind it.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

describe('migrations', () => {
  let directory: string

  function open() {
    return openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })
  }

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-migrations-'))
  })

  afterEach(() => {
    rmSync(directory, { recursive: true, force: true })
  })

  it('creates both databases on first open', () => {
    const opened = open()

    expect(opened.ok).toBe(true)
    if (opened.ok) {
      expect(opened.value.migrationsApplied).toEqual(['events:0001', 'main:0001'])
      opened.value.close()
    }

    expect(existsSync(join(directory, 'events.db'))).toBe(true)
    expect(existsSync(join(directory, 'friday.db'))).toBe(true)
  })

  it('applies nothing on a second open', () => {
    const first = open()
    expect(first.ok).toBe(true)
    if (first.ok) first.value.close()

    const second = open()

    expect(second.ok && second.value.migrationsApplied).toEqual([])
    if (second.ok) second.value.close()
  })

  it('takes no snapshot when there is no database to lose', () => {
    // A first run has nothing to snapshot, and creating an empty one would
    // only add noise to the data directory on every fresh install.
    const opened = open()
    if (opened.ok) opened.value.close()

    expect(readdirSync(directory).filter((name) => name.endsWith('.snapshot'))).toEqual([])
  })

  it('preserves data across a reopen', () => {
    const first = open()
    expect(first.ok).toBe(true)
    if (!first.ok) return

    first.value.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: 'survives' },
        sensitivity: 'internal',
      },
    })
    first.value.close()

    const second = open()

    expect(second.ok && second.value.events.count()).toBe(1)
    expect(second.ok && second.value.events.latestSeq()).toBe(1)
    if (second.ok) second.value.close()
  })

  it('continues the chain across a restart', () => {
    // ★ The property that makes the log an audit trail rather than a buffer:
    // the chain does not restart when the process does.
    const first = open()
    expect(first.ok).toBe(true)
    if (!first.ok) return

    for (const note of ['a', 'b']) {
      first.value.events.append({
        event: {
          type: 'test.event.emitted',
          actor: SYSTEM_ACTOR,
          principalId: 'usr_owner',
          payload: { note },
          sensitivity: 'internal',
        },
      })
    }
    first.value.close()

    const second = open()
    expect(second.ok).toBe(true)
    if (!second.ok) return

    second.value.events.append({
      event: {
        type: 'test.event.emitted',
        actor: SYSTEM_ACTOR,
        principalId: 'usr_owner',
        payload: { note: 'c' },
        sensitivity: 'internal',
      },
    })

    const verified = second.value.events.verifyChain()
    expect(verified.ok && verified.value.intact).toBe(true)
    second.value.close()
  })

  it('reports a database it cannot open rather than throwing', () => {
    // A database that will not open is exactly when the CLI's recovery
    // commands have to keep working, and they cannot if opening throws.
    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: directory,
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    expect(opened.ok).toBe(false)
    if (!opened.ok) expect(opened.error.code).toBe('STORAGE_UNAVAILABLE')
  })
})
