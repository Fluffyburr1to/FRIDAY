# Contributing to FRIDAY

**Everyone follows this process — the owner, human contributors, and FRIDAY herself.**

There are no exceptions, including for one-line fixes and including for the owner. The process *is*
the safety mechanism ([Chapter 31](docs/01-bible/31-git-workflow.md)); an exception for anyone is an
exception an AI assistant will eventually use while operating as them.

---

## Before your first contribution

Read, in this order:

1. [The Constitution](docs/00-foundation/constitution.md) — ten Articles. Two minutes.
2. [The Manifesto](docs/00-foundation/manifesto.md) — why FRIDAY exists.
3. [Executive Summary](docs/01-bible/01-executive-summary.md) — the architecture.
4. [Coding Standards](docs/01-bible/30-coding-standards.md) — how code is written here.
5. [`CLAUDE.md`](CLAUDE.md) — if you are an AI assistant, this is binding.

---

## The process

```
1  Is this architectural?  ──yes──►  Write an ADR first. Stop. Wait.
   │ no
   ▼
2  Branch from main
      feat/  fix/  docs/  refactor/  chore/     (you)
      friday/                                   (FRIDAY's Engineering dept)
   ▼
3  Make the change
      · match the surrounding code
      · include tests
      · update documentation in the SAME commit
   ▼
4  Verify locally
      pnpm check          lint · typecheck · test · boundaries
   ▼
5  Open a pull request
      · fill in the template completely
      · state what you are uncertain about
      · write the summary for someone who does not read code
   ▼
6  CI runs — all stages must pass
   ▼
7  Owner review and merge (squash)
```

**Target: merge within 3 days. Always within 7.** Longer branches diverge and produce painful
merges, and an AI assistant working on a stale branch produces changes that no longer fit.

---

## When an ADR is required

Write one *before* the code if your change:

- adds, removes, or replaces a technology or dependency with a large surface
- changes a public interface between packages
- changes the data model in a non-additive way
- changes security, privacy, or approval behavior
- changes an architectural boundary rule
- contradicts anything in the Project Bible
- defers a known problem deliberately

**The test:** would someone joining in two years be confused about why this is the way it is? If
yes, write one.

Template: [`docs/adr/0000-template.md`](docs/adr/0000-template.md).
Process: [Chapter 37](docs/01-bible/37-adr-process.md).

**When in doubt, write one.** They take twenty minutes and the failure mode is writing too few.

---

## The pull request

The template asks for six things. All are required.

### 1. What changed — in plain language

Written so the owner, who does not program, can evaluate it.

> ❌ "Refactored the connector retry mechanism to use exponential backoff with jitter."
>
> ✅ "Gmail now waits longer between retry attempts, and adds a small random delay so several
> retries don't all fire at once. It was giving up too early on large attachments."

### 2. Why

The problem being solved, or the founding-document requirement being implemented. Reference the
Article or Principle if one applies.

### 3. The five constitutional questions

- **Can the user see it?** Does this appear in the audit trail and dashboard automatically, or did
  someone have to remember to log it?
- **Can the user stop it?** Does it block for approval where required? Does the plan survive waiting
  three days?
- **Can we replace it?** Any new vendor dependency? Is it behind an interface?
- **Can we explain it?** Can the causal chain be reconstructed from recorded data — not from an AI
  model's account of its own past reasoning?
- **Will this still be right in five years?**

**If an answer is uncomfortable, write that.** An honest "I'm not sure this is replaceable enough"
is far more useful than a checked box.

### 4. Risk

What could break. What you are uncertain about. **What you did not test.**

A pull request claiming no risk has not been thought about. Principle 3: trust is earned by
admitting uncertainty.

### 5. Testing

What you added, what you ran, and what is deliberately untested — with the reason.

### 6. ADR reference

A link, or `not required, because <reason>`.

---

## Standards

Full detail in [Chapter 30](docs/01-bible/30-coding-standards.md). The rules that get violated most:

| Rule | Why it matters |
|---|---|
| **Match the surrounding code** | Consistency is what keeps a codebase built by forgetful contributors coherent |
| **No `any`** without written justification | It disables the type system exactly where nobody thought carefully |
| **`Result` for expected failures, `throw` for bugs** | Exceptions are invisible in a function signature |
| **Zod validation at every boundary** | Types vanish at runtime; AI output is unreliable |
| **One public entry point per package** | What makes packages replaceable |
| **Comments explain *why*** | The code already says what |
| **Mark constitutional constraints** — `// Article III: this must block` | So the next person knows the line is load-bearing |
| **Every promise awaited; every external call has a timeout** | Floating promises swallow errors silently |
| **Every folder has a README** | It is how the next contributor knows where a file goes |

Architecture boundaries are enforced by `dependency-cruiser`. Violating one fails the build with a
message naming the rule.

---

## Things you must never do

| Never | Why |
|---|---|
| **Modify `docs/00-foundation/`** | Owner only, by deliberate amendment |
| **Modify `packages/guardian/policies/`** | A system that can change the rules governing it is not governed |
| **Modify `tests/constitutional/`** | They assert the founding guarantees |
| **Weaken a test to make it pass** | Determine whether the code or the test is wrong, and say which |
| **Push directly to `main`** | Blocked, including for the owner |
| **Commit a secret** | Blocked by `gitleaks`, but check anyway |
| **Add a dependency without asking** | Every one is attack surface with full privileges |
| **Merge your own pull request** | Blocked by branch protection |

---

## Additional rules for FRIDAY's own contributions

Enforced automatically on `friday/*` branches
([Chapter 27](docs/01-bible/27-cicd-pipeline.md)):

| | |
|---|---|
| Maximum size | 400 changed lines, 15 files |
| Forbidden paths | Rejected outright, not merely flagged |
| Plain-language summary | Required |
| Uncertainty statement | Required |
| Self-approval | Impossible |
| Label | `ai-authored`, permanent |

---

## Reverting

**Reverting is normal.** It is not a failure and it carries no blame.

```bash
git revert <merge-commit>
```

Making revert easy is what makes merging safe. A reverted change is information about what does not
work, and it is recorded against the original proposal so the same idea is not re-proposed without
new evidence.

---

## Questions

If you are unsure whether something needs an ADR, whether a pattern is right, or what the owner
would want — **ask.**

Guessing produces plausible code that is subtly wrong. In a system where the reviewer does not read
code, subtly wrong is the most expensive kind of wrong.
