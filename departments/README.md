# departments/ — FRIDAY's Organizational Units

> "FRIDAY is an organization. Not a monolith. FRIDAY is the General. The Chief of Staff coordinates
> execution. **Departments own responsibilities.**"
> — [The Manifesto](../docs/00-foundation/manifesto.md)

A department is an area of responsibility: Communications owns messaging, Engineering owns FRIDAY's
own code, Home owns your physical environment.

**Departments are how FRIDAY grows.** The Long-Term Vision lists ten domains; each becomes a
department. Adding the tenth is exactly as easy as adding the second, because the kernel does not
know what departments exist.

---

## The rule that makes this work

> **Departments never talk to each other directly.**

If Communications needs something from Calendar, it publishes an event and waits. It does not
import, call, or hold a reference.

This feels inefficient. It buys three things worth far more than the microseconds:

- **A department can be removed and nothing breaks.** What depended on it degrades gracefully,
  because it was never holding a reference.
- **A department can be rewritten** without touching anything else.
- **A department can be added** without modifying a single existing file.

That is Article VI — *"every subsystem should be replaceable without requiring the entire system to
be rewritten"* — implemented as a communication rule rather than an aspiration.

---

## Boundary rules

Enforced by `dependency-cruiser`. Violating one fails the build.

| # | Rule |
|---|---|
| 1 | **No department imports another department.** Events only. |
| 2 | **No department touches the database.** All persistence via `packages/storage`. |
| 3 | **No department calls a connector it did not declare** in its manifest. |
| 4 | **No department implements authorization.** The Guardian is the only authority. |
| 5 | **No department publishes an undeclared event.** |
| 6 | **A department's internals are private.** Only `index.ts` is importable. |

**The escape hatch for rule 1**, so nobody invents a worse one: publish a `capability.requested`
event with a correlation ID and subscribe for the response. Request/response *over* the bus. Slower,
fully audited, and it times out with a clear reason when the other department is absent — rather
than throwing `module not found`.

---

## Anatomy

```
departments/<name>/
├── README.md           charter — what it owns and explicitly does NOT
├── department.json     ★ the manifest — the contract with the kernel
├── package.json        @friday/dept-<name>
└── src/
    ├── index.ts        register() — the only export
    ├── agents/         the specialists this department employs
    ├── policies/       department-specific rules the Guardian evaluates
    ├── handlers/       event subscriptions
    └── prompts/        versioned prompt templates — these are SOURCE CODE
```

The manifest declares capabilities, required and optional connectors, subscribed and published
events, permissions, and — **required** — a `degradedMode` stating what the department can still do
when its dependencies are down. Article VII made concrete at design time rather than during an
incident.

`prompts/` being version-controlled source is deliberate. Prompts determine behavior as much as code
does. They are reviewed, diffed, and tested.

---

## The catalogue

Order reflects dependency and risk, not enthusiasm.

| Department | Owns | Milestone |
|---|---|---|
| **operations** | System health, backups, maintenance | M3 — first department, zero external risk |
| **knowledge** | Notes, documents, research, recall | M5 |
| **engineering** | FRIDAY's own code and improvements | M6 |
| **productivity** | Calendar, tasks, scheduling | M8 |
| **communications** | Email, messaging — first irreversible actions | M8 |
| **home** | Lights, climate, devices | M8 |
| **finance** | Balances, spending awareness — **read-only, permanently** | M8+ |
| **health** | Fitness, sleep, records — highest sensitivity | M8+ |

**Finance is read-only by design.** The Vision says financial *awareness*, and the capability to
initiate a transfer does not exist in the manifest — so it cannot be granted by mistake, by prompt
injection, or by an over-broad standing grant. Changing that requires a deliberate ADR and a
security review, which is the point.

**One department at a time.** Building several in parallel produces several half-built things
(risk R5).

---

## Creating a department

1. Copy `_template/`.
2. Write the README first: what it owns, and explicitly what it does *not*.
3. Fill in `department.json`, including `degradedMode`.
4. Declare every event, connector, and permission. Undeclared use is rejected at runtime.
5. Write the evaluation suite for its agents before writing the agents.

Reference: [Chapter 13](../docs/01-bible/13-department-architecture.md).
