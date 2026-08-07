import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { type FridayEvent, SYSTEM_ACTOR } from '@friday/contracts'
import { createInMemoryKeyProvider, openStorage, type Storage } from '@friday/storage'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

/**
 * ★ The sync lane, and the transactional guarantee it exists to provide.
 *
 * Chapter 10: a sync subscriber's work is part of the truth. It runs in the
 * same transaction as the event write, and if it fails the whole thing rolls
 * back and the event is not recorded at all.
 *
 * That sounds severe and is the point: it is what guarantees the audit trail
 * and the system state can never disagree. A projection that could not be
 * updated means the event did not happen.
 */

const FIELD_KEY_REF = 'field-encryption-key'
const keys = createInMemoryKeyProvider({ [FIELD_KEY_REF]: randomBytes(32).toString('base64') })

const EVENT = {
  type: 'test.event.emitted',
  actor: SYSTEM_ACTOR,
  principalId: 'usr_owner',
  payload: { note: 'hello' },
  sensitivity: 'internal' as const,
}

describe('the sync lane', () => {
  let directory: string
  let storage: Storage

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'friday-sync-lane-'))

    const opened = openStorage({
      mainDbPath: join(directory, 'friday.db'),
      eventsDbPath: join(directory, 'events.db'),
      keys,
      fieldKeyReference: FIELD_KEY_REF,
    })

    if (!opened.ok) throw new Error(opened.error.message)
    storage = opened.value
  })

  afterEach(() => {
    storage.close()
    rmSync(directory, { recursive: true, force: true })
  })

  it('runs the handler with the fully recorded event', () => {
    // The handler needs the assigned sequence number and hash — otherwise a
    // projection could not record which event it was built from.
    let seen: FridayEvent | undefined

    storage.events.append({
      event: EVENT,
      onRecorded: (event) => {
        seen = event
      },
    })

    expect(seen?.seq).toBe(1)
    expect(seen?.integrityHash).toMatch(/^[0-9a-f]{64}$/)
    expect(seen?.payload).toEqual({ note: 'hello' })
  })

  it('rolls the event back when the handler throws', () => {
    const result = storage.events.append({
      event: EVENT,
      onRecorded: () => {
        throw new Error('projection is broken')
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error.code).toBe('EVENT_LOG_UNWRITABLE')

    // ★ The assertion the whole design rests on.
    expect(storage.events.count()).toBe(0)
    expect(storage.events.latestSeq()).toBe(0)
  })

  it('leaves no gap in the sequence after a rolled-back append', () => {
    // If a failed append consumed a sequence number, the log would have a hole
    // in it and every verification afterwards would report a missing event.
    storage.events.append({ event: EVENT })

    storage.events.append({
      event: EVENT,
      onRecorded: () => {
        throw new Error('nope')
      },
    })

    const third = storage.events.append({ event: EVENT })

    expect(third.ok && third.value.seq).toBe(2)
    expect(storage.events.verifyChain().ok).toBe(true)

    const verified = storage.events.verifyChain()
    expect(verified.ok && verified.value.intact).toBe(true)
  })

  it('tells the publisher why, in words it can act on', () => {
    // Chapter 10's most important line: if FRIDAY cannot record, she stops.
    // The publisher has to learn that, not discover it later.
    const result = storage.events.append({
      event: EVENT,
      onRecorded: () => {
        throw new Error('projection is broken')
      },
    })

    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error.message).toContain('did not happen')
      expect(result.error.cause).toContain('projection is broken')
    }
  })
})
