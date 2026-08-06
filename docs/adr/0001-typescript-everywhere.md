# ADR-0001 — TypeScript across the entire stack

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 02](../01-bible/02-technology-stack.md)

## Context

FRIDAY must run as a background service, a web dashboard, a Mac application, and an iPhone
application. The owner does not write code and directs AI assistants that begin every session
with no memory of the previous one.

At the time of this decision we did not know how much of the codebase AI assistants would write.
The working assumption is "most of it," and that assumption drove the outcome more than any
language-design consideration.

## Decision

We will use **TypeScript in strict mode for every application and package**, with one sealed
exception: speech recognition and local model inference run as separate processes speaking a
documented protocol, never as linked libraries.

## Constitutional review

- **Article VI (Modularity):** one language keeps every component genuinely interchangeable.
- **Principle 10 (Simplicity Wins):** one toolchain, one set of conventions, one vocabulary.

- [x] Can the user see it? — n/a, no runtime behavior
- [x] Can the user stop it? — n/a
- [x] Can we replace it? — Costly but bounded; the process boundary around native code means the
      exception cannot spread.
- [x] Can we explain it? — n/a
- [x] Right in five years? — TypeScript is the default language of application software; ecosystem
      risk is as low as software gets.

## Alternatives considered

### Python
**What it is.** The default language for AI work, with the strongest ML ecosystem by a wide margin.
**Advantages.** Best-in-class AI libraries; enormous community; excellent for the model-adjacent work.
**Why rejected.** Cannot reach the browser, the Mac app, or the phone without a second language,
which defeats the owner's explicit constraint. Its type system is advisory — it does not stop bad
code from running, which is the exact guarantee we most need from a codebase written by assistants.

### Go
**What it is.** A compiled language well suited to concurrent I/O coordination.
**Advantages.** Excellent operational characteristics; single-binary deploys; fast.
**Why rejected.** No browser or native UI story. Its deliberate minimalism also makes the
schema-driven design this architecture depends on considerably more verbose.

### Rust
**What it is.** A systems language with the strongest correctness guarantees here.
**Advantages.** Memory safety; excellent performance; Tauri is written in it.
**Why rejected.** Severe learning curve, and AI assistants make substantially more mistakes in Rust
than in TypeScript. Iteration speed matters enormously at 10–20 hrs/week.

### C#/.NET
**What it is.** A mature platform capable of server, web, desktop, and mobile via MAUI.
**Advantages.** Genuinely covers the full range; strong type system; good tooling.
**Why rejected.** Much thinner ecosystem for AI orchestration, far less training data available to
AI assistants for these patterns, and MAUI's iOS track record has been rocky.

## Consequences

**Positive**
- One schema definition in `packages/contracts` types the server, the dashboard, and the phone app.
  Changing a data shape produces a compile error at every site that must change, across all four
  applications.
- Strict mode catches an assistant's mistakes before the owner — who cannot read code — sees them.

**Negative**
- Not the best platform for numerical ML work. Accepted: FRIDAY calls models, she does not train them.
- Types vanish at runtime, so Zod validation at every boundary becomes mandatory rather than optional.
- Node is single-threaded for computation; CPU-heavy work must move to workers or sidecars.

**Neutral**
- Constrains future tool selection to things with good TypeScript support.

## Reversibility

- **Cost to reverse:** high
- **How:** Rewrite. Realistically this is not reversed; individual subsystems are extracted to
  sealed sidecars instead.
- **Point of no return:** roughly Milestone 3, once the kernel and agent runtime exist.

## Review triggers

- A specific subsystem's performance becomes measurably limiting → extract it as a sidecar, do not
  change the stack
- TypeScript's governance or ecosystem materially destabilizes
