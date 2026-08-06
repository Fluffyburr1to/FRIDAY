# ADR-0004 — Event-sourced core with a SQLite-backed bus

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 10](../01-bible/10-event-bus.md), [Bible 05](../01-bible/05-backend-architecture.md)

## Context

The Constitution requires three things that are expensive to retrofit: every action observable
(Article II), failures isolated (Article VII), and every recommendation explainable (Principle 7).

Most software satisfies these by adding logging, an audit system, and an explanation feature as
separate concerns — each of which can fall out of sync with what actually happened.

## Decision

We will build **a durable, SQLite-backed, totally-ordered event log with in-process dispatch**,
behind an `EventBus` interface. Every meaningful action is written and committed **before** it is
acted upon. The event log is simultaneously the message bus and the audit trail.

Two dispatch lanes: a synchronous lane running in the same transaction as the event write (audit,
projections, plan state) and an asynchronous lane with per-subscriber queues and retries.

**If the log cannot be written, FRIDAY stops.**

## Constitutional review

- **Article II (Transparency):** the audit trail is not a separate system that could drift — it *is*
  the bus. There is no way to act without leaving a trace, because writing the event is how the
  action happens.
- **Article VII (Reliability):** event-driven components fail independently.
- **Principle 7 (Explainability):** `causationId` chains make "why?" answerable from recorded fact
  rather than from a model's account of its own past reasoning — which models confabulate fluently
  and falsely.

## Alternatives considered

### Node's built-in EventEmitter
**Advantages.** Zero dependencies, zero latency, trivially simple.
**Why rejected.** Provides none of the requirements: no durability, ordering, replay, or audit
trail. It satisfies the *pattern* while satisfying none of the *needs*.

### Redis Streams
**Advantages.** Genuinely good at this — consumer groups, ordering, persistence, mature.
**Why rejected.** A second process to run, secure, back up, and keep alive. Its persistence is
configurable in ways that can silently lose data, unacceptable for an audit trail. And a crash
between the Redis write and the SQLite state change leaves them disagreeing.

### NATS JetStream
**Advantages.** Excellent semantics, lightweight, durable, small binary.
**Why rejected for now.** Same second-process and cross-store-consistency objections. **This is the
recommended path if FRIDAY ever spans machines** — which is why the `EventBus` interface exists.

### Kafka / RabbitMQ
**Why rejected.** Built for millions of messages per second across clusters. FRIDAY will produce
thousands per day. A category error on a laptop.

### PostgreSQL LISTEN/NOTIFY with an outbox table
**Why rejected.** Only because we are on SQLite. **If FRIDAY migrates to PostgreSQL this becomes
the natural implementation** — same design, better multi-process support, still one data store.

### A commercial event platform (Inngest, Trigger.dev)
**Why rejected.** Cloud-hosted, meaning every internal event in FRIDAY's nervous system leaves the
machine. Direct conflict with Article IV, and a vendor dependency at the most load-bearing point in
the architecture.

## Consequences

**Positive**
- Transparency, auditability, and explainability are structural rather than remembered.
- A hash chain makes the trail tamper-evident; verified nightly.
- Plans survive restarts, because state is derived from a durable log.

**Negative**
- Event-sourced code is harder to reason about, and AI assistants make more mistakes with it.
  Mitigated by confining event handling to `packages/kernel`.
- At-least-once delivery means every handler must be idempotent — a real, permanent discipline cost.
- The log grows forever; compaction is designed in from M1 with strict rules about what may never
  be compacted.
- Writing before acting costs ~0.1–1 ms per action.

## Reversibility

- **Cost to reverse:** high
- **How:** Not realistically reversed. The bus *implementation* is swappable behind the interface;
  the event-sourced *approach* is foundational.
- **Point of no return:** Milestone 1.

## Review triggers

- FRIDAY needs to span processes or machines → NATS JetStream or Postgres LISTEN/NOTIFY
- Event volume exceeds ~100/second sustained
- `events.db` exceeds 5 GB after compaction
- Dead-letter queues require regular manual intervention
