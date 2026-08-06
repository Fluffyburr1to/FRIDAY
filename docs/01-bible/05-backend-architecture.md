# 05 — Backend Architecture

> **Governing provisions:** Constitution Articles II (Transparency), III (Approval), V (Security),
> VI (Modularity), VII (Reliability); Manifesto Principles 1, 2, 6, 9.

---

## In plain language

The "backend" is FRIDAY herself — the part that runs quietly on your Mac, thinks, remembers, and
does things. The apps on your screen are windows into it. If every window were closed, FRIDAY would
still be running.

The important question is not *what* the backend does, but **what shape it has**, because the shape
determines what is possible and what is forbidden forever after.

I have chosen a shape called a **modular monolith with an event-sourced core**. In ordinary words:

- **One program, not twenty.** Everything runs inside a single process on your Mac. This is the
  "monolith" part, and it is a deliberate rejection of the fashionable alternative.
- **Rigorously divided inside.** That one program is built from strictly separated modules that
  cannot reach into each other's internals. This is the "modular" part, and it is what makes
  Article VI real.
- **Everything is written down before it happens.** Every meaningful action is recorded as an
  immutable event *first*, and only then acted upon. This is the "event-sourced" part, and it is
  what makes Articles II and III possible rather than aspirational.

The reason this shape matters: **it gives us the transparency guarantees of a heavily instrumented
system without the operational burden of a distributed one.** You get a complete, tamper-evident
record of everything FRIDAY has ever done, and you get it from one process you can restart by
closing a window.

---

## The layered model

FRIDAY's core is organized in five layers. Dependencies point downward only — a lower layer never
knows a higher one exists. This is what allows any layer to be replaced.

```
┌────────────────────────────────────────────────────────────────┐
│  L5  SURFACE          tRPC API · WebSocket stream · CLI        │
│      Translates outside requests into internal intents          │
├────────────────────────────────────────────────────────────────┤
│  L4  ORCHESTRATION    Chief of Staff · Plan Engine · Scheduler │
│      Decides what should happen and in what order               │
├────────────────────────────────────────────────────────────────┤
│  L3  EXECUTION        Departments · Agents · Connectors        │
│      Does the work                                              │
├────────────────────────────────────────────────────────────────┤
│  L2  MEDIATION        ★ Guardian · Model Router · Plugin Host  │
│      Decides whether the work is permitted, and by what means   │
├────────────────────────────────────────────────────────────────┤
│  L1  KERNEL           Event Bus · Durable Log · Lifecycle       │
│      Records everything and moves messages                      │
├────────────────────────────────────────────────────────────────┤
│  L0  FOUNDATION       Storage · Memory · Telemetry · Config     │
│      Persistence and instrumentation                            │
└────────────────────────────────────────────────────────────────┘
```

The layer that deserves attention is **L2, Mediation**, because it does not exist in most systems.

In a conventional application, the code that decides to do something also does it. Here, those are
separated by an enforced boundary. L3 can *want* to send an email; only L2 can *permit* it, and
only the kernel can *perform* it. An agent has no network access, no filesystem access, and no
credentials. It has a mailbox.

This single structural fact is what makes Article III enforceable rather than hopeful. You cannot
forget to check permissions in a system where the code that would forget has no ability to act.

---

## The request lifecycle

This is the most important diagram in the Bible. Every single thing FRIDAY does follows this path,
without exception.

```
  1. INTENT ARRIVES
     You speak, type, or a schedule fires.
     → Validated against a Zod contract at the boundary.
     → Recorded:  intent.received
                       │
  2. PLAN CREATED
     Chief of Staff decomposes the intent into ordered steps.
     Each step declares: what it does, what it touches, its risk class.
     → Recorded:  plan.created          ← the plan is now durable
                       │                   it survives a restart
  3. STEP DISPATCHED
     → Recorded:  plan.step.started
                       │
  4. GUARDIAN DECIDES
     Given: actor, action, resource, risk class, standing grants
     Returns exactly one of:
        ALLOW          → proceed
        DENY           → step fails with a stated reason
        NEEDS_APPROVAL → ─────────────────────────┐
                       │                          │
  5. APPROVAL (only if needed)                    │
     Plan SUSPENDS. Not blocks a thread —         │
     it stops existing in memory and              │
     persists as a row. Can wait days.            │
     → Recorded:  approval.requested              │
     → You are notified with a full explanation   │
     → You answer. → approval.granted / denied ───┘
                       │
  6. EXECUTION
     Agent runs inside the runtime sandbox.
     Every external call — model or connector — is
     mediated, budgeted, and recorded.
     → Recorded:  agent.invoked, model.called,
                  connector.called, ...
                       │
  7. RESULT
     → Recorded:  plan.step.completed | plan.step.failed
     Failure does not kill the plan. The plan decides:
     retry, take an alternate path, or ask you.
                       │
  8. EXPLANATION
     Once the plan finishes, the Audit package walks
     the causal chain and composes a human-readable
     account: what happened, why, what it cost,
     what alternatives existed, what it was unsure about.
     → Recorded:  plan.completed
     → Available forever in the dashboard.
```

Two properties of this lifecycle are worth stating explicitly, because they are the whole point:

**The plan is data, not a running function.** A plan is a row in the database with a state machine
attached. This is why it can wait three days for your approval, survive your Mac rebooting, and be
inspected mid-flight. A plan implemented as a long-running function would lose all three
properties, and Article III would be reduced to a modal dialog that blocks a thread.

**The explanation is derived, not narrated.** When FRIDAY tells you why she did something, she is
not asking an AI model to recall its reasoning — models confabulate about their own past behavior,
confidently and plausibly. She is reading the recorded causal chain: this event caused that event,
which invoked this agent, which called this model with this prompt, which returned this. Principle 7
demands explanations that are *true*, and the only reliable source of truth about the past is a
record made at the time.

---

## Process architecture

FRIDAY runs as **one primary process** with a small number of isolated child processes.

```
                    ┌──────────────────────────────────┐
                    │  friday-core   (Node.js)         │
                    │                                  │
                    │  Kernel · Guardian · Chief of    │
                    │  Staff · Departments · Storage   │
                    │  · Telemetry · HTTP/WS server    │
                    └───┬──────────┬───────────┬───────┘
                        │          │           │
          worker threads│          │child proc │child proc
                        │          │           │
              ┌─────────▼──┐  ┌────▼──────┐ ┌──▼─────────┐
              │ Agent      │  │ Speech    │ │ Local model│
              │ sandboxes  │  │ (whisper, │ │ (Ollama)   │
              │            │  │  piper)   │ │            │
              └────────────┘  └───────────┘ └────────────┘
                 isolated,      sealed,        sealed,
                 no network     no network     localhost only
```

### Why one process and not microservices

This is the decision most likely to be questioned by anyone with cloud-architecture instincts, so I
want to make the argument fully.

Microservices exist to solve two problems: **independent scaling** (this component needs forty
machines, that one needs two) and **independent deployment by separate teams** (payments ships
without coordinating with search). FRIDAY has neither problem. One user, one machine, one person
making all the changes.

What microservices *cost* is severe here:

- **Debugging becomes distributed tracing.** A bug that spans three services requires correlating
  three logs across three processes. For one person diagnosing an intermittent issue at 11pm, this
  is the difference between fixing it and giving up.
- **Every internal call becomes a network call** that can fail, time out, or partially succeed.
  Each one needs retry logic, circuit breaking, and idempotency handling. This is a large amount of
  code that exists solely to compensate for a decomposition we chose voluntarily.
- **Transactions stop being possible.** Right now, recording an event and updating state is one
  atomic database transaction — it either fully happens or fully does not. Across services, that
  becomes a saga with compensating actions, which is where correctness goes to die.
- **Operational load multiplies.** Seven services means seven things to start, monitor, update, and
  keep alive on a laptop.

Article VII asks for reliability. **On a single machine, fewer moving parts is more reliable, not
less.** Microservice resilience patterns protect against *machine* failures; when everything runs
on one Mac, the machine is the failure domain, and splitting the software across seven processes on
it adds failure modes without removing any.

The modularity Article VI requires is delivered by enforced module boundaries (Chapter 03), not by
network boundaries. And critically: **because those boundaries are enforced, extracting a service
later is possible.** A module that already communicates only through the event bus and a declared
interface can be moved to its own process without rewriting its callers. We keep the option and
decline to pay for it now.

### Why agents get their own isolation

The exception to "one process" is agents, and the reason is trust.

Agents run behavior driven by AI-generated plans and, eventually, third-party plugin code. They are
the least trustworthy component in the system. Running them in **worker threads with no network
access, no filesystem access, and no ambient credentials** means a misbehaving or compromised agent
can do exactly one thing: send a message asking the kernel to do something, which the Guardian will
evaluate.

This is least privilege (Article V) implemented as process architecture rather than as policy.
Details in [Chapter 11](11-agent-framework.md).

### Why speech and local models are sealed child processes

These are the C++/Python exception noted in Chapter 02. They run as separate processes speaking a
documented protocol over a local socket. Three benefits: a crash in native code cannot take down
FRIDAY; the non-TypeScript exception cannot leak into the codebase; and they can be swapped for
different implementations without touching FRIDAY's code.

---

## State management

FRIDAY holds four distinct kinds of state, and confusing them is a classic architectural failure.

| Kind | Lives in | Survives restart | Authority |
|---|---|---|---|
| **Event log** | SQLite, append-only | Yes, forever | **The source of truth** |
| **Projections** | SQLite tables | Yes, but rebuildable | Derived; can be regenerated from the log |
| **Plan state** | SQLite | Yes | Derived from the log, kept current for speed |
| **Working state** | Memory | No | Caches and connections only. Never authoritative. |

The rule: **anything in memory must be reconstructible from disk.** If FRIDAY is killed
mid-operation, restarting rebuilds the world from the event log and resumes suspended plans. No
information exists only in RAM.

This is what makes an "always-on-ish" laptop viable as the host. Your Mac closing its lid is not a
failure mode requiring recovery — it is a pause. Plans suspend; on wake, the scheduler notices
missed work and catches up. That behavior has to be designed in from the start, and it is the
direct architectural answer to the host-machine risk named in Chapter 01.

### Event sourcing, honestly

Full treatment in [Chapter 10](10-event-bus.md), but the shape:

We use event sourcing for **decisions and actions**, not for everything. The event log is the
authority for what FRIDAY *did* and *why*. Ordinary reference data — your settings, a cached
calendar, a connector's tokens — lives in normal database tables.

This is a pragmatic middle path and I want to be clear that it is a compromise. Pure event sourcing
would derive every table from the log; it is elegant and it is a great deal of machinery. The hybrid
gives us the auditability the Constitution requires exactly where the Constitution requires it, and
uses boring tables everywhere else. Principle 10.

---

## Failure model

Article VII is specific: detect quickly, communicate clearly, isolate, keep operating. The
architecture implements this at four levels.

**1. Typed errors, not exceptions.** Operations that can fail return an explicit `Result` value
that is either success or a typed failure. The compiler forces the caller to handle both. Thrown
exceptions are reserved for genuine bugs — states that should be impossible. This means a failed
connector call is an ordinary, handled outcome rather than something that unwinds the stack and
takes unrelated work with it.

**2. Bulkheads.** Each department, each connector, and each agent has its own budget: concurrency
limit, timeout, memory ceiling, and spend ceiling. A department stuck in a loop exhausts its own
budget and stops. It cannot starve the others. Named for ship compartments, and for the same
reason.

**3. Circuit breakers on every external dependency.** A connector failing repeatedly is marked
degraded and stops being called for a cooling-off period. FRIDAY reports "Calendar is unavailable,
retrying in 5 minutes" and keeps doing everything else. Article VII's "continue operating
gracefully," made mechanical.

**4. Graceful degradation, declared in advance.** Every department declares what it can still do
when a dependency is down. FRIDAY never simply stops; she narrows and says so.

**5. Safe Mode.** If the kernel cannot start cleanly — corrupt database, bad config, failing
migration — FRIDAY boots into Safe Mode: kernel and dashboard only, no agents, no connectors, no
autonomous action. You get a working interface that explains what is wrong and offers repair
options. This is what prevents a bad state from becoming an unrecoverable one, and it is why
[Chapter 34](34-disaster-recovery.md) exists.

---

## Alternatives considered

### Microservices from the start

Addressed at length above. **Rejected**: solves scaling and team-coordination problems that do not
exist here, at a cost in debugging difficulty and operational burden that lands entirely on one
person.

### A traditional layered monolith (controllers → services → repositories)

The industry default, and genuinely good for CRUD applications.

**Rejected** because it has no answer for FRIDAY's hard requirements. Where does the audit trail
come from? Where does approval suspension live? How does a plan survive a restart? In a layered
monolith, each of those is bolted on, and each bolt is a place where a future contributor forgets.
Event sourcing makes them structural.

### Actor model (Akka-style, or Node equivalents)

Each agent as an independent actor with its own mailbox and state. Philosophically a beautiful fit
for the organization metaphor.

**Rejected** as the *primary* structure because the mature actor frameworks live on the JVM and
.NET, and the JavaScript options are immature. We have taken the useful parts anyway — agents have
mailboxes, agents do not share memory, agents communicate by message — without adopting a framework
whose abandonment would be our problem.

### A workflow engine (Temporal, Restate, Inngest)

This is the closest call in the chapter and deserves an honest hearing, because these tools solve
*exactly* the durable-execution problem the Plan Engine solves: functions that survive restarts,
wait days for external input, and retry safely.

Temporal in particular would give us durable plans essentially for free, and it is excellent
software.

**Rejected** for three reasons. First, Temporal requires a server, a database of its own, and
meaningful operational complexity — a large addition to a system meant to run on a laptop. Second,
it would become a foundational dependency that is difficult to remove, which Article VI disfavors
for something this load-bearing. Third, and most importantly: our durability requirement is
genuinely modest — a few hundred plans a day, one user — and it is served by a state machine over
a database table, in a few hundred lines we fully understand.

**This is a real trade-off and I want it on the record.** We are choosing to build a small version
of something excellent rather than depend on the excellent thing. If plan orchestration becomes
substantially more complex than anticipated — parallel branches, complex compensation, long fan-out
— reconsider Temporal or Restate at Milestone 6. This is written into the review triggers below.

### Serverless (AWS Lambda and friends)

**Rejected immediately.** Wrong shape entirely: no persistent process to hold state, cold starts
that ruin voice latency, all data in a vendor's cloud in direct tension with Article IV, and cost
that scales with use rather than staying flat.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Event sourcing is harder to learn** than plain CRUD. AI assistants make more mistakes with it. | Accepted — mitigated by keeping event handling inside `packages/kernel` so most code never touches it directly. |
| **The event log grows forever.** | Accepted — compaction and archival designed in from M1 ([Chapter 10](10-event-bus.md)), not retrofitted. |
| **A single process is a single failure domain.** A crash takes everything down. | Accepted — the machine is the failure domain anyway. Mitigated by process supervision (launchd restarts within seconds) and full state recovery from disk. |
| **We are hand-building durable execution** that a mature tool provides. | Accepted with a documented reconsideration trigger. The scope is small and the understanding is total. |
| **Node's single thread means CPU-heavy work must be moved off it.** | Accepted — designed for from day one via worker threads and sealed sidecars. |
| **Extracting a service later is real work,** even with good boundaries. | Accepted — it is a smaller cost than paying for distribution now and forever. |

---

## Review triggers

- Plan orchestration requires parallel branches with complex compensation → reconsider Temporal
- Any single subsystem consistently consumes more than 40% of process CPU → extract to a sidecar
- The event log exceeds 5 GB after compaction → revisit the storage strategy
- FRIDAY needs to serve more than five concurrent human users → the single-process assumption is
  no longer safe
- Cold start exceeds 10 seconds → revisit projection rebuild strategy

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
