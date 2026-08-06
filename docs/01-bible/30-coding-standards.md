# 30 — Coding Standards

> **Governing provisions:** Manifesto Engineering Culture ("clarity over cleverness, documentation
> over assumptions, testing over hope, security over convenience, maintainability over shortcuts"),
> Principle 6 (Architecture Is Sacred), Principle 10 (Simplicity Wins); Core Values 5, 9.

---

## In plain language

Coding standards are the rules about how code is written here. They matter more for FRIDAY than for
most projects, for a reason specific to how she is being built.

**Most of FRIDAY's code will be written by AI assistants that start every session with no memory of
the last one.** An assistant writing code in this repository next March will not remember the
conventions established today. It will read the surrounding code and imitate it.

That has a consequence worth internalizing: **consistency is self-reinforcing, and inconsistency is
self-amplifying.** If the code is uniform, each new contribution matches, and the uniformity holds
for years. If there are three different ways to handle errors in the codebase, the assistant picks
one arbitrarily, and within a year there are seven.

So the standards below are enforced by tools wherever possible. A rule that depends on someone
remembering it is a rule that will hold for about three months.

The organizing principle, straight from your Manifesto: **clarity over cleverness.** Code that is
obvious to a reader who has never seen it is worth more than code that is short, fast, or elegant.
This is not a general truth about software — it is specifically true for a codebase whose primary
readers are a non-programmer owner and a series of AI assistants with no context.

---

## Enforced automatically

If a rule can be checked by a machine, it is, and violating it fails CI.

| Rule | Tool |
|---|---|
| Formatting (all of it — indentation, quotes, semicolons, line width) | **Biome** |
| Lint rules | Biome |
| Type errors | `tsc --noEmit` |
| Architecture boundaries | **dependency-cruiser** |
| Secrets in source | **gitleaks** |
| Commit message format | commitlint |
| Missing folder README | custom CI check |
| Vendor SDK imports outside `model-router` | dependency-cruiser |
| Direct database access outside `storage` | dependency-cruiser |
| Bundle size | size-limit |

**Formatting is never discussed.** Biome decides, the pre-commit hook applies it, and no human — and
no AI assistant — spends attention on it.

---

## TypeScript

### Compiler settings

Maximum strictness. Non-negotiable, set once in `tsconfig.base.json`:

```
strict: true                        noUncheckedIndexedAccess: true
noImplicitAny: true                 exactOptionalPropertyTypes: true
strictNullChecks: true              noImplicitOverride: true
noImplicitReturns: true             noFallthroughCasesInSwitch: true
noUnusedLocals: true                verbatimModuleSyntax: true
noUnusedParameters: true            isolatedModules: true
```

`noUncheckedIndexedAccess` is the one people disable first and should not. It means
`array[0]` is typed as possibly undefined, which is *true* and which catches a genuinely common
class of crash. The friction is small; the bug class it eliminates is not.

### The `any` rule

**`any` is forbidden.** Where a type is genuinely unknown, use `unknown` and narrow it. An `any`
that must exist requires:

```ts
// eslint-disable-next-line -- <why this is unavoidable, and what guarantees safety>
```

The comment is the point. `any` disables the type system exactly where nobody has thought carefully.

### Errors: `Result`, not exceptions

```ts
type Result<T, E> = { ok: true; value: T } | { ok: false; error: E }
```

| Use | For |
|---|---|
| **`Result`** | Anything that can fail as part of normal operation — network calls, validation, permission denials, missing data |
| **`throw`** | Genuine bugs. States that should be impossible. Programmer error. |

**Why this matters here specifically.** An exception is invisible in a function signature — you
cannot tell from `sendEmail(...)` that it might throw, and neither can an AI assistant. A `Result`
return type makes failure part of the contract, and the compiler forces the caller to handle it.

Article VII wants failures to be "predictable, understandable, and recoverable." A failure mode
encoded in the type system is all three. One hidden in a `throw` is none of them.

**Every error is typed** and carries a `code`, a plain-language `message`, and a `correlationId`.

### Types over comments

```ts
// avoid
function schedule(when: string, who: string, urgent: boolean)

// prefer
function schedule(input: {
  when: ZonedDateTime
  attendees: PersonId[]
  urgency: Urgency          // a union, not a boolean
})
```

Named object parameters rather than positional ones, always, beyond two arguments. `schedule(x, y,
true)` requires reading the signature to understand; `schedule({ urgency: 'high' })` does not. This
is a small rule that pays out constantly in a codebase read by people without context.

**Booleans are suspect as parameters.** A boolean parameter almost always wants to be a union type
with named cases.

### Validate at boundaries

Every value entering FRIDAY from outside — an API request, a model response, a connector reply, a
config file, a database row of JSON — is validated with Zod at the boundary.

Inside the boundary, types are trusted and validation is not repeated. Validating everywhere is slow
and creates the impression that types are unreliable, which erodes the discipline that makes them
reliable.

---

## Structure

### File organization

Files under 300 lines. Functions under 50. These are guidelines with teeth: exceeding them is a
review conversation, not an automatic failure, because occasionally a 400-line file is genuinely the
clearest option.

The reason is specific to AI-assisted work: an assistant asked to modify a 1,200-line file must hold
the whole thing in context and frequently rewrites more than it should. Small files produce small,
reviewable diffs.

### Public surfaces

Every package exposes exactly one entry point: `src/index.ts`. Everything else is private by
convention and by lint rule. This is what makes a package genuinely replaceable — consumers depend
on a declared surface, not on internal structure.

### Naming

| Thing | Convention |
|---|---|
| Files | `kebab-case.ts` |
| React components | `PascalCase.tsx` |
| Types, interfaces, classes | `PascalCase` |
| Functions, variables | `camelCase` |
| Constants | `SCREAMING_SNAKE_CASE` |
| Booleans | `is`/`has`/`should`/`can` prefix |
| Async functions | verb phrases; no `Async` suffix |
| Event handlers | `handle<Event>` |
| Zod schemas | `<Name>Schema`, type as `<Name>` |

**Names say what, not how.** `getUserPreferences()` not `fetchUserPreferencesFromSqliteCache()` —
the second becomes a lie the moment the implementation changes, and it will.

---

## Comments

The rule: **comments explain *why*, never *what*.**

```ts
// Bad — the code already says this
// increment the counter
counter++

// Good — this cannot be inferred from the code
// Gmail's API returns 429 without Retry-After on quota exhaustion (not rate
// limiting), so we back off much harder here than the generic retry policy would.
const backoffMs = baseBackoff * 8
```

Required comments:

- **Every exported function**: TSDoc with purpose, parameters, return, and possible errors
- **Every non-obvious decision**: why this way and not the obvious way
- **Every workaround**: what is being worked around, with a link if there is an issue
- **Every constitutional constraint**: `// Article III: this must block for approval` — so the next
  person, or the next AI, understands that a line is load-bearing rather than incidental

That last category is unusual and important. A future contributor optimizing a function has no way
to know that a particular check exists because the Constitution requires it — unless it says so.

**Forbidden:** commented-out code (git remembers), `TODO` without an issue reference, and comments
that restate the code.

---

## Asynchronous code

- `async`/`await` always. No raw `.then()` chains.
- **Every promise is awaited or explicitly marked** `void promise` with a comment. Floating promises
  swallow errors silently and are enforced by lint.
- `Promise.all` for independent work; sequential `await` only when there is a real dependency.
- **Every external call has a timeout.** No unbounded waits, ever.
- `AbortSignal` threaded through cancellable operations.

---

## Security rules in code

| Rule | Why |
|---|---|
| No string concatenation for SQL — parameterized queries only | Injection |
| No `eval`, no `new Function`, no dynamic `require` | Code injection; also blocks a plugin escape |
| No secrets in code, config committed to git, or error messages | [Chapter 18](18-security-model.md) |
| No `console.log` — use the logger, which redacts | Accidental data leaks |
| Crypto from Node's `crypto` or a vetted library — **never hand-rolled** | You will get it wrong |
| Every random value for security uses `crypto.randomUUID`/`randomBytes` | `Math.random` is predictable |
| No `process.env` outside `packages/config` | One validated place for configuration |

---

## The AI contributor rules

`CLAUDE.md` at the repository root contains standing instructions read at the start of every AI
session. It exists because an assistant that has not read the standards will invent its own.

Core instructions:

1. Read the founding documents and this chapter before writing code.
2. **Match the surrounding code.** When in doubt, imitate the nearest similar file rather than
   introducing a new pattern.
3. Never add a dependency without asking.
4. Never modify `docs/00-foundation/`, `packages/guardian/policies/`, or
   `tests/constitutional/`.
5. Never weaken a test to make it pass.
6. Every change includes tests.
7. If a change requires an architectural decision, write an ADR first and stop.
8. State uncertainty explicitly rather than guessing.
9. Keep pull requests under 400 lines.

Rule 2 is the one that matters most for long-term coherence, and rule 5 is the one that matters most
for safety.

---

## Alternatives considered

### ESLint + Prettier instead of Biome

**Advantages:** far larger plugin ecosystem, more rules, the industry default.

**Rejected** on speed (Biome is roughly 10–20× faster, which matters for pre-commit hooks) and on
configuration burden — ESLint's ecosystem requires maintaining a config that breaks on major
versions. The one thing we lose, custom architectural rules, is covered better by dependency-cruiser
anyway.

### Exceptions instead of `Result`

**Advantages:** more idiomatic JavaScript; less verbose; no wrapping.

**Rejected** because exceptions are invisible in signatures. For a codebase where the reader
frequently has no context, making failure part of the type is worth the verbosity. This is the
standard most likely to be questioned and I would defend it.

### Functional programming style (fp-ts, Effect)

**Advantages:** genuinely powerful; excellent error handling; strong composition guarantees.
`Effect` in particular would give us `Result`, dependency injection, and structured concurrency in
one coherent system.

**Rejected** on learning curve and — decisively — on AI assistant accuracy. Assistants write
substantially worse `Effect` code than plain TypeScript, because there is far less of it in the
world. Clarity over cleverness, applied to the tools themselves.

### Object-oriented style with classes and inheritance

**Rejected as the default.** Classes are used where there is genuine encapsulated state (the event
bus, the plan engine); functions and plain data elsewhere. Inheritance is avoided entirely in favor
of composition — deep hierarchies are hard to follow without full context, which is precisely the
situation here.

### Looser TypeScript settings for velocity

**Rejected** — the strict settings are what catch AI assistants' mistakes before you see them. That
is the single highest-value property of the type system in this project.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **`Result` types are more verbose** than throwing. | Accepted — explicit failure handling is worth the characters. |
| **Strict TypeScript is occasionally frustrating**, especially `noUncheckedIndexedAccess`. | Accepted — the friction is the type system doing its job. |
| **File and function size limits sometimes force awkward splits.** | Accepted as guidelines with review discretion. |
| **Biome has fewer rules** than the full ESLint ecosystem. | Accepted — the rules we actually need are covered, and speed matters for the pre-commit loop. |
| **Named object parameters are more verbose** than positional. | Accepted — call sites become self-documenting. |
| **Mandatory TSDoc on exports is real work.** | Accepted — Core Value 9, and it is what an AI assistant reads to use a function correctly. |

---

## Review triggers

- Biome lacks a rule that matters → evaluate adding ESLint alongside for that specific rule
- AI-generated code repeatedly violates a standard → the standard is unclear or unenforced; fix
  `CLAUDE.md` or add a lint rule
- `Result` proves too burdensome in practice → reassess honestly rather than eroding it silently
- A second contributor joins → review whether standards are discoverable enough
- TypeScript releases settings that catch more → adopt

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
