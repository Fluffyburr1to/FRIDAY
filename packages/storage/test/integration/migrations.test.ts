import { randomBytes } from 'node:crypto'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage } from '@friday/storage'
import Database from 'better-sqlite3'
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
      expect(opened.value.migrationsApplied).toEqual([
        'events:0001',
        'events:0002',

        // The Guardian's tables, in events.db rather than friday.db so an
        // approval and the event recording it share one transaction. ADR-0032.
        'events:0003',

        'main:0001',

        // The plan record completed to Chapter 12, before the engine existed
        // and while these tables were still empty everywhere. ADR-0045.
        'main:0002',
      ])
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

  // ── The plan-record migration's refusal (ADR-0045 §7) ─────────────────────

  it('rebuilds the plan tables when they are empty', () => {
    const opened = open()

    expect(opened.ok).toBe(true)
    if (!opened.ok) return

    expect(opened.value.migrationsApplied).toContain('main:0002')
    opened.value.close()

    // The completed shape is there: a column that did not exist at M1.
    const db = new Database(join(directory, 'friday.db'))
    const columns = db.prepare('PRAGMA table_info(plans)').all() as { name: string }[]
    db.close()

    expect(columns.map((column) => column.name)).toContain('rationale')
  })

  it('★ refuses to run, rather than destroying plans that already exist', () => {
    // ★ This is the binding owner condition on ADR-0045, and it is the only
    // thing standing between a destructive migration and someone's data. The
    // ADR was written on the evidence that nothing had ever created a plan.
    // Where that is false, the correct behaviour is to STOP — not to proceed,
    // and not to trust a comment claiming the tables are empty.
    //
    // It is tested by making the premise false on purpose.
    const first = open()
    expect(first.ok).toBe(true)
    if (first.ok) first.value.close()

    // Wind the ledger back to before 0002 and put a plan in the M1-shaped
    // table, which is the state a machine that had used plans would be in.
    const db = new Database(join(directory, 'friday.db'))
    db.exec(`
      DELETE FROM _migrations WHERE id = '0002';
      DROP TABLE plan_steps;
      DROP TABLE plans;
      CREATE TABLE plans (
        id TEXT PRIMARY KEY, principal_id TEXT NOT NULL, intent TEXT NOT NULL,
        status TEXT NOT NULL, correlation_id TEXT NOT NULL,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, completed_at INTEGER,
        budget_tokens INTEGER, budget_cents INTEGER,
        spent_tokens INTEGER NOT NULL DEFAULT 0, spent_cents INTEGER NOT NULL DEFAULT 0
      ) STRICT;
      CREATE TABLE plan_steps (
        id TEXT PRIMARY KEY, plan_id TEXT NOT NULL REFERENCES plans (id),
        principal_id TEXT NOT NULL, sequence INTEGER NOT NULL, status TEXT NOT NULL,
        action_type TEXT NOT NULL, action_payload TEXT NOT NULL, risk_class TEXT NOT NULL,
        approval_id TEXT, agent_id TEXT, result TEXT, error TEXT,
        started_at INTEGER, completed_at INTEGER, attempt INTEGER NOT NULL DEFAULT 0,
        idempotency_key TEXT NOT NULL, UNIQUE (plan_id, sequence)
      ) STRICT;
      INSERT INTO plans (id, principal_id, intent, status, correlation_id,
                         created_at, updated_at, spent_tokens, spent_cents)
      VALUES ('plan-the-owner-cares-about', 'usr_owner', 'book the flights',
              'awaiting_approval', 'corr-1', 1, 1, 0, 0);
    `)
    db.close()

    const second = open()

    expect(second.ok).toBe(false)
    if (second.ok) second.value.close()

    // ★ And the plan is still there, in the schema it was written in. The
    // refusal has to leave the data alone to be worth anything.
    const after = new Database(join(directory, 'friday.db'))
    const row = after
      .prepare("SELECT intent FROM plans WHERE id = 'plan-the-owner-cares-about'")
      .get() as { intent: string } | undefined
    const stillMissing = (after.prepare('PRAGMA table_info(plans)').all() as { name: string }[])
      .map((column) => column.name)
      .includes('rationale')
    after.close()

    expect(row?.intent).toBe('book the flights')
    expect(stillMissing).toBe(false)
  })

  it('refuses on orphaned steps too, not only on plans', () => {
    const first = open()
    expect(first.ok).toBe(true)
    if (first.ok) first.value.close()

    const db = new Database(join(directory, 'friday.db'))
    db.exec(`
      DELETE FROM _migrations WHERE id = '0002';
      INSERT INTO plans (id, principal_id, utterance, intent, rationale, status,
                         correlation_id, created_at, updated_at, spent_tokens, spent_cents)
      VALUES ('p1', 'usr_owner', 'x', '{}', 'r', 'draft', 'c', 1, 1, 0, 0);
      INSERT INTO plan_steps (id, plan_id, principal_id, sequence, depends_on, description,
                              status, action_type, action_payload, department, risk_class,
                              on_failure, attempt, idempotency_key)
      VALUES ('s1', 'p1', 'usr_owner', 1, '[]', 'd', 'pending', 'a.b', '{}', 'operations',
              'low', 'abort', 0, 'k1');
    `)
    db.close()

    const second = open()

    expect(second.ok).toBe(false)
    if (second.ok) second.value.close()
  })
})
