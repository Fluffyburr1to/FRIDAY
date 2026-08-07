import { existsSync } from 'node:fs'
import { openEventsReadOnly } from '@friday/storage'
import type { CommandContext } from '../context.js'
import { EXIT, type ExitCode } from '../output.js'

/**
 * `friday verify` — check the audit hash chain.
 *
 * This is the command that makes the whole audit-trail argument checkable
 * rather than merely asserted. It recomputes every hash from the bytes on
 * disk, so a clean result is a statement about the file, not about the code
 * path that wrote it.
 *
 * It exits non-zero on a break, so a nightly check can be a cron line rather
 * than something someone has to read.
 *
 * Reference: docs/01-bible/09-database-design.md · Chapter 34
 */
export function runVerify(input: { context: CommandContext; fromSeq: number }): ExitCode {
  const { context, fromSeq } = input
  const { config, out } = context

  if (!existsSync(config.paths.eventsDb)) {
    out.line('There is no event log to verify — FRIDAY has not run yet.')
    out.json({ intact: null, reason: 'no event log' })
    return EXIT.ok
  }

  const reader = openEventsReadOnly({
    eventsDbPath: config.paths.eventsDb,
    keys: context.keys,
    fieldKeyReference: config.keychain.fieldKeyRef,
  })

  if (!reader.ok) {
    out.problem(reader.error.message)
    return EXIT.problem
  }

  try {
    const verified = reader.value.events.verifyChain({ fromSeq })

    if (!verified.ok) {
      out.problem(verified.error.message)
      out.json({ problem: verified.error })
      return EXIT.problem
    }

    const result = verified.value
    out.json(result)

    if (result.intact) {
      out.line(
        result.eventsChecked === 0
          ? 'Nothing to check — the log is empty.'
          : `The record is intact. ${result.eventsChecked} events checked, ${result.fromSeq} to ${result.toSeq}.`,
      )
      return EXIT.ok
    }

    // Deliberately blunt. A broken chain means something changed the log
    // outside FRIDAY — corruption, a bug, or someone editing the file — and
    // the owner needs to know without having to interpret anything.
    out.problem('★ THE RECORD HAS BEEN BROKEN.')
    out.problem('')
    out.problem(`  ${result.reason}`)

    // Only say what still verifies when something does. "Everything up to
    // event 0 still verifies" is technically true and reads as a bug.
    if (result.brokenAtSeq !== null && result.brokenAtSeq > 1) {
      out.problem(`  Everything up to event ${result.brokenAtSeq - 1} still verifies.`)
    }

    out.problem('')
    out.problem('  Nothing has been changed. Restore from a backup before FRIDAY records anything')
    out.problem('  further, or the break will be buried under new events.')

    return EXIT.problem
  } finally {
    reader.value.close()
  }
}
