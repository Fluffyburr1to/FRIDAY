# packages/ — The Shared Machinery

Libraries. Things that are *imported*, never *run*.

If it has an entry point and a process lifecycle, it belongs in [`apps/`](../apps/). If it is
imported by something else, it belongs here.

---

## The rules

| # | Rule | Enforced by |
|---|---|---|
| 1 | **A package may never import from `apps/`, `departments/`, or `connectors/`.** | `dependency-cruiser` |
| 2 | **Only `src/index.ts` is importable.** Everything else in `src/` is private. | lint rule |
| 3 | **`contracts` imports nothing internal.** It is the root of the dependency graph. | `dependency-cruiser` |
| 4 | **Only `storage` opens the database.** | `dependency-cruiser` |
| 5 | **Only `model-router` imports an AI vendor SDK.** | `dependency-cruiser` |
| 6 | **Only `guardian` decides whether an action is permitted.** | review + constitutional tests |

Rule 1 is what keeps the kernel independent of everything built on top of it. A package that knows
about a specific department has stopped being shared code.

---

## Anatomy

```
packages/<name>/
├── README.md          charter · boundaries · what does NOT belong here
├── package.json       @friday/<name>, explicit dependencies
├── tsconfig.json      extends tools/tsconfig
├── src/
│   ├── index.ts       ★ the public surface — the only importable file
│   ├── types.ts
│   ├── errors.ts      typed errors this package can produce
│   └── <internals>    freely organized, never imported externally
└── test/
    ├── unit/
    └── integration/
```

---

## The packages

★ marks architecturally load-bearing packages. Changes require an ADR and owner review, and cannot
be merged from an AI-authored branch.

**Scaffolded** means the package builds, typechecks, and runs its (empty) test suite — but exports
nothing. They exist ahead of their milestone so the workspace, the build graph, the boundary rules,
and the test harness are proven against real packages rather than against nothing. A folder with
only a README proves none of that.

| Package | Owns | Milestone | |
|---|---|---|---|
| ★ **contracts** | Every data shape in the system. Zod schemas, single source of truth. | M1 | scaffolded |
| **kernel** | Event bus, durable log, hash chain, scheduler, lifecycle | M1 | scaffolded |
| **telemetry** | Structured logging, redaction, tracing, metrics | M1 | scaffolded |
| **config** | Configuration loading, validation, precedence | M1 | scaffolded |
| **storage** | Database access, migrations, repositories, field encryption | M1 | scaffolded |
| ★ **guardian** | Policy, capabilities, risk classification, approvals | M2 |
| **audit** | Causal chain reconstruction, explanation generation | M2 |
| ★ **model-router** | Vendor-neutral AI access, sensitivity routing, budgets | M3 |
| **agent-runtime** | Agent isolation, lifecycle, budgets, mediated tools | M3 |
| **chief-of-staff** | Intent → Plan → delegation → aggregation | M3 |
| **diagnostics** | Self-checks, health, improvement proposals | M3 |
| **connector-sdk** | The contract every connector implements | M4 |
| **ui-kit** | Shared React components | M4 |
| **notifications** | Channels, urgency, quiet hours, attention budget | M4 |
| **memory** | Four-layer memory with mandatory provenance | M5 |
| **voice** | Wake word, speech-to-text, text-to-speech | M7 |
| **plugin-host** | Discovery, manifest validation, sandboxed loading | M8 |

---

## Adding a package

1. Does it belong in an existing one? Twenty focused packages is good; forty is a smell.
2. Copy the anatomy above — start from `packages/contracts`, which is the reference shape.
3. Name it `@friday/<folder-name>`.
4. Write the README **first** — the charter, and explicitly what does *not* belong in it.
5. **Add it to `references` in the root `tsconfig.json`.** A package missing from that list is never
   typechecked; `pnpm check:types` fails when the two drift apart.
6. Add its dependency rules to `.dependency-cruiser.cjs` — **and a test in
   [`tests/architecture/`](../tests/architecture/README.md) proving each one can fire.** Rules 4 and
   5 above were silently inert from Milestone 0 to Milestone 2 because nobody had checked.
7. If it changes the architecture, write an ADR first.

Step-by-step: [Working in the Monorepo](../docs/guides/how-to/working-in-the-monorepo.md).

Reference: [Chapter 03 — Repository Structure](../docs/01-bible/03-repository-structure.md).
