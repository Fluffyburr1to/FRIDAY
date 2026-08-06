# 41 — Glossary

> Every term used in this Bible, in plain language. If a term appears in the documentation and is
> not here, that is a defect — please add it.

---

## FRIDAY's organization

**Agent** — A specialist worker that performs one narrow job using AI reasoning. Has no network
access, no filesystem access, and no credentials. It can only *request* actions from the kernel.
([Chapter 11](11-agent-framework.md))

**Chief of Staff** — The component that turns a goal into an ordered plan and delegates the steps.
Uses AI to *make* the plan; uses ordinary deterministic code to *execute* it.
([Chapter 12](12-chief-of-staff.md))

**Connector** — A translator between FRIDAY and one external service (Google Calendar, GitHub). The
only components allowed to make outbound network requests. Has no judgment — it knows *how*, never
*when*. ([Chapter 14](14-connector-framework.md))

**Department** — An area of responsibility (Communications, Engineering, Home). Self-contained,
independently installable, and forbidden from calling another department directly.
([Chapter 13](13-department-architecture.md))

**Guardian** — The single component that decides whether any action is permitted. Returns `ALLOW`,
`DENY`, or `NEEDS_APPROVAL`. Nothing in FRIDAY may authorize an action except this.
([Chapter 19](19-approval-system.md))

**Kernel** — FRIDAY's core: the event bus, the durable log, and the process lifecycle. Everything
else is built on it. ([Chapter 05](05-backend-architecture.md))

**Model Router** — The layer that all AI model access passes through. FRIDAY's own code never names
a vendor. Enforces spending limits and routes sensitive content to local models.
([Chapter 02](02-technology-stack.md))

**Plugin** — An extension written by someone other than the owner. Runs in a sandbox with restricted
permissions. Not implemented before Milestone 8. ([Chapter 15](15-plugin-system.md))

---

## How work happens

**Plan** — A goal broken into ordered steps, stored as data in the database rather than as running
code. This is why a plan can pause for three days waiting for your approval and survive a restart.
([Chapter 12](12-chief-of-staff.md))

**Step** — One action within a plan. Carries its own risk class, its own failure policy, and its own
record of what authorized it.

**Intent** — What you asked for, interpreted into a structured form before any planning happens.

**Capability** — Something a department can be asked to do, declared in its manifest.

**Capability token** — A short-lived permission for *one action* on *one resource*, issued to an
agent for a specific step. Expires in minutes. This is what prevents a manipulated agent from doing
anything beyond its current task. ([Chapter 17](17-authentication-authorization.md))

**Manifest** — A declaration file stating what a department, connector, agent, or plugin is allowed
to do. Enforced by the runtime, not merely documented.

**Dry run** — Executing an action in preview mode to show exactly what *would* happen, without doing
it. Required for every write operation, because approving a description is weaker consent than
approving the actual artifact. ([Chapter 14](14-connector-framework.md))

---

## Approval and safety

**Approval request** — FRIDAY asking permission, with a required explanation: what, why, confidence,
risks, alternatives, and a preview of the actual action.
([Chapter 19](19-approval-system.md))

**Risk class** — How consequential an action is: `low`, `medium`, `high`, `critical`, or
`self_modification`. Assigned by the Guardian from a fixed policy table — **never by an AI model**,
so a confused or manipulated model cannot classify a wire transfer as harmless.

**Standing grant** — Pre-approval for a category of action ("always allow calendar events"). Always
expires. Never covers `critical` actions. This is Article III's own escape clause, tightly bounded.

**Negative standing grant** — A recorded boundary ("never ask me about this again"). As important as
positive grants and frequently omitted from systems like this.

**Step-up authentication** — Proving it is you *right now* — biometric or passkey — for high-risk
actions. Protects against the unattended-unlocked-laptop case.

**Safe Mode** — A reduced state where the dashboard and audit trail work but agents, connectors, and
all autonomous action are disabled. Entered automatically on serious failure, or by you at any time.
It is how urgency never becomes a reason to skip verification.
([Chapter 34](34-disaster-recovery.md))

**Fail closed** — When a limit is reached or a check cannot complete, stop rather than proceed.
Every budget, every policy check, and every approval timeout in FRIDAY works this way. A timed-out
approval means **denied**, never "assume yes."

**Prompt injection** — Malicious instructions hidden in content FRIDAY reads (an email, a document,
a web page) attempting to redirect her. Cannot be fully prevented; the architecture is built so a
successful injection cannot cause harm. ([Chapter 18](18-security-model.md))

**Ambient authority** — Holding broad permissions all the time, regardless of what you are currently
doing. The thing FRIDAY's design eliminates. Agents have capability tokens instead.

**Blast radius** — How much damage a compromised component can cause. Most security decisions here
are about limiting it rather than preventing compromise.

---

## Data and memory

**Event** — An immutable record of something that happened, written to the log *before* it is acted
upon. The event log is both FRIDAY's nervous system and her audit trail — they are the same thing.
([Chapter 10](10-event-bus.md))

**Event sourcing** — Recording everything that happens as an append-only sequence, from which the
current state is derived. This is what makes transparency structural rather than optional.

**Correlation ID** — An identifier linking every event, log line, and trace belonging to one original
request. What lets you follow one action across the whole system.

**Causation ID** — The identifier of the event that *directly caused* this one. Chains of these form
the causal tree that answers "why did you do that?"

**Provenance** — Where a piece of information came from. Every memory FRIDAY holds points back to the
specific event where she learned it. A memory without provenance is not stored — that is the rule
that prevents confident falsehoods. ([Chapter 16](16-memory-system.md))

**Projection** — A regular database table derived from the event log for fast reading. Can always be
rebuilt from the log, which remains the authority.

**Hash chain** — Each event's fingerprint includes the previous event's fingerprint. Altering
history breaks every fingerprint after it, so tampering is detectable. Verified nightly.

**Redaction** — Replacing sensitive content with a marker while keeping the record that something
was there. Used for deletion, so that removing content does not destroy the audit trail's
verifiability.

**Sensitivity** — Classification of data: `public`, `internal`, `private`, `secret`. Drives
encryption, logging, and — critically — whether something may be sent to a cloud AI model.

**Principal** — The person whose data something concerns. Present on every record from day one,
even though there is currently only one, so that adding family later is not a security audit.

**Supersession** — Replacing an outdated belief while keeping the old one. Lets FRIDAY explain past
decisions made on information since revised.

---

## Building and operating

**Monorepo** — All of FRIDAY's code in one repository rather than many. ([Chapter
04](04-monorepo-vs-multirepo.md))

**Package** — A self-contained library within the monorepo, exposing exactly one public entry point.

**ADR (Architecture Decision Record)** — A short, permanent document recording one significant
decision: what, why, what else was considered, and what it costs. Never edited — superseded.
([Chapter 37](37-adr-process.md))

**RFC** — A proposal under discussion, before it becomes a decision. Temporary.

**CI/CD** — The automated pipeline that checks every proposed change. For FRIDAY it is the
verification layer of the approval system, applied to code.
([Chapter 27](27-cicd-pipeline.md))

**Pull request (PR)** — A proposed change, with an explanation, awaiting review. **This is how FRIDAY
asks permission to change herself.** ([Chapter 31](31-git-workflow.md))

**Branch protection** — Rules preventing anyone — including you — from changing `main` without
passing the pipeline and being reviewed.

**CODEOWNERS** — A file listing which parts of the codebase require the owner's review. The
safety-critical paths.

**Constitutional test suite** — Automated tests asserting that the founding documents' guarantees
hold in the actual code. Protected: FRIDAY may never propose changes to them.

**Eval (agent evaluation)** — Scoring an agent against scenarios with a rubric, because AI output is
non-deterministic and a pass/fail test is the wrong instrument.
([Chapter 28](28-testing-strategy.md))

**Improvement proposal** — FRIDAY's structured recommendation that something should change, with
mandatory evidence from real events. She proposes; she never implements.
([Chapter 23](23-diagnostics-system.md))

**Runbook** — Step-by-step instructions for handling a specific failure, written for someone
stressed at 2am.

**Review trigger** — A specific, observable condition that means a decision should be reconsidered.
Every chapter has them, so decisions can be monitored rather than silently becoming wrong.

---

## Reliability

**Idempotent** — Doing something twice has the same effect as doing it once. Required of every event
handler and every command, because a crash can cause a retry — and a non-idempotent retry is how you
send an email three times.

**Circuit breaker** — After repeated failures, stop calling a service for a cooling-off period.
Prevents one broken service from consuming resources indefinitely.

**Bulkhead** — Per-component resource limits, so one runaway department cannot starve the others.
Named for ship compartments, for the same reason.

**Backpressure** — Bounded queues that reject work when full, rather than growing until the process
runs out of memory.

**Graceful degradation** — Continuing with reduced capability rather than stopping. Every department
must declare in advance what it can still do when its dependencies are down.

**RPO / RTO** — Recovery Point Objective (how much data you can lose) and Recovery Time Objective
(how long recovery takes). FRIDAY's audit trail has an RPO of zero.
([Chapter 34](34-disaster-recovery.md))

**Dead letter** — Where a message goes after all retries fail, so it can be inspected rather than
silently discarded.

---

## Technology

**TypeScript** — The one programming language used across all of FRIDAY.

**Zod** — The library that defines every data shape once, from which types, validation, and
documentation are all derived. Prevents the drift that makes old codebases dangerous.

**SQLite** — The database. A single file, no server, readable by ordinary tools for decades.

**Drizzle** — The type-safe layer for talking to the database.

**sqlite-vec** — Semantic search inside the same SQLite file, so memory does not require a second
database.

**tRPC** — How FRIDAY's apps talk to her core, with types shared end to end so mismatches are
compile errors.

**Tauri** — The lightweight shell that turns the web dashboard into a Mac app and a phone app.

**pnpm / Turborepo** — Dependency management and build caching for the monorepo.

**Biome** — Formatting and linting, in one fast tool.

**Vitest / Playwright** — Testing frameworks for logic and for full user journeys.

**OpenTelemetry** — Vendor-neutral instrumentation, so the observability backend stays replaceable.

**Litestream** — Continuous SQLite backup, which is what makes an RPO of zero achievable.

**whisper.cpp / Piper / openWakeWord** — Local speech recognition, synthesis, and wake word. All run
on your Mac; audio never leaves it.

**Ollama** — Runs AI models locally, for anything too sensitive to send to a cloud provider.

**launchd** — The macOS mechanism that keeps FRIDAY's core running and restarts it if it dies.

**Tailscale** — Private encrypted networking, so your phone can reach FRIDAY without exposing your
Mac to the internet.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial glossary |
