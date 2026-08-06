# @friday/kernel

**FRIDAY's nervous system: the event bus and the durable log.**

Milestone: **M1**

## Charter

Records everything that happens, in order, permanently — and moves messages between components that
do not know each other exist.

The event log is simultaneously FRIDAY's message bus **and** her audit trail. They are the same
thing, which is why the audit trail cannot fall out of sync with reality: writing the event *is* how
the action happens.

## What lives here

- `EventBus` — publish, subscribe, durable dispatch
- The append-only event log, with hash chaining for tamper evidence
- Sync lane (same transaction as the event write) and async lane (per-subscriber queues)
- The scheduler, including catch-up after sleep
- Process lifecycle, graceful shutdown, Safe Mode entry
- Compaction and archival to Parquet

## What does NOT

- Any decision about whether something is *allowed* — that is `guardian`
- Any knowledge of departments, agents, or connectors
- Direct database access beyond the event log — that is `storage`

## The rules that matter

1. **Durable before dispatch.** Committed to disk before any handler is notified.
2. **Totally ordered.** Gapless sequence numbers. One authoritative history.
3. **At-least-once delivery.** Every handler must be idempotent.
4. **If the log cannot be written, FRIDAY stops.** An unrecorded action is worse than no action.
5. **Compaction may never touch** approvals, Guardian decisions, external calls, model invocations,
   or self-modification events.

Reference: [Chapter 10](../../docs/01-bible/10-event-bus.md)
