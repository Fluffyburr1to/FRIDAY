# ADR-0002 — Single monorepo with pnpm and Turborepo

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner, Engineering Lead
- **Related:** [Bible 04](../01-bible/04-monorepo-vs-multirepo.md), [Bible 03](../01-bible/03-repository-structure.md)

## Context

FRIDAY comprises a kernel, several applications, organizational departments, and connectors. A
natural instinct is that a modular system needs separate repositories — the Constitution demands
replaceable subsystems, and separate folders *feel* like separate things.

Modularity and repository layout are different concerns. Modularity is about how code depends on
code; repository layout is about where files sit on a disk.

## Decision

We will use **a single monorepo** containing every application, package, department, and connector,
with modularity enforced by package boundaries, `dependency-cruiser` rules checked in CI, and
interface-first design.

**One exception:** third-party plugins live outside this repository, because we neither control nor
review them.

## Constitutional review

- **Article VI (Modularity):** satisfied by enforced boundaries, not by geography. A monorepo where
  a boundary violation fails the build is *more* genuinely modular than nine repositories held
  together by good intentions.
- **Principle 10 (Simplicity Wins):** avoids adopting the coordination structure of a fifty-person
  organization while being one person.

- [x] Can we replace it? — Yes; enforced boundaries keep a later split cheap. That option is the
      real payoff of enforcing modularity inside one repository.

## Alternatives considered

### Full multi-repo (one per major component)
**Advantages.** Smaller repositories; per-repository access control; independent release cadence;
a broken build blocks only one component.
**Why rejected.** Every advantage addresses a multi-team problem. The costs land on one person:
a single cross-cutting change becomes five pull requests across four repositories in a required
order, during which parts of the system run mismatched versions. AI assistants would see fragments
and could not verify their own work.

### Hybrid: core monorepo + separate app repositories
**Advantages.** Apps have genuinely different build tooling and release cycles.
**Why rejected.** Splits along exactly the seam where cross-cutting change is most frequent — the
contract between kernel and interface. Retained as the documented fallback if the repository ever
becomes unwieldy.

### Monorepo with git submodules
**Why rejected.** Error-prone, produce detached-HEAD states that confuse people and tools, poorly
handled by CI and by every AI assistant. Multi-repo's drawbacks plus extra sharp edges.

### Monorepo with Nx instead of Turborepo
**Advantages.** Dependency graph visualization, generators, built-in boundary enforcement.
**Why rejected.** Opinionated about project structure and meaningfully more configuration. The one
capability we would miss is covered by dependency-cruiser. Revisit if a team forms.

## Consequences

**Positive**
- A cross-cutting change is one commit, one review, one merge; the system is never inconsistent.
- One honest history answers "what changed and why" — the traceability Article II asks for.
- Refactoring stays possible: rename a thing and the compiler lists all call sites.

**Negative**
- All-or-nothing access control. Irrelevant at one contributor; the strongest future trigger to split.
- CI runs more than necessary without careful configuration. Mitigated by Turborepo's affected-package
  detection, configured at M0 rather than later.
- The repository grows large over years.

## Reversibility

- **Cost to reverse:** medium
- **How:** `git subtree split` extracts a package with its history. Straightforward precisely
  because package boundaries were enforced from the start.
- **Point of no return:** none.

## Review triggers

- A contributor should have access to some parts but not others — **the strongest trigger**
- Clean CI exceeds 15 minutes after caching and affected-detection are properly configured
- A component needs a fundamentally different toolchain
- Repository exceeds 1 GB or clone exceeds two minutes
