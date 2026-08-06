# 03 — Repository Structure

> **Governing provisions:** Manifesto Principle 5 (Modularity), Principle 6 (Architecture Is
> Sacred), Principle 10 (Simplicity Wins); Constitution Article VI (Modularity); Core Values 5, 6, 9.

---

## In plain language

This chapter decides where every file lives. That sounds clerical. It is not.

A repository's folder structure is the **first thing anyone sees and the last thing anyone
changes.** It teaches a newcomer — human or AI — what the system is made of before they read a
single line. If the structure mirrors the architecture, then the architecture becomes hard to
violate: putting the wrong thing in the wrong place feels wrong, and a tool can enforce it.

FRIDAY's structure follows one organizing idea, taken directly from your Manifesto:

> "FRIDAY is an organization. Not a monolith."

So the repository is laid out like an organization. There are **things that run** (`apps/`), the
**shared machinery they are built from** (`packages/`), **organizational units that own
responsibilities** (`departments/`), and **the diplomatic corps that talks to the outside world**
(`connectors/`). Someone who has read the Manifesto can find their way around this repository
without being told anything else. That is the goal.

---

## The complete tree

```
friday/
│
├── README.md                    What FRIDAY is, how to run her, where to start reading
├── CLAUDE.md                    Standing instructions for AI contributors — read every session
├── CONTRIBUTING.md              How to propose a change (applies to humans and to FRIDAY)
├── SECURITY.md                  How to report a vulnerability; the security posture
├── LICENSE                      Copyright and terms
├── CHANGELOG.md                 Generated from Changesets; user-visible history
├── CODEOWNERS                   Who must review what (the owner owns the sensitive paths)
│
├── package.json                 Root workspace manifest and top-level scripts
├── pnpm-workspace.yaml          Declares where workspace packages live
├── turbo.json                   Task pipeline and caching rules
├── tsconfig.base.json           Compiler settings inherited by every package
├── biome.jsonc                  Lint and format rules (jsonc — the rules carry reasoning)
├── .dependency-cruiser.cjs      Architectural boundary rules — enforced in CI
├── .nvmrc                       Pinned Node version
├── .gitignore
├── .gitattributes
├── .editorconfig
├── .env.example                 Every environment variable, documented, no real values
│
├── .github/
│   ├── workflows/               CI/CD pipelines (Chapter 27)
│   ├── ISSUE_TEMPLATE/
│   ├── pull_request_template.md The five Constitutional questions live here
│   └── dependabot.yml
│
├── docs/                        ── THE MOST IMPORTANT FOLDER IN THIS REPOSITORY ──
│   ├── 00-foundation/           The founding documents. Immutable. Owner may amend; nobody else.
│   ├── 01-bible/                This Project Bible, 41 chapters
│   ├── adr/                     Architecture Decision Records — the permanent decision log
│   ├── rfc/                     Proposals under discussion, before they become ADRs
│   ├── runbooks/                "It is broken at 2am and I do not remember how this works"
│   ├── guides/                  Task-oriented instructions (Diátaxis — Chapter 38)
│   └── diagrams/                Diagram sources (Mermaid/D2), rendered in docs
│
├── apps/                        ── THINGS THAT RUN ──
│   ├── core/                    The kernel service. FRIDAY's body. Runs on your Mac.
│   ├── desktop/                 Tauri shell — macOS, later Windows and Linux
│   ├── mobile/                  Tauri mobile shell — iOS, later Android
│   ├── web/                     The dashboard, served by core; also the UI both shells load
│   └── cli/                     `friday` — terminal control, diagnostics, recovery
│
├── packages/                    ── THE SHARED MACHINERY ──
│   ├── contracts/               ★ Every data shape in the system. The single source of truth.
│   ├── kernel/                  Event bus, durable log, scheduler, lifecycle
│   ├── guardian/                ★ Policy, capabilities, approvals. Nothing acts without it.
│   ├── audit/                   Immutable audit trail and the "why?" explanation engine
│   ├── chief-of-staff/          Intent → Plan → delegation → aggregation
│   ├── agent-runtime/           Agent sandbox, lifecycle, budgets, tool mediation
│   ├── model-router/            ★ Vendor-neutral AI access with budget and sensitivity routing
│   ├── memory/                  Four-layer memory: working, episodic, semantic, procedural
│   ├── storage/                 Database access, migrations, repositories, encryption
│   ├── connector-sdk/           The contract every connector implements
│   ├── plugin-host/             Discovery, manifest validation, sandboxed loading
│   ├── telemetry/               Structured logging, tracing, metrics
│   ├── diagnostics/             Self-checks, health reporting, improvement proposals
│   ├── notifications/           Channels, urgency, quiet hours, the attention budget
│   ├── voice/                   Wake word, speech-to-text, text-to-speech pipelines
│   ├── ui-kit/                  Shared React components used by web, desktop, mobile
│   └── config/                  Configuration loading, validation, precedence
│
├── departments/                 ── ORGANIZATIONAL UNITS ──
│   ├── _template/               Copy this to create a new department
│   ├── engineering/             FRIDAY improving FRIDAY (Milestone 6)
│   └── operations/              System health, backups, maintenance
│
├── connectors/                  ── THE OUTSIDE WORLD ──
│   └── _template/               Copy this to create a new connector
│
├── tools/                       ── DEVELOPMENT MACHINERY ──
│   ├── tsconfig/                Shared TypeScript configurations
│   ├── lint-config/             Shared Biome configuration
│   ├── scripts/                 Setup, migration, release, maintenance scripts
│   └── evals/                   ★ Agent evaluation harness — how we test non-deterministic AI
│
├── tests/                       ── CROSS-CUTTING TESTS ──
│   ├── e2e/                     Playwright, full-system journeys
│   ├── contract/                Connector conformance tests against recorded fixtures
│   └── fixtures/                Shared test data
│
└── infra/                       ── HOW SHE RUNS ──
    ├── launchd/                 macOS service definitions (keeping core alive)
    ├── backup/                  Litestream configuration, restore scripts
    └── otel/                    Telemetry collector configuration
```

★ marks the five packages that are architecturally load-bearing. Changes to them require an ADR and
cannot be merged from an AI-authored branch without the owner reading the diff.

---

## The rules that govern the structure

These are enforced by `dependency-cruiser` in CI. A violation fails the build with a message naming
the rule.

### Rule 1 — Dependencies flow one direction

```
apps/  ──────►  departments/  ──────►  packages/  ──────►  packages/contracts
   │                  │                                            ▲
   │                  └──────►  connectors/  ─────────────────────┘
   └───────────────────────────────────────────────────────────────┘
```

- **`apps/` may depend on anything.** Applications compose; they are the top of the graph.
- **`departments/` may depend on `packages/` and `connectors/`.** Never on an app. Never on another
  department — departments coordinate through the event bus, never by direct call.
- **`packages/` may depend on other `packages/`.** Never on an app, a department, or a connector.
  This is what makes the kernel independent of everything built on it.
- **`connectors/` may depend on `packages/connector-sdk` and `packages/contracts`. Nothing else.**
  The most restrictive rule in the system, and deliberately so: a connector is the component most
  likely to be written quickly, by an AI, or by a third party.
- **`packages/contracts` depends on nothing internal.** It is the root of the graph. If contracts
  ever imports something from FRIDAY, the architecture has inverted.

### Rule 2 — Departments never call each other

If the Engineering department needs something from Operations, it publishes an event and waits.
This is what makes departments genuinely independent units that can be added, removed, or rewritten
without touching anything else — Article VI, made physical.

### Rule 3 — Nothing outside `guardian/` may authorize an action

No package may implement its own permission check. There is exactly one place that decides whether
an action may proceed. A second one would eventually disagree with the first, and the disagreement
would be a security hole. See [Chapter 19](19-approval-system.md).

### Rule 4 — Nothing outside `model-router/` may import an AI vendor SDK

Enforced literally: `@anthropic-ai/*`, `openai`, and equivalents are on a deny-list for every path
except `packages/model-router/`. This is how Principle 5 stops being an aspiration.

### Rule 5 — Nothing outside `storage/` may open the database

All data access goes through repository functions. This gives us one place to enforce encryption,
one place to enforce multi-user data isolation, and one place to change when SQLite is eventually
replaced.

### Rule 6 — Every folder has a README

Every directory in this tree contains a `README.md` stating its charter, its boundaries, and what
does *not* belong in it. This is not bureaucracy; it is how an AI assistant starting cold discovers
where a new file should go instead of guessing. Missing READMEs fail CI.

---

## Why this structure, in detail

### Why `apps/` and `packages/` are separate

The distinction is **executable versus importable**. An app has an entry point, a lifecycle, and a
process. A package is a library that is used by something else and never runs on its own.

Keeping them separate makes two things obvious at a glance: what actually runs in production, and
what is shared. It also enables a rule that matters enormously — *packages may never import from
apps*. Without that rule, shared code slowly accumulates knowledge of the specific application that
first needed it, and it stops being shared code.

### Why `departments/` is a top-level folder and not `packages/departments-*`

This is the structural decision I want you to push back on if you disagree, because it is the one
most driven by your Manifesto rather than by engineering convention.

Conventionally, departments would be packages. I have given them their own top level because your
Manifesto describes FRIDAY as an organization with departments as first-class units, and because
they behave differently from packages in three concrete ways:

1. **They are optional at runtime.** A department can be installed, disabled, or removed without
   the system noticing. Packages cannot.
2. **They have a manifest.** Each declares its capabilities, required permissions, events consumed
   and emitted, and connector dependencies. Packages have no such thing.
3. **They are where FRIDAY grows.** The Long-Term Vision lists ten domains. Each becomes a
   department. Giving them a visible top-level home makes the system's growth legible from the
   folder listing — you can see what FRIDAY can do by running `ls departments/`.

That third property is the real reason. It makes the repository self-describing.

### Why `connectors/` is separate from `departments/`

They are different kinds of thing and conflating them would be a lasting mistake.

A **connector** is a translator: it speaks Google Calendar's API on one side and FRIDAY's internal
vocabulary on the other. It has no opinions and makes no decisions.

A **department** has judgment: it decides what to do, in what order, and when to ask you.

Keeping them apart means the Calendar connector can be used by the Productivity department, the
Health department, and the Home department without any of them knowing about each other. It also
means connectors — which touch external networks and credentials, and are the highest-risk
components in the system — can be held to a much stricter, more mechanical standard than
departments. One folder, one security posture.

### Why `docs/` sits above the code and is numbered

Numbering (`00-foundation`, `01-bible`) forces reading order in a plain directory listing. Someone
landing in this repository sees the founding documents first and the Bible second, because that is
the order in which they must be understood.

Placing docs above `apps/` alphabetically is a small deliberate signal, consistent with Core Value
9 ("Document Everything") and with the practical reality that documentation is the primary artifact
of a project built by AI assistants with no memory.

### Why `tools/evals/` exists at all

This folder has no equivalent in a normal project, and it is one of the more important ones here.

Ordinary code is deterministic: given the same input it produces the same output, so a test asserts
equality. **Agents are not deterministic.** The same request produces different phrasing, different
tool sequences, and occasionally different conclusions. `assert(output === expected)` is the wrong
instrument entirely.

So agents are graded, not asserted. `tools/evals/` holds scenario suites, scoring rubrics, and
score history. An agent change that drops the suite score below its threshold fails CI just as a
broken test would. Without this, you would have no way to know whether a change to a prompt made
FRIDAY better or worse — and prompt changes are the changes you will make most often.

Full design in [Chapter 28](28-testing-strategy.md).

### Why `_template/` folders exist

`departments/_template/` and `connectors/_template/` are complete, documented, working skeletons.
Creating a new department means copying the template and filling it in.

The reason is specific to how you work: when you tell an AI assistant "add a Home Automation
department," the assistant's first act is to look for a template. If one exists, the new department
matches every existing one. If none exists, the assistant invents a structure — a slightly
different one each time — and after six departments you have six architectures. **Templates are how
a codebase built by forgetful contributors stays consistent.**

These templates are the one place placeholder-looking files are correct, and they will be written
at Milestone 1 alongside the first real department, not before.

---

## Anatomy of a package

Every package in `packages/` has the same internal shape. Predictability across twenty packages is
worth more than local optimization in any one.

```
packages/<name>/
├── README.md          Charter, boundaries, what does NOT belong here
├── package.json       Name (@friday/<name>), explicit dependencies
├── tsconfig.json      Extends tools/tsconfig
├── src/
│   ├── index.ts       Public surface. The ONLY file others may import from.
│   ├── types.ts       Types local to this package
│   ├── errors.ts      Typed errors this package can produce
│   └── <internals>    Implementation, freely organized, never imported externally
└── test/
    ├── unit/
    └── integration/
```

The `index.ts` rule is the one that matters. Everything else in `src/` is private by convention and
by lint rule. This is what makes a package genuinely replaceable: consumers depend on a small
declared surface, not on internal structure that shifts.

## Anatomy of a department

```
departments/<name>/
├── README.md
├── department.json     Manifest: capabilities, permissions, events, connectors, risk classes
├── package.json
└── src/
    ├── index.ts        Registration entry point
    ├── agents/         Agent definitions owned by this department
    ├── policies/       Department-specific rules, evaluated by the Guardian
    ├── handlers/       Event subscriptions
    └── prompts/        Versioned prompt templates (yes, prompts are source code)
```

`prompts/` being version-controlled source is deliberate. Prompts determine behavior as much as
code does. They get reviewed, versioned, diffed, and tested like anything else.

## Anatomy of a connector

```
connectors/<service>/
├── README.md           Including exactly what data leaves the machine
├── connector.json      Manifest: auth method, scopes, endpoints, data categories, rate limits
├── package.json
└── src/
    ├── index.ts
    ├── auth.ts         Credential handling — never stores secrets itself
    ├── operations/     One file per operation, each declaring its risk class
    └── mappers/        External shapes ↔ FRIDAY contracts
```

The `connector.json` **data categories** declaration is a privacy control with teeth: it is what
the dashboard reads to show you what leaves your machine, and the Guardian refuses to execute an
operation that transmits a category the connector did not declare. Article IV, enforced by the
runtime rather than by a promise.

---

## Naming conventions

| Thing | Convention | Example |
|---|---|---|
| Folders | `kebab-case` | `chief-of-staff/` |
| Package names | `@friday/<folder-name>` | `@friday/model-router` |
| Departments | `@friday/dept-<name>` | `@friday/dept-engineering` |
| Connectors | `@friday/conn-<service>` | `@friday/conn-google-calendar` |
| TypeScript files | `kebab-case.ts` | `approval-request.ts` |
| React components | `PascalCase.tsx` | `ApprovalCard.tsx` |
| Test files | `<subject>.test.ts` | `guardian.test.ts` |
| Event type names | `dot.separated.past.tense` | `plan.step.completed` |
| Database tables | `snake_case`, plural | `approval_requests` |
| Environment variables | `FRIDAY_SCREAMING_SNAKE` | `FRIDAY_DB_PATH` |

Past-tense event names are not a style preference. An event is a record of something that already
happened and cannot be undone. `plan.step.completed` is a fact; `completePlanStep` is a command.
Naming them as facts keeps people from treating the event log as a work queue, which is the most
common way event-sourced systems get corrupted.

---

## Alternatives considered

### Layered structure (`src/controllers/`, `src/services/`, `src/models/`)

The most common structure in the industry, and genuinely useful for conventional web applications.

**Rejected** because it groups by *technical role* rather than by *responsibility*. Everything
about the memory system would be scattered across five folders, and adding a department would touch
all of them. It also actively fights Article VI — you cannot replace a subsystem that has no single
home. This structure optimizes for "where do I put a controller," and FRIDAY's hard question is
"where does this capability live."

### Domain-driven design with strict bounded contexts

Closest in spirit to what we chose, and philosophically well aligned with the organization metaphor.

**Rejected in its full form** as too much ceremony for one person: aggregates, value objects,
repositories per aggregate, domain events distinct from integration events, and an anti-corruption
layer per context. We have taken the ideas that pay for themselves here — bounded contexts as
departments, an anti-corruption layer as connectors, domain events on the bus — and left the rest.
Principle 10.

### Flat `packages/` with no `apps/`, `departments/`, or `connectors/` distinction

Simplest possible: everything is a package.

**Rejected** because it discards information. When every one of forty folders is a "package," the
listing tells you nothing about what the system is or how it grows, and the dependency rules that
protect the architecture become impossible to express. The three-way split *is* the architecture,
visible.

### Feature-based structure (a folder per user-facing feature)

Excellent for product applications where features are the unit of work.

**Rejected** because FRIDAY's unit of work is not a feature — it is a capability owned by a
department and delivered through agents. Features cut across departments; departments are the
stable thing. Organizing by the unstable axis would guarantee constant restructuring.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **More folders than a small project needs.** Twenty packages before FRIDAY does anything. | Accepted. The alternative is extracting them later under pressure, which never happens cleanly. Empty-ish packages are cheap; tangled ones are not. |
| **Boundary rules will sometimes be annoying** — a genuinely reasonable import will be blocked. | Accepted, and the friction is the point. The correct response is to fix the design or amend the rule with an ADR, never to add an exception silently. |
| **Every folder needing a README is real ongoing work.** | Accepted. Core Value 9. It is also the single highest-return investment for a project driven by AI assistants with no memory. |
| **The `index.ts`-only rule occasionally forces re-exports** that feel like busywork. | Accepted. It is what keeps packages replaceable. |
| **Departments as a top level is unconventional**, and a new contributor may find it surprising. | Accepted. It follows the Manifesto, and `departments/README.md` explains it in the first paragraph. |

---

## The long-term call

**This structure should survive the life of the project.** It is designed to grow by *addition* —
new departments, new connectors, new packages — rather than by *restructuring*. The Long-Term
Vision's ten domains all fit as departments without moving anything.

The single change I would anticipate: if `packages/` exceeds roughly thirty entries, group them
into `packages/kernel/*` and `packages/services/*`. That is a mechanical move, not a redesign, and
the dependency rules would carry over unchanged.

The structure is wrong if it ever becomes unclear where a new file goes. That confusion is the
signal to revisit this chapter — and it should be raised as an RFC, not solved by putting the file
somewhere convenient.

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
