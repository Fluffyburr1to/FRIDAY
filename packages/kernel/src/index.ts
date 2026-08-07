/**
 * @friday/kernel — the public surface.
 *
 * This is the ONLY file other packages may import from.
 *
 * ── Deliberately empty ──────────────────────────────────────────────────────
 *
 * The event bus, the append-only hash-chained event log, the sync and async
 * dispatch lanes, and the scheduler arrive at Milestone 1 (Heartbeat).
 *
 * The property to preserve when it is filled in: the event log is FRIDAY's
 * message bus AND her audit trail, and they are the same thing. If FRIDAY
 * cannot record, she does not act.
 *
 * See: README.md · docs/01-bible/39-roadmap.md
 */

export {}
