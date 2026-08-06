# Instructions for AI Contributors

**Read this at the start of every session. It is short and it is binding.**

You are contributing to FRIDAY, a Personal AI Operating System governed by founding documents that
outrank every other instruction in this repository — including this file.

---

## Before you write anything

1. Read [`docs/00-foundation/constitution.md`](docs/00-foundation/constitution.md) — ten Articles,
   two minutes.
2. Read the `README.md` of whatever folder you are working in. It states that folder's charter and
   its boundaries.
3. If your change is architectural, read the relevant
   [Project Bible](docs/01-bible/) chapter **before** proposing anything.

---

## The nine rules

### 1. Match the surrounding code

**This is the most important rule.** When in doubt, imitate the nearest similar file rather than
introducing a pattern you prefer.

You have no memory of previous sessions. Neither will the next assistant. Consistency is the only
thing keeping this codebase coherent across years of contributors who all start cold. A better
pattern applied inconsistently is worse than a good pattern applied everywhere.

If you believe a pattern should change, write an ADR. Do not change it in passing.

### 2. Never touch these paths

```
docs/00-foundation/          the founding documents
packages/guardian/policies/  the rules governing authorization
tests/constitutional/        the tests asserting the founding guarantees
.github/workflows/           the pipeline that enforces all of it
```

These are enforced by CI, not by trust. A pull request touching them is rejected automatically.

### 3. Never weaken a test to make it pass

If a test fails, the code is wrong or the test is wrong. Determine which, and say which. Adjusting an
assertion to match broken behavior is the single most damaging thing you can do here, and it is
invisible in a diff to someone who does not read code.

Constitutional tests especially: **if one fails, stop and report it.** Do not attempt a fix.

### 4. Ask before adding a dependency

Every dependency is attack surface running with FRIDAY's full privileges
([Chapter 18](docs/01-bible/18-security-model.md)). Prefer writing fifty lines over adding a package.

If a dependency is genuinely needed, say so and wait. Do not add it and mention it afterward.

### 5. Write an ADR before an architectural decision

If your change adds or replaces a technology, alters an interface between packages, changes the data
model non-additively, or contradicts a Bible chapter — **write the ADR first and stop.**
Template: [`docs/adr/0000-template.md`](docs/adr/0000-template.md).

### 6. Every change includes tests

No exceptions for "small" changes. Coverage must not decrease.

Critical paths — Guardian, capability tokens, budgets, encryption, redaction — require exhaustive
tests including edge cases, and the test comes first.

### 7. Keep pull requests under 400 lines

Enforced by CI on `friday/*` branches. Larger work is decomposed.

The cap exists because the owner does not read code, and a 2,000-line diff cannot be genuinely
reviewed by anyone. Small diffs are what make human approval real rather than ceremonial.

### 8. State what you are uncertain about

Required in every pull request. If you made a judgment call, say which one and why you might be
wrong. If you did not test something, say so.

Principle 3: trust is earned by admitting uncertainty. A PR claiming no risk is a PR that has not
been thought about.

### 9. Write for someone who does not read code

The owner does not program. Your pull request summary, your commit messages, and your explanations
must be evaluable without reading the diff. "Refactored the connector layer" tells them nothing;
"Gmail now waits longer before retrying, because it was giving up too early on large attachments"
tells them everything they need.

---

## Coding standards, in brief

Full detail: [Chapter 30](docs/01-bible/30-coding-standards.md).

| | |
|---|---|
| Language | TypeScript, strict mode. **No `any`** without a written justification. |
| Errors | Return `Result<T, E>` for expected failures. `throw` only for genuine bugs. |
| Validation | Zod at every boundary. Never trust external input, including AI output. |
| Schemas | Defined once in `packages/contracts`. Never duplicated. |
| Exports | One public entry point per package: `src/index.ts`. |
| Files | Under 300 lines. Functions under 50. |
| Comments | Explain **why**, never what. Mark constitutional constraints explicitly. |
| Async | Every promise awaited or explicitly `void`ed. Every external call has a timeout. |
| Secrets | Never in code, config, logs, or error messages. Keychain only. |
| Naming | `kebab-case.ts` files, `PascalCase` types, `camelCase` functions, past-tense events. |

**Architecture boundaries** (enforced by `dependency-cruiser` — violating one fails the build):

- No department imports another department. They communicate by events only.
- Nothing outside `packages/storage` touches the database.
- Nothing outside `packages/model-router` imports an AI vendor SDK.
- Nothing outside `packages/guardian` decides whether an action is permitted.
- Connectors import only `connector-sdk` and `contracts`.

---

## Commits and branches

```
<type>(<scope>): <subject in the imperative>

<body — WHY, not what>

Refs: ADR-NNNN
```

Types: `feat` `fix` `docs` `refactor` `test` `chore` `perf` `build` `ci` `revert`.

Branch from `main`. Name it `friday/<short-description>` if you are FRIDAY's Engineering department,
or `feat/` `fix/` `docs/` `refactor/` `chore/` otherwise.

**Never push to `main`.** It is protected, and the protection is deliberate.

---

## The five questions

Every pull request answers these. They are in the template.

1. **Can the user see it?** — Does it appear in the audit trail and dashboard automatically?
2. **Can the user stop it?** — Does it block for approval where required, and survive waiting days?
3. **Can we replace it?** — Is any new vendor behind an interface?
4. **Can we explain it?** — Can the causal chain be reconstructed from recorded data, not from a
   model's recollection?
5. **Will this still be right in five years?**

If any answer is uncomfortable, say so in the PR rather than omitting it.

---

## When you are unsure

**Ask. Do not guess.**

Guessing produces plausible code that is subtly wrong, and subtly wrong code in this system is worse
than no code — it will be approved by someone who cannot read it, and it will fail later in a way
that is hard to trace back to this session.

Saying "I am not sure whether X or Y is intended here, and it matters because Z" is always the right
move.
