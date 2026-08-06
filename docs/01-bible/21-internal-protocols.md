# 21 — Internal Communication Protocols

> **Governing provisions:** Constitution Article II (Transparency), Article VI (Modularity), Article
> VII (Reliability); Manifesto Principle 5 (Modularity), Principle 9 (Fail Gracefully).

---

## In plain language

The previous chapter covered how outside software talks to FRIDAY. This one covers how FRIDAY's
parts talk to each other.

There are exactly **four** ways, and the rule is that a component may only use the one that matches
its situation. This is a deliberately short list. The most common way an architecture rots is that
components gradually invent new ways to reach each other — a direct import here, a shared global
there, a database table used as a message queue — until nothing can be changed without breaking
something unexpected.

Four channels, each with a stated purpose, each enforced:

1. **Events** — "this happened" (broadcast, one way, permanent record)
2. **Commands** — "do this" (directed, mediated by the Guardian)
3. **Queries** — "tell me" (direct, read-only, no side effects)
4. **Streams** — "keep telling me" (continuous, to interfaces)

---

## The four channels

### 1. Events — the default

**Use for:** anything that has already happened and might interest more than one component.

```
Publisher                 Bus (durable)            Subscribers
   │ publish  ─────────────►  write, commit  ────────► 0..n
   │ does not know who listens · does not wait · cannot fail
```

| Property | Value |
|---|---|
| Direction | One-way broadcast |
| Coupling | **None** — publisher does not know subscribers exist |
| Durability | Written to `events.db` before dispatch |
| Ordering | Total, by sequence number |
| Delivery | At-least-once; handlers must be idempotent |
| Failure | A failing subscriber cannot affect the publisher |
| Audit | Automatic — this *is* the audit trail |

**This is the default channel.** If a component is unsure which to use, the answer is events. Full
design in [Chapter 10](10-event-bus.md).

### 2. Commands — the mediated channel

**Use for:** asking the kernel to *do* something with an effect.

```
Requester ──► Kernel ──► Guardian ──► ALLOW / DENY / NEEDS_APPROVAL
                            │
                            ▼ (if allowed)
                    Execute · record · return typed Result
```

| Property | Value |
|---|---|
| Direction | Directed, with a response |
| Authorization | **Always through the Guardian. No exceptions.** |
| Recording | The request, the decision, and the outcome are all events |
| Failure | Typed `Result`, never a thrown exception for expected failures |
| Idempotency | Required, or an idempotency key must be supplied |

**Agents and departments never execute commands themselves — they request them.** This is the
structural basis of the entire safety model ([Chapter 11](11-agent-framework.md)). A command is a
request that the kernel may refuse.

### 3. Queries — the read channel

**Use for:** reading data with no side effects.

| Property | Value |
|---|---|
| Direction | Direct call, synchronous |
| Side effects | **None.** A query that writes is a bug. |
| Authorization | Capability-checked; results filtered by permission *in the query*, not after |
| Recording | Not individually recorded — too high-volume and too low-value |

Queries are the one channel permitted as a direct in-process call, because they are read-only and
cannot cause anything. The permission filter must be applied **within** the query rather than to its
results, so a caller cannot infer the existence of records it may not see from a count.

### 4. Streams — the live channel

**Use for:** pushing continuous updates to an interface.

WebSocket, one connection per client, multiplexed by topic. Subscriptions are permission-filtered at
subscribe time and re-checked on each message. Events tagged `private` or above are redacted unless
the client is authenticated for them.

Streams carry no authority — a client cannot cause anything by subscribing.

---

## Choosing a channel

```
Has it already happened?           ──► EVENT
Do you want something to happen?   ──► COMMAND
Do you need to know something?     ──► QUERY
Do you need continuous updates?    ──► STREAM
```

**Forbidden patterns**, each of which will be attempted eventually and each of which is blocked:

| Anti-pattern | Why it is forbidden |
|---|---|
| Command sent as an event (`sendEmail` on the bus) | The bus is history. Commands on the bus bypass the Guardian and corrupt the audit trail's meaning. |
| Query implemented as a command | Adds authorization overhead and audit noise to a read. |
| Direct import between departments | Breaks Article VI. Blocked by `dependency-cruiser`. |
| A database table used as a message queue | Invisible to the audit trail; no ordering guarantees; no delivery semantics. |
| Shared mutable global state | Impossible to trace, impossible to test, impossible to reason about across restarts. |
| Blocking synchronous calls between departments | Creates a coupling that makes removal impossible. Use request/response over the bus. |

---

## Message envelope

Every message on every channel carries the same envelope. Uniformity is what makes tracing possible
across channel boundaries.

```
├── id              UUIDv7
├── type            'plan.step.completed' | 'connector.execute' | ...
├── timestamp
├── actor           { type, id }              ← who is asking
├── principalId                                ← whose data
├── correlationId   the root request
├── causationId     the message that caused this one
├── traceId         OpenTelemetry linkage
├── sensitivity     public | internal | private | secret
├── payload         validated against a versioned Zod schema
└── payloadVersion
```

`correlationId` and `causationId` on **every** message, not just events, is what allows the audit
system to reconstruct a causal chain that crosses channels — an event triggered a command which
produced a query which fed a stream. Without a uniform envelope, that chain breaks at each boundary
and "why?" becomes unanswerable ([Chapter 10](10-event-bus.md)).

---

## Request/response over the bus

Departments cannot call each other ([Chapter 13](13-department-architecture.md)). When one genuinely
needs a result from another:

```
Dept A  ──► publish  capability.requested { correlationId, capability, input, timeoutMs }
Dept B  ──► subscribed to it; performs the work
Dept B  ──► publish  capability.responded  { correlationId, result }
Dept A  ──► receives it, or times out with a clear reason
```

**Timeout is mandatory and bounded** (default 30s). If department B is absent, disabled, or broken, A
receives a typed timeout naming what it was waiting for — not a hang, and not a crash. Article VII:
failures are predictable and understandable.

This is slower than a direct call and fully audited. Both are the point.

---

## Backpressure

Every queue is bounded. Unbounded queues do not fail — they consume memory until the process dies,
which is the worst possible failure mode because it takes everything down at once and leaves no
useful diagnostic.

| Queue | Bound | On overflow |
|---|---|---|
| Event dispatch (per subscriber) | 10,000 | Oldest to dead-letter; `system.degraded` published |
| Command execution | 100 concurrent | Reject with `SYSTEM_BUSY`; caller retries with backoff |
| Agent invocations | 10 concurrent | Queue, then reject with a clear reason |
| Stream (per client) | 1,000 | Drop oldest; client told it missed messages and should refetch |

That last row matters for honesty: a client that silently missed events would display a stale view
while appearing current. Telling it explicitly is Article II applied to the plumbing.

---

## Alternatives considered

### One channel for everything (events only)

**Advantages:** maximum uniformity; one mechanism to learn; everything audited identically.

**Rejected** because commands genuinely need a response and an authorization decision, and forcing
them through a one-way broadcast means inventing correlation and response-matching on top — which is
just a worse version of having a command channel. It would also either make every query an audited
event (enormous noise) or create an undocumented back channel.

### Direct method calls throughout (dependency injection)

**Advantages:** simplest, fastest, most familiar, easiest to trace in a debugger.

**Rejected** — it is the pattern this chapter exists to prevent. Direct calls between departments
create the coupling that makes Article VI impossible.

### A message broker with formal routing (AMQP semantics)

**Advantages:** rich routing, well-specified delivery guarantees, mature tooling.

**Rejected** as disproportionate — a broker process for in-process communication on one machine.
Revisit only if FRIDAY spans processes ([Chapter 10](10-event-bus.md)).

### CQRS with fully separate read and write models

**Advantages:** philosophically clean; excellent for high-scale systems; a natural fit with event
sourcing.

**Partially adopted.** We separate commands from queries, which is the valuable part. We do *not*
maintain fully separate read models with eventual consistency, because the complexity is
substantial and the scale does not require it. Queries read projections updated in the same
transaction as the event — strongly consistent, much simpler. Principle 10.

### Actor model with formal mailboxes

**Rejected** as a framework ([Chapter 11](11-agent-framework.md)), though agents borrow the pattern:
no shared memory, message-based communication.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Four channels means learning four rules.** | Accepted — mitigated by a clear decision tree and enforcement. Fewer than four would force a bad fit somewhere. |
| **Request/response over the bus is slower** than a direct call. | Accepted — sub-millisecond in-process, and it is what makes departments independently removable. |
| **The uniform envelope adds overhead** to every message. | Accepted — it is what makes cross-channel causal tracing work. |
| **Bounded queues mean work is sometimes rejected.** | Accepted — explicit rejection is far better than silent memory exhaustion. |
| **Idempotency required on all commands** is a real discipline burden. | Accepted — the alternative is duplicate emails after a crash. |
| **Not full CQRS** means read and write models are coupled. | Accepted for simplicity; separable later if scale demands it. |

---

## Review triggers

- FRIDAY spans multiple processes → the transport for all four channels must be re-examined
- Any component needs a fifth communication pattern → either the four are wrong, or the component is
- Backpressure rejections become routine → capacity or design problem
- Cross-channel tracing breaks in practice → the envelope is insufficient

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
