# ADR-0010 — Departments communicate only through the event bus

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 13](../01-bible/13-department-architecture.md)

## Context

The Manifesto describes FRIDAY as an organization in which departments own responsibilities. The
Long-Term Vision lists ten domains, each of which becomes a department over years.

Article VI requires that every subsystem be replaceable without rewriting the system.

## Decision

**No department may import, call, or hold a reference to another department.** They communicate
exclusively by publishing and subscribing to events.

Where one genuinely needs a result from another, it publishes a `capability.requested` event with a
correlation ID and subscribes for the response, with a mandatory bounded timeout.

Enforced by `dependency-cruiser`. A violation fails the build.

## Constitutional review

- **Article VI (Modularity):** this rule *is* Article VI. A department can be removed, rewritten, or
  added without touching a single existing file — none of which is possible with direct calls.
- **Article VII (Reliability):** a missing department produces a clear timeout naming what was
  waited for, not a crash.

## Alternatives considered

### Direct calls with dependency injection
**Advantages.** Simpler, faster, easier to trace in a debugger, familiar to every developer.
**Why rejected.** This is the decision this ADR exists to make. Direct calls create a dependency
graph among departments, which means removal breaks things, replacement requires coordination, and
addition requires modifying existing code. Every property we want from departments comes from *not*
doing this.

### A shared service registry departments resolve from
**Advantages.** Looser than direct imports; allows swapping implementations.
**Why rejected.** Still a synchronous dependency — a department resolving a missing service must
handle absence at every call site, and in practice will not. The bus makes absence the normal case.

### Departments as separate processes
**Advantages.** Genuine fault isolation and independent restart.
**Why rejected.** Distributed debugging on a single machine buys isolation we do not need at a cost
one person cannot afford. **The design keeps the option open**: because departments already
communicate only via events and share no memory, extracting one later is a transport change.

### Departments owning their own data stores
**Advantages.** Stronger encapsulation; a true bounded context.
**Why rejected.** Fragments the owner's data across many stores, making backup, export, and "show me
everything FRIDAY knows about X" much harder — all Article I and IV concerns. Encapsulation is
achieved by namespaced permissions instead.

## Consequences

**Positive**
- Departments are genuinely independent units. Adding the tenth is as easy as adding the second.
- Every inter-department interaction is automatically audited.
- A broken department degrades its own capability and nothing else.

**Negative**
- Slower than a direct call (sub-millisecond in-process) and less obvious to trace in source.
  Mitigated by correlation IDs and the dashboard's live information-flow diagram.
- Request/response over a bus is more machinery than a function call.
- Some duplication between departments; shared helpers live in `packages/`.

## Reversibility

- **Cost to reverse:** low mechanically, high in consequence — reversing forfeits every property
  above.

## Review triggers

- A department consistently needs synchronous results from another → the boundary may be drawn wrong
- Event-based coordination measurably dominates plan latency
- More than ~15 departments → consider grouping into divisions
