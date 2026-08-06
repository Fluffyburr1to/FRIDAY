# 02 — Recommended Technology Stack

> **Governing provisions:** Manifesto Principle 5 (Modularity Creates Freedom), Principle 6
> (Architecture Is Sacred), Principle 10 (Simplicity Wins); Constitution Article VI (Modularity),
> Article IV (Privacy); Core Values 5, 6, 12.

---

## In plain language

This chapter picks the tools. Think of it like choosing the materials for a house you intend to
live in for thirty years: you are not picking what is fashionable, you are picking what you can
still get parts for in 2040, what a stranger can repair, and what will not rot.

Two rules governed every choice here.

**Rule one: boring beats clever.** Every tool on this list is either an industry default or a
well-established alternative with years of production use. Nothing here is exciting. That is
deliberate. Exciting technology has small communities, sparse documentation, and a habit of being
abandoned — and when you are one person working evenings with AI assistance, you are entirely
dependent on the thing you chose being well-documented enough that an AI assistant has seen a
thousand examples of it.

**Rule two: nothing load-bearing may be a vendor.** Your Constitution's Article VI says every
subsystem must be replaceable. So where a choice involves a company that could change its pricing,
its terms, or its existence — AI model providers especially — the *choice is wrapped in an
abstraction* and the vendor becomes a swappable configuration line rather than a dependency baked
into a thousand files.

---

## The complete stack

| Layer | Recommendation | Version target |
|---|---|---|
| Language | TypeScript, strict mode | 5.6+ |
| Runtime | Node.js LTS | 24.x (active LTS) |
| Package manager | pnpm | 9.x |
| Build orchestration | Turborepo | 2.x |
| Schema & validation | Zod | 3.x |
| Internal API transport | tRPC | 11.x |
| External API | OpenAPI 3.1, generated from Zod | — |
| Database | SQLite in WAL mode | 3.46+ |
| Database access | Drizzle ORM | 0.3x |
| Vector search | sqlite-vec | 0.1.x |
| Event bus | In-house, SQLite-backed | — |
| Web framework | React | 19.x |
| Web build tool | Vite | 6.x |
| Styling | Tailwind CSS | 4.x |
| Component primitives | Radix UI | 1.x |
| Client state | TanStack Query + Zustand | 5.x / 5.x |
| Desktop shell | Tauri | 2.x |
| Mobile shell | Tauri 2 mobile (fallback: Capacitor 6) | 2.x |
| AI model access | In-house Model Router | — |
| Local model runtime | Ollama | latest |
| Speech recognition | whisper.cpp | latest |
| Speech synthesis | Piper | latest |
| Wake word | openWakeWord | latest |
| Logging | Pino | 9.x |
| Tracing & metrics | OpenTelemetry SDK | 1.x |
| Testing | Vitest | 2.x |
| End-to-end testing | Playwright | 1.4x |
| Lint & format | Biome | 1.9+ |
| Module boundaries | dependency-cruiser | 16.x |
| CI/CD | GitHub Actions | — |
| Versioning | Changesets | 2.x |
| Secret storage | OS keychain via keytar-equivalent | — |
| Backups | Litestream → Backblaze B2 | 0.3.x |

Everything below explains one of these.

---

## Language: TypeScript

### Recommendation

TypeScript 5.6+ with the strictest available compiler settings, across every application and
package in the repository. No JavaScript files. No `any` type without a written justification.

### Why

You chose "one language for everything," and TypeScript is the only language that can genuinely
deliver that for this particular set of targets. Consider what FRIDAY needs to run on: a background
service, a web page, a Mac application, and an iPhone. TypeScript is the only mainstream language
that reaches all four without a second language appearing somewhere.

But the reason that actually matters is subtler, and it is about **you specifically**.

You are directing AI assistants that start every session with no memory of the last one. The single
most valuable property in that situation is a compiler that catches an assistant's mistakes before
you ever see them. TypeScript in strict mode is unusually good at this. When an AI assistant
invents a function parameter that does not exist, misremembers a field name, or forgets that a
value might be missing, the build fails with a precise message pointing at the exact line. Without
that, those mistakes reach runtime, where you — a person who does not read code — have to diagnose
them from a symptom.

The second reason is **end-to-end type sharing**. FRIDAY's data shapes are defined once, in
`packages/contracts`, using Zod. From that single definition we derive: the runtime validator that
guards the API, the TypeScript type used by the server, the TypeScript type used by the React
dashboard, the TypeScript type used by the iPhone app, and the database column types. Change the
shape of an "Approval Request" in one file, and the compiler immediately lists every place in four
applications that must be updated. In a two-language stack, that same change silently breaks the
phone app and you find out in three weeks.

### Alternatives considered

**Python.** The natural instinct for anything AI-related, and it has the best machine-learning
ecosystem by a wide margin. Rejected because it cannot reach the web browser, the Mac app, or the
phone without a second language, which defeats the entire purpose of the constraint you set.
Python's type system, while much improved, is optional and advisory — it does not stop bad code
from running, which is precisely the guarantee we need most. Its packaging and dependency story
remains meaningfully harder to keep working over years than pnpm's.

**Go.** Excellent for exactly the kind of concurrent I/O coordination FRIDAY's kernel does,
compiles to a single fast binary, and has superb operational characteristics. Rejected for the same
reason as Python — no browser, no native UI story — and because Go's deliberate minimalism makes
the kind of expressive schema-driven design this architecture relies on considerably more verbose.
Worth revisiting if a specific component ever becomes a performance bottleneck; it is a natural
choice for a sealed sidecar.

**Rust.** The strongest correctness guarantees of anything here, and Tauri is written in it.
Rejected as a primary language because the learning curve is severe, AI assistants make
substantially more mistakes in Rust than TypeScript, and iteration speed matters enormously for a
solo builder with limited hours. We accept Rust only where Tauri requires it, which is
configuration-level.

**C#/.NET.** Genuinely capable of the full range — server, web (Blazor), desktop (MAUI), mobile
(MAUI). A serious contender. Rejected because its ecosystem for AI orchestration, and the volume of
training data available to AI assistants for these specific patterns, is much thinner than
TypeScript's; and because MAUI's track record on iOS has been rocky.

### Trade-offs we accept

- TypeScript's types **vanish at runtime**. A value can lie about its type if it came from outside
  the program. This is why Zod validation at every boundary is mandatory rather than optional — see
  [Chapter 20](20-api-standards.md).
- Node.js is **single-threaded for computation**. CPU-heavy work (embedding generation, audio
  processing) must move to worker threads or sealed sidecar processes. Designed for, not
  discovered later.
- We are **not on the best platform for machine learning**. Accepted because FRIDAY does not train
  models; she calls them. Coordination, not computation, is the workload.

### The long-term call

TypeScript. It has become the default language of application software, its governance is stable,
and the ecosystem risk is as low as software gets. Reassess only if a specific subsystem's
performance becomes measurably limiting — and then replace that subsystem with a sealed sidecar,
never the whole stack.

---

## Runtime: Node.js LTS

### Recommendation

Node.js 24 LTS (the current active LTS), tracking LTS releases thereafter. Version pinned in
`.nvmrc` and enforced in CI.

### Why

FRIDAY's kernel spends almost all of its time waiting: on a network call to an AI model, on a
calendar API, on a database read, on you. Node's event loop is purpose-built for holding thousands
of simultaneous waits cheaply, which is exactly the shape of this workload.

The decisive factor, though, is **support duration**. Node LTS versions get 30 months of security
patches. For a system meant to run for decades on a machine in your house, "how long will this
receive security fixes without me doing anything" is a first-class architectural concern, not an
operational detail.

### Alternatives considered

**Bun.** Dramatically faster startup, faster package installs, built-in test runner and bundler,
and a genuinely pleasant developer experience. Rejected for the *core service* because it is young,
its Node compatibility still has sharp edges in exactly the low-level areas FRIDAY uses (native
modules, worker threads, process management), and its long-term support commitments are not yet
proven. We will use Bun for local script execution where a failure is instantly visible and costs
nothing. Revisit for the core at Milestone 6.

**Deno.** Excellent security model — permissions are explicit and granular, which aligns beautifully
with Article V's least-privilege requirement. Genuinely tempting. Rejected because its npm
compatibility layer, while good, is not seamless for native modules like SQLite bindings, and
because its ecosystem gravity is much smaller, which means AI assistants make more mistakes.

### Trade-offs we accept

- Node startup is slower than Bun's, and its built-in tooling is weaker. Mitigated by Vitest and
  Biome, which are fast.
- Node has **no built-in permission model**. Deno would have given us process-level sandboxing for
  free. We must build agent isolation ourselves — see [Chapter 11](11-agent-framework.md). This is
  a real cost and it is the strongest argument against this choice.

### The long-term call

Node LTS, revisited every two years. The Node/Bun/Deno gap is narrowing, and the abstraction cost
of switching is low because we avoid runtime-specific APIs by convention.

---

## Package manager and build: pnpm + Turborepo

### Recommendation

pnpm workspaces for dependency management; Turborepo for task orchestration and caching.

### Why pnpm

pnpm is **strict about dependencies in a way npm and yarn are not**. If `packages/memory` uses a
library, it must declare that library. npm's flat installation layout lets a package accidentally
use something a sibling installed, producing code that works today and breaks mysteriously when the
sibling changes. In a repository with twenty packages that one person maintains across years, that
class of bug is disproportionately expensive — it appears long after the change that caused it.

pnpm also stores each package version once on disk and hard-links it, so a monorepo with twenty
packages sharing React does not store React twenty times. On a laptop, that matters.

### Why Turborepo

Without it, changing one line means rebuilding and re-testing everything — several minutes each
time. Turborepo understands which packages depend on which, so a change to the iPhone app does not
retest the database layer. Unchanged work is restored from cache instantly. This converts a
ten-minute feedback loop into a twenty-second one, and feedback loop length is the primary
determinant of whether an evenings-and-weekends project makes progress.

### Alternatives considered

**npm workspaces.** Built in, zero extra tooling. Rejected for the dependency-strictness reason
above; the phantom-dependency problem is a long-term maintenance tax we should not accept.

**Nx.** More powerful than Turborepo — code generators, dependency graph visualization, richer
plugins. Rejected as too much machinery for one person. Nx wants to own your project structure;
Turborepo just makes tasks fast. Simplicity Wins (Principle 10). Reconsider if a real team forms.

**Bazel.** Correct at enormous scale and hostile at every other scale. Firmly rejected.

### Trade-offs we accept

- Two tools instead of one. Both are small and well-documented.
- pnpm's strictness occasionally requires an explicit dependency declaration that npm would not
  have needed. This is the feature, experienced as friction.

---

## Schemas: Zod

### Recommendation

Zod is the **single source of truth for every data shape that crosses a boundary** in FRIDAY. All
of them live in `packages/contracts`.

### Why

This is one of the highest-leverage decisions in the stack, and it is worth understanding even if
you do not code.

A "schema" is a description of a data shape — for example, "an Approval Request has an ID, a
description, a risk level that is one of low/medium/high/critical, and an optional deadline." In
most systems that description exists in four or five places: the database, the server code, the API
documentation, the web UI, and the mobile app. They drift apart. The documentation says one thing,
the code does another, and nobody notices until something breaks.

With Zod, that description exists **once**. From it we mechanically derive the TypeScript type, the
runtime validator that rejects malformed data at the door, the JSON Schema used to tell an AI model
what shape of answer to produce, the OpenAPI documentation, and the form validation in the UI.
They cannot drift, because there is only one of them.

For FRIDAY specifically, there is a second benefit that matters more than it sounds: **AI models
produce unreliable output, and Zod is how we make that safe**. When FRIDAY asks a model to produce
a plan, the model returns text that is *usually* the right shape. Zod validates it before anything
touches it. Invalid output is rejected and retried rather than propagated into the system. This is
the boundary between "AI is a component" and "AI is a liability."

### Alternatives considered

**Valibot.** Much smaller bundle, near-identical API. Genuinely attractive for the mobile app.
Rejected as the primary choice because Zod's ecosystem integration — with tRPC, Drizzle, and the AI
SDKs — is significantly deeper. Revisit if mobile bundle size becomes a measured problem.

**TypeBox.** Faster validation, JSON-Schema-native. Rejected for worse ergonomics; readability of
contracts matters more here than validation microseconds.

**Hand-written types with no runtime validation.** Rejected outright. TypeScript types disappear at
runtime; without validation, malformed data from an AI model or an external API flows straight into
the database.

### Trade-offs we accept

- Zod validation costs real CPU on hot paths. Measured, and mitigated by validating at boundaries
  only, never internally between trusted components.
- Zod 4 is on the horizon with breaking changes. Contained: schemas live in one package, so the
  migration is one package's problem.

---

## Database: SQLite + Drizzle + sqlite-vec

Full treatment in [Chapter 09](09-database-design.md). The summary of *why these tools*:

**SQLite** is a complete relational database in a single file, with no server to run, no port to
secure, no password to manage, and no process to keep alive. For a local-first personal system this
is not a compromise — it is the correct architecture. It is also the most thoroughly tested software
of its kind in existence, and its file format is a US Library of Congress recommended preservation
format, which is about as strong a guarantee of "readable in 2050" as software offers.

The `PostgreSQL` alternative is genuinely better for multi-user, multi-machine deployment, and we
will likely want it eventually. That is why all database access goes through a repository layer and
Drizzle — which speaks both dialects — so the migration is real work but not a rewrite. Chapter 09
defines the exact trigger conditions for making that move.

**Drizzle ORM** gives us type-safe queries where the compiler knows your table shapes, with SQL
that stays recognizably SQL. Prisma was the main alternative and was rejected because it requires a
separate schema language and a code-generation step, and its SQLite story is weaker.

**sqlite-vec** puts vector similarity search — the mechanism behind FRIDAY's memory recall — inside
the same SQLite file. The alternative is running a dedicated vector database (Chroma, Qdrant,
Weaviate) as a second service, which means a second process, second backup, second failure mode,
and second thing to secure. Article VII (reliability through fewer moving parts) and Principle 10
(Simplicity Wins) both point the same direction here.

---

## AI models: the Model Router

### Recommendation

FRIDAY's core never names an AI vendor. All model access goes through `packages/model-router`,
which exposes capability-based requests — "I need strong reasoning, up to 8000 tokens, under 5
seconds, this data is sensitive" — and selects a provider based on policy.

Initial providers: **Anthropic Claude** (primary reasoning), **OpenAI** (fallback and embeddings),
**Ollama running locally** (sensitive data, offline operation, cheap classification).

### Why this is non-negotiable

Principle 5 says it directly: "FRIDAY should never depend on one vendor, one technology, or one AI
provider." But there are three concrete reasons beyond the principle.

**Models change faster than anything else in this stack.** The best model available today will not
be the best model in eighteen months, and the pricing will have moved by an order of magnitude in
some direction. Code that calls a vendor's SDK directly, scattered across dozens of agents, makes
that a migration project. Code that calls a router makes it a config change.

**Privacy requires routing by sensitivity.** Article IV says prefer local processing. The router is
the mechanism: a request tagged `sensitivity: high` is routed to the local Ollama model and is
*structurally incapable* of reaching a cloud provider, because the router will refuse rather than
downgrade. That guarantee cannot exist if agents call vendors directly.

**Cost control requires a chokepoint.** Your budget is $50–200/month. The router enforces a hard
monthly ceiling and per-plan budgets, and it **fails closed** — when the budget is exhausted, it
stops rather than continuing to spend. A runaway agent loop is the single most plausible way to
receive a surprise $2,000 bill, and this is the defense.

### Alternatives considered

**Calling vendor SDKs directly.** Simplest, fastest to write. Rejected as a direct violation of
Principle 5 and a guaranteed future rewrite.

**LangChain / LlamaIndex.** Large frameworks that provide this abstraction plus much more. Rejected
deliberately and with some regret. They move fast, break interfaces between minor versions, and
impose their own architecture on yours — which is the opposite of Article VI. Their abstractions
are also broad and shallow: they cover many providers thinly, and FRIDAY needs a few providers
deeply, with budget enforcement and sensitivity routing that no framework offers. We will read
their source for ideas and depend on neither.

**Vercel AI SDK.** Well-made, TypeScript-native, good provider abstraction. The closest call in
this chapter. Rejected as the *foundation* because it is optimized for chat-style streaming UIs
rather than autonomous agent orchestration with policy enforcement — but we will use it inside the
router as an implementation detail for providers it covers well. This is the right compromise:
their code, our boundary.

**OpenRouter (a hosted routing service).** Genuinely useful, one API for many models. Rejected as
the *primary* path because it inserts a third party into every AI request, which Article IV
disfavors, and because it becomes exactly the single dependency Principle 5 forbids. It will be
supported as *one provider among several* inside our router.

### Trade-offs we accept

- The router is a **lowest-common-denominator abstraction**. A vendor's unique feature is either
  wrapped generically or unavailable. Accepted: vendor-specific features are precisely the lock-in
  Principle 5 warns about.
- We maintain the router ourselves. It is a few hundred lines and it is the most strategically
  important few hundred lines in the system.

---

## Interface stack: React + Vite + Tailwind + Radix

Detailed in [Chapter 06](06-frontend-architecture.md). Briefly:

**React** because its ecosystem is the largest, because Tauri and Capacitor both target it
natively, and — pragmatically — because AI assistants write correct React far more reliably than
correct anything-else, which directly affects your throughput.

**Svelte** and **SolidJS** are both technically superior in several respects (smaller, faster, less
ceremony). Rejected on ecosystem depth and assistant reliability. This is an honest
popularity-over-elegance call, and it is the right one for a solo builder.

**Tailwind** because styling stays in the component file rather than in a parallel stylesheet
hierarchy that drifts. **Radix UI** for accessible, unstyled component primitives — dialogs, menus,
and popovers are deceptively hard to build correctly, and accessibility is not optional in a system
whose founding document is about respecting people.

---

## Speech: local by default

| Function | Choice | Why |
|---|---|---|
| Wake word | openWakeWord | Runs on-device, tiny, no audio ever transmitted |
| Speech → text | whisper.cpp | Excellent quality, runs fast on Apple Silicon, fully local |
| Text → speech | Piper (local); ElevenLabs (optional, per-utterance opt-in) | Local default satisfies Article IV; cloud voice available when quality matters and content is not sensitive |

Article IV makes this nearly automatic. Always-on microphone audio is among the most sensitive data
a person can generate. It does not leave the machine. Full design in
[Chapter 25](25-voice-architecture.md).

---

## Quality tooling: Biome, Vitest, Playwright

**Biome** replaces ESLint and Prettier with one tool that is roughly ten times faster. Rejected
ESLint despite its larger plugin ecosystem because the plugin sprawl and configuration complexity
are a maintenance tax, and Biome now covers the rules that matter. The one capability we lose —
sophisticated custom lint rules — is recovered by **dependency-cruiser**, which enforces module
boundaries (chapter 30) and is the rule category we actually cannot do without.

**Vitest** for unit and integration tests; shares Vite's configuration, so there is one build
pipeline instead of two.

**Playwright** for end-to-end tests through a real browser.

**A custom evaluation harness** for agents, in `tools/evals`. This is the unusual one and it is
essential: agents are non-deterministic, so a pass/fail test is the wrong instrument. Agents are
graded against a scored scenario suite with a minimum passing threshold, and the score is tracked
over time. See [Chapter 28](28-testing-strategy.md).

---

## What we are deliberately not using

| Rejected | Why |
|---|---|
| Kubernetes / Docker Swarm | FRIDAY runs on one Mac. Orchestrating one machine is pure ceremony. |
| Microservices | Distributed systems buy independent scaling, which one user does not need, and cost distributed debugging, which one person cannot afford. Modularity comes from module boundaries, not network boundaries. |
| GraphQL | Solves the many-clients-with-different-needs problem. We have one team writing all clients. tRPC gives the same type safety for far less machinery. |
| Kafka / RabbitMQ | Industrial message brokers for millions of messages/sec. FRIDAY will do thousands per day. |
| Redis | A second data store to run, secure, and back up, for caching we do not yet need. Add when measured, not before. |
| A LangChain-style agent framework | Covered above — opinionated, fast-moving, and its architecture would become ours. |
| Electron | Covered in [Chapter 07](07-desktop-strategy.md) — kept as the documented fallback if Tauri disappoints. |
| Any paid SaaS in the critical path | Anything FRIDAY cannot run without is a vendor she depends on. Article VI. |

---

## Cost model

| Item | Monthly |
|---|---|
| Cloud AI usage (Anthropic + OpenAI, capped) | $20–70 |
| Backblaze B2 backup storage | $1–3 |
| Domain name (optional, for remote access) | $1–2 |
| Apple Developer Program (required at M7, $99/yr) | $8 |
| GitHub | $0 (free tier is sufficient) |
| Observability | $0 (self-hosted locally) |
| **Total** | **$30–83** |

Comfortably inside your $50–200 band with headroom for growth. The only variable that can escape is
cloud AI usage, which is why the Model Router's hard budget ceiling is a Milestone 3 requirement
rather than a later refinement.

---

## Review triggers

This chapter is re-examined when any of these occur, not on a calendar:

- Bun or Deno reaches a maturity we would trust for the core service
- Tauri 2 mobile proves inadequate during Milestone 7
- Monthly AI spend exceeds $150 for two consecutive months
- SQLite becomes limiting (defined precisely in [Chapter 09](09-database-design.md))
- A second person joins the project
- Any tool here is abandoned by its maintainers

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
