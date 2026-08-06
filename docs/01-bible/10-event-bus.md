# 10 — Event Bus Architecture

> **Governing provisions:** Constitution Article II (Transparency), Article V (Security — audit
> logs), Article VI (Modularity), Article VII (Reliability); Manifesto Principle 2 (Transparency
> Above All), Principle 7 (Explainability), Principle 9 (Fail Gracefully).

---

## In plain language

The event bus is FRIDAY's nervous system. It is how every part of her tells every other part what
just happened.

Here is the idea in one sentence: **nothing in FRIDAY calls anything else directly — instead, things
announce what they did, and whoever cares listens.**

An analogy. In most software, components work like phone calls: the calendar module calls the
notification module directly and waits for it to finish. That means the calendar module has to know
the notification module exists, has to know its phone number, and stops working if the notification
module is broken.

FRIDAY works like an intercom in a building. The calendar module announces "a meeting was added."
It does not know or care who is listening. The notification module hears it and decides whether to
tell you. The memory module hears it and files it away. The audit system hears it and writes it
down. Add a new department next year and it just starts listening — nothing existing has to change.

This gives us three things your founding documents demand, and it gives them **structurally**
rather than by anyone remembering:

- **Transparency (Article II).** Every announcement is permanently written down before anyone acts
  on it. The audit trail is not a separate system that could fall out of sync — it *is* the bus.
- **Modularity (Article VI).** Components that never call each other directly can be replaced
  independently. That is the whole of Article VI, delivered by the messaging pattern.
- **Reliability (Article VII).** A broken listener does not break the announcer. The message sits
  in a queue until the listener recovers.

---

## Recommendation

A **durable, SQLite-backed, ordered event log with in-process dispatch**, built in
`packages/kernel`, behind an `EventBus` interface that hides the implementation completely.

### The three properties that define it

**1. Durable before dispatch.** An event is written to `events.db` and committed *before* any
handler is notified. If FRIDAY crashes mid-dispatch, the event survives and is redelivered on
restart. Nothing is lost because it existed only in memory.

**2. Totally ordered.** Every event gets a gapless, monotonically increasing sequence number. There
is one authoritative order in which things happened, which is what makes replay, integrity hashing,
and causal explanation possible.

**3. At-least-once delivery with idempotent handlers.** A handler may see the same event twice
after a crash. Handlers are required to be idempotent — processing the same event twice must
produce the same result as processing it once. This is a hard requirement enforced in code review
and tested by a fault-injection suite, because the alternative (exactly-once delivery) is
famously impossible to guarantee in a distributed sense and expensive to approximate.

### Shape

```
   Publisher (any component)
        │  publish(event)
        ▼
 ┌──────────────────────────────────────────────┐
 │  1. Validate against the registered Zod       │
 │     schema for this event type                │
 │  2. Assign seq, id (UUIDv7), timestamps       │
 │  3. Compute integrity_hash from previous      │
 │  4. WRITE TO events.db — COMMIT               │  ← durable here
 └───────────────────┬──────────────────────────┘
                     │
        ┌────────────┴────────────┐
        ▼                         ▼
  ┌──────────────┐        ┌──────────────────┐
  │  SYNC LANE   │        │  ASYNC LANE      │
  │              │        │                  │
  │ Audit        │        │ Departments      │
  │ Projections  │        │ Notifications    │
  │ Plan engine  │        │ Memory ingest    │
  │              │        │ Diagnostics      │
  │ Same txn.    │        │ Own queue each.  │
  │ Must not     │        │ Retry w/ backoff │
  │ fail.        │        │ Dead-letter on   │
  │              │        │ repeated failure │
  └──────────────┘        └──────────────────┘
                                  │
                          ┌───────▼────────┐
                          │  WebSocket     │
                          │  → dashboard   │
                          │  (live view)   │
                          └────────────────┘
```

### Why two lanes

This is the design decision that makes the bus work in practice.

**The sync lane** handles subscribers whose work is part of the truth: writing the audit record,
updating the plan's state, updating projections. These run in the same database transaction as the
event write. If any of them fails, the whole thing rolls back and the event is not recorded at all.
This guarantees the audit trail and the system state can never disagree.

**The async lane** handles everything else: a department reacting, a notification going out, memory
being extracted. These get their own per-subscriber queue with retries and backoff. A failing
subscriber accumulates a backlog and eventually dead-letters; it cannot block the publisher or any
other subscriber.

A single lane would force a choice between two bad options: everything synchronous (a slow
department blocks the whole system) or everything asynchronous (the audit trail lags behind
reality, and a crash loses records the Constitution requires). Two lanes gives correctness where
correctness matters and isolation everywhere else.

---

## Event design rules

These are the rules that keep an event-driven system from becoming an unmaintainable mess. They
are enforced in review and, where possible, in code.

### 1. Events are facts, in the past tense

`plan.step.completed`, not `completePlanStep`. An event records something that already happened and
cannot be revoked. Naming them as commands invites treating the bus as a work queue, which is how
event-sourced systems get corrupted — someone publishes `sendEmail` and now the log contains
instructions rather than history.

Commands, where they exist, travel by direct call through the Guardian. The bus carries only
history.

### 2. Naming: `<domain>.<subject>.<verb-past>`

```
plan.created            approval.granted        connector.call.failed
plan.step.started       approval.expired        model.invoked
plan.completed          memory.stored           diagnostics.issue.detected
intent.received         guardian.denied         system.degraded
```

Three segments, always. Predictable naming lets subscribers use wildcards (`approval.*`) reliably.

### 3. Events carry everything a subscriber needs

A subscriber must never have to query the database to understand an event. `approval.granted`
carries the approval ID *and* the risk class, the action, and the plan it belongs to.

The reason is subtle but important: a subscriber processing a replayed event from six months ago
would query current state and get a *different answer* than existed at the time. Self-contained
events are what make replay produce the same result as the original run.

The cost is duplication — the same fields appear in the event and in tables. Accepted deliberately.

### 4. Every event type has a versioned Zod schema

Registered in `packages/contracts`. Publishing an unregistered or invalid event throws. Since AI
assistants will be adding event types, a malformed event must fail loudly at the source rather than
corrupting the log for a future reader.

### 5. Event payloads are never changed after the fact

When an event's shape needs to evolve, add `payload_version: 2` and write an **upcaster** — a small
function converting v1 payloads to v2 at read time. Historical events keep their original bytes
forever.

Rewriting history would break the integrity chain and, more fundamentally, would mean the audit
trail is editable. An editable audit trail satisfies nothing.

### 6. Sensitivity is declared on every event

Events tagged `secret` never carry raw values — they carry references. The dashboard redacts
`private` events by default. The `sensitivity` field also drives what may be exported or sent to a
cloud model.

---

## Explainability: how "why?" is answered

This is the capability that most justifies the entire design, so it is worth showing concretely.

Every event carries `causation_id` (the event that directly caused it) and `correlation_id` (the
root request it belongs to). Together they form a causal tree.

```
intent.received                 "remind Sarah about the budget"   ← root
└── plan.created                                                   3 steps
    ├── plan.step.started       step 1: find Sarah's email
    │   ├── memory.recalled     found in contacts, from Oct 3 sync
    │   └── plan.step.completed
    ├── plan.step.started       step 2: draft the message
    │   ├── model.invoked       claude-opus, 1,240 tokens, $0.019
    │   └── plan.step.completed
    └── plan.step.started       step 3: send
        ├── guardian.evaluated  → NEEDS_APPROVAL (risk: medium,
        │                          reason: irreversible external send)
        ├── approval.requested  notified you at 14:32
        ├── approval.granted    you approved at 14:41 from mobile
        ├── connector.called    gmail.send, 240ms, success
        └── plan.step.completed
```

When you ask "why did you email Sarah?", the Audit package walks this tree and composes an answer
in plain language. Every claim in that answer is backed by a recorded event with a timestamp.

**This is the difference between an explanation and a story.** Asking a language model to explain
its own past reasoning produces fluent, plausible, and frequently false accounts — models
confabulate about their own behavior with complete confidence. Principle 7 says "every
recommendation should explain what, why, confidence, alternatives, risks." Only a recorded causal
chain can do that truthfully. **The event bus is how FRIDAY keeps her promises.**

---

## Growth management

The log grows forever. This is designed for from Milestone 1, not discovered at Milestone 6.

### Three tiers

| Tier | Age | Storage | Query speed | Retention |
|---|---|---|---|---|
| **Hot** | 0–90 days | `events.db`, fully indexed | Instant | Always |
| **Warm** | 90 days–2 years | Compacted in `events.db` | Fast | Always |
| **Cold** | 2+ years | Parquet files in `archive/` | Slower, on demand | **Forever by default** |

### Compaction, and what it must never do

Compaction reduces size **without losing decisions**. It may:

- Collapse high-frequency, low-value events (health checks, cache hits) into hourly summaries
- Drop large payload bodies that are reproducible from elsewhere, keeping a reference
- Remove `cache.db`-class events entirely

It may **never** touch: any approval event, any Guardian decision, any connector call that sent data
outside the machine, any model invocation, any self-modification event, or any event in the
causation chain of one of those. Those are the audit trail the Constitution depends on, and they
are retained in full, permanently.

The retention policy is a configuration file with a schema, reviewed by you, and any change to it
is itself an audited event. **Nobody — not a department, not FRIDAY's Engineering department —
may alter retention without your approval.** That is a `critical` risk-class action.

Archived Parquet files remain queryable (DuckDB reads them directly), so "cold" means slower, not
gone.

---

## Failure handling

| Failure | Behavior |
|---|---|
| Sync subscriber throws | Transaction rolls back; event not recorded; publisher receives a typed error. Loud, immediate, correct. |
| Async subscriber throws | Retry with exponential backoff (1s → 2s → 4s … capped 5 min), 8 attempts, then dead-letter. |
| Subscriber consistently failing | Circuit opens; subscriber marked degraded; `system.degraded` published; dashboard shows it; the rest of FRIDAY continues. |
| Dead-letter queue grows | Diagnostics raises an issue; you are notified once (not per message — Article IX). |
| Crash mid-dispatch | On restart, each subscriber resumes from its last acknowledged sequence number. At-least-once redelivery; idempotent handlers absorb the duplicate. |
| Disk full | Publishing fails immediately with a typed error. FRIDAY enters Safe Mode rather than proceeding unrecorded. **She will not act if she cannot record.** |

That last row is the most important line in this chapter. **If FRIDAY cannot write the audit trail,
she stops.** Article II is not a best-effort feature that degrades under pressure — an
unrecorded action is worse than no action.

---

## Alternatives considered

### In-memory EventEmitter (Node's built-in)

**Advantages:** zero dependencies, zero latency, trivially simple, already in the runtime.

**Rejected** because it provides none of what we actually need: no durability (a crash loses
everything in flight), no ordering guarantee, no replay, no audit trail, no backpressure. It would
satisfy the *pattern* while satisfying none of the *requirements*, and Articles II and VII would
have to be implemented separately on top of it — at which point we have built this system anyway,
just less coherently.

### Redis Streams

**Advantages:** genuinely good at this — consumer groups, ordering, persistence, mature, fast.

**Rejected** because it requires running Redis as a second process on your Mac: another service to
start, monitor, secure, back up, and keep alive. Its persistence is also configurable in ways that
can silently lose data, which is unacceptable for an audit trail. And the cross-store consistency
problem returns: an event in Redis and a state change in SQLite cannot be one transaction, so a
crash between them leaves them disagreeing. SQLite-backed events give us atomicity for free.

### NATS JetStream

**Advantages:** excellent — lightweight, fast, durable, great semantics, small binary.

**Rejected for now** for the same reasons as Redis: a second process and no shared transaction. But
this is **the recommended path if FRIDAY ever spans multiple machines or processes**, which is the
one scenario where our in-process design genuinely does not stretch. The `EventBus` interface exists
precisely so that swap is possible. Documented as the M8+ option.

### Apache Kafka / RabbitMQ

**Rejected without extended deliberation.** Built for millions of messages per second across
clusters. FRIDAY will produce thousands per day. Running Kafka on a laptop for one user is a
category error.

### PostgreSQL LISTEN/NOTIFY with an outbox table

**Advantages:** very close to what we built, with true multi-process support and a real notification
mechanism.

**Rejected** only because we are on SQLite (Chapter 09). **If FRIDAY migrates to PostgreSQL, this
becomes the natural bus implementation** — same design, better multi-process support, still one
data store, still transactional. The interface makes it a contained change.

### A commercial event platform (Inngest, Trigger.dev)

**Rejected.** Cloud-hosted, meaning every internal event in FRIDAY's nervous system leaves your
machine. Direct conflict with Article IV, and a vendor dependency at the most load-bearing point in
the architecture.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Event-driven code is harder to follow.** You cannot read a call stack to see what happens next. | Accepted. Mitigated by the dashboard's live causal graph, which shows exactly this — arguably better than a call stack, since it persists. |
| **At-least-once means every handler must be idempotent.** A real discipline cost. | Accepted. Enforced in review, tested by fault injection. The alternative loses events. |
| **Building it ourselves rather than adopting NATS.** | Accepted — a few hundred lines, fully understood, zero operational burden, and swappable behind the interface. |
| **The log grows forever and compaction is real work.** | Accepted — designed from M1 with explicit rules about what may never be compacted. |
| **Writing every event to disk costs latency** (~0.1–1ms with WAL). | Accepted — negligible at FRIDAY's volume, and it is what buys durability. |
| **In-process dispatch does not span machines.** | Accepted with a documented upgrade path (NATS). |
| **Self-contained events duplicate data** between the log and tables. | Accepted — it is what makes replay correct. |

---

## Review triggers

- FRIDAY needs to span multiple processes or machines → NATS JetStream or Postgres LISTEN/NOTIFY
- Event volume exceeds ~100/second sustained
- `events.db` exceeds 5 GB after compaction
- Dead-letter queues require regular manual intervention
- A migration to PostgreSQL occurs → reimplement the bus on the outbox pattern

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
