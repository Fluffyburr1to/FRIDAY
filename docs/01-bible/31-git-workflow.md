# 31 — Git Workflow

> **Governing provisions:** Constitution Article II (Transparency), **Article III (Approval)**,
> **Article VIII (Learning)**; Manifesto Principle 8 ("she should never silently implement them"),
> Principle 2 (Transparency Above All).

---

## In plain language

Git is the system that records every change ever made to FRIDAY's code, who made it, when, and why.

For most projects the git workflow is a matter of team convenience. For FRIDAY it is something more,
and this is the chapter where your decision about self-modification becomes real:

> **The pull request is how FRIDAY asks permission to change herself.**

You said FRIDAY may propose, test, and explain — and that you approve every merge. That is exactly
what a pull request is. FRIDAY works on a branch, runs the full pipeline, writes an explanation, and
stops. Nothing reaches her running code until you click merge.

What makes this the right mechanism rather than a workaround is that it gives us, for free,
everything a purpose-built approval system would have needed:

| Requirement | What git provides |
|---|---|
| An isolated place to work | A branch |
| Independent verification | CI on the branch ([Chapter 27](27-cicd-pipeline.md)) |
| A human-readable explanation | The PR description |
| A reviewable, bounded change | The diff |
| A reversible decision | Revert the merge commit |
| A permanent record of who and why | Git history, forever |

We would have built a worse version of this. Instead we use the thing tens of thousands of
organizations already trust, and Article VIII is satisfied by mature, boring infrastructure.

---

## The model: trunk-based with short-lived branches

One long-lived branch, `main`, always releasable. All work happens on short-lived branches that
merge back quickly.

```
main  ────●────●────●────●────●────●────●──────►  always releasable
           ╲       ╱      ╲          ╱
            ●────●         ●────●───●
         feat/memory      friday/reduce-cost
         (you, 2 days)    (FRIDAY, 1 day)
```

**Why not GitFlow** (with `develop`, `release/*`, and `hotfix/*` branches): GitFlow exists to
coordinate scheduled releases across multiple teams. You are one person and FRIDAY. Its ceremony —
maintaining two long-lived branches, merging in both directions, cherry-picking hotfixes — is pure
overhead here, and it is a well-known source of merge pain.

**Why short-lived matters:** a branch open for three weeks diverges from `main` and produces a
painful merge. A branch open for two days does not. Target: **merge within 3 days, always within
7.** Larger work is decomposed, which is a discipline that also makes review real.

---

## Branch naming

| Prefix | Author | Purpose |
|---|---|---|
| `feat/` | You | New capability |
| `fix/` | You | Bug fix |
| `docs/` | You | Documentation |
| `refactor/` | You | Internal change, no behavior change |
| `chore/` | You | Dependencies, tooling, config |
| **`friday/`** | **FRIDAY** | **Anything she proposes** |
| `spike/` | Either | Timeboxed exploration; never merged |

**The `friday/` prefix is a governance control, not a naming convention.** It is what CI keys off to
apply the additional restrictions on AI-authored changes ([Chapter 27](27-cicd-pipeline.md)), and it
is what makes provenance permanently visible in the history. Five years from now, `git log` will
still show which changes FRIDAY proposed and which you wrote. Article II applied to the codebase
itself.

---

## Commits

**Conventional Commits**, enforced by commitlint.

```
<type>(<scope>): <subject>

<body — WHY, not what>

<footer — refs, breaking changes>
```

```
feat(guardian): add expiry enforcement to standing grants

Article III requires that pre-authorization be intentional and bounded.
Perpetual grants would let "the user is in command" become false over
time without any single decision making it so.

Maximums: medium 90d, high 30d. Critical cannot be fully granted.

Refs: ADR-0012
```

Rules:

1. **Subject in the imperative**, under 72 characters, no trailing period.
2. **The body explains why.** The diff shows what. A commit message that restates the diff is
   wasted.
3. **Reference the ADR** when the change implements an architectural decision.
4. **Reference the Constitution** when the change exists because a founding document requires it.
   This is unusual and valuable — it means someone reading history understands which lines are
   load-bearing.
5. **Signed commits required.** Verifies authorship; matters more once FRIDAY is a contributor.
6. **Atomic.** One logical change per commit.

Types: `feat`, `fix`, `docs`, `refactor`, `test`, `chore`, `perf`, `build`, `ci`, `revert`, and
`amend` (reserved for founding document amendments, owner only).

---

## Pull requests

### The template

Every PR answers the same questions. The template is in `.github/pull_request_template.md`.

```markdown
## What changed
<plain language — evaluable without reading code>

## Why
<the problem, or the founding-document requirement>

## Constitutional review
- [ ] **Can the user see it?**       observable in the audit trail and dashboard?
- [ ] **Can the user stop it?**      does it block for approval where required?
- [ ] **Can we replace it?**         any new vendor dependency? behind an interface?
- [ ] **Can we explain it?**         is the causal chain reconstructible?
- [ ] **Right in five years?**       long-term consequences considered?

## Risk
<what could break · what is uncertain · what was NOT tested>

## Testing
<what was added · what was run · what is deliberately untested>

## ADR
<link, or "not required, because...">
```

**The five constitutional questions appear here** — the same ones from
[Chapter 01](01-executive-summary.md) — so they get asked in the moment rather than admired in a
document. That is the entire reason they are in the template.

**The "Risk" section requires stating what is uncertain.** A PR claiming no risk is a PR that has
not been thought about. This applies to FRIDAY's PRs especially: Principle 3 says trust is earned by
admitting uncertainty, and a system that never expresses doubt about its own changes is not being
honest.

### FRIDAY's pull requests

Additional automated requirements on `friday/*`:

| Requirement | Rule |
|---|---|
| Size | ≤ 400 changed lines, ≤ 15 files |
| Forbidden paths | `packages/guardian/policies/**`, `docs/00-foundation/**`, `tests/constitutional/**`, `.github/workflows/**` — **rejected by CI**, not merely reviewed |
| Plain-language summary | Required, and written for a non-programmer |
| Uncertainty statement | Required — what she is unsure about |
| Self-approval | **Impossible** — enforced by branch protection |
| Label | `ai-authored`, applied automatically |

**A worked example of what FRIDAY's PR looks like:**

> **`friday/reduce-summarization-cost`** — `ai-authored`
>
> **What changed:** The summarization agent now uses a smaller, cheaper model for documents under
> 2,000 words, and the strong model above that.
>
> **Why:** Diagnostics found this agent accounts for 34% of monthly model spend
> (`ImprovementProposal IP-0031`, evidence: 412 invocations, events listed). The eval suite shows
> no measurable quality difference below 2,000 words across 40 scenarios.
>
> **Risk:** The 2,000-word threshold is a judgment call — I tested 1,500 and 3,000 and they
> performed similarly, so the boundary is not sharply justified. If summary quality degrades on
> dense technical documents, this is the first thing to revert.
>
> **Estimated saving:** ~$8/month.

That "risk" paragraph is what the requirement produces, and it is the difference between a change
you can evaluate and one you can only accept.

---

## Merging

**Squash merge, always.** One commit per pull request on `main`.

Why: it gives a clean, linear history where every commit on `main` is a complete, tested, reviewed
change. Reverting is one command. Bisecting to find when something broke actually works — every
commit on `main` is a state that passed CI.

The cost is losing individual commits within a branch. Accepted: intermediate commits ("wip", "fix
typo") are noise in the permanent record, and the PR retains them if anyone needs the detail.

**Rebase, never merge, to update a branch from `main`.** Keeps history linear and readable.

**Never force-push to `main`.** Never rewrite published history. Never delete a merge commit. The
history is an audit record; rewriting it is the same category of act as editing the event log.

---

## Reverting

**Reverting is normal and low-drama.** Making it easy is what makes merging safe.

```bash
git revert <merge-commit>
```

One commit, fully reversed, with a record of the reversal. FRIDAY notices the revert and files it
against the original improvement proposal — a reverted change is information about what does not
work, and it is retained so the same proposal is not made again without new evidence.

**No blame.** A revert means the change did not work. That is the system functioning correctly.

---

## Alternatives considered

### GitFlow

**Rejected** — designed for scheduled releases across coordinated teams. Two long-lived branches and
bidirectional merges are overhead with no benefit for one contributor, and a known source of merge
conflicts.

### Direct commits to `main` (no pull requests)

**Advantages:** fastest possible; no ceremony.

**Rejected** — the PR *is* the approval mechanism. Without it, FRIDAY's changes reach her running
code without your review, and your explicit decision is unimplemented. This is not close.

### Merge commits instead of squash

**Advantages:** preserves complete development history; standard in many projects.

**Rejected** — produces a tangled graph, makes bisecting unreliable (intermediate commits often do
not build), and makes reverting a multi-step operation. For a repository where clear history is an
Article II concern, linear is better.

### Rebase-and-merge (preserving individual commits linearly)

**Advantages:** linear *and* preserves granular commits.

**Rejected** because it puts commits on `main` that were never individually tested — CI runs on the
branch tip, not each commit. Squash guarantees every commit on `main` is a verified state.

### Trunk-based with no branches at all (commit directly, use feature flags)

**Advantages:** genuinely faster for experienced teams; smallest possible increments.

**Rejected** — same reason as direct commits. The branch is the isolation boundary that makes
FRIDAY's self-modification safe.

### A separate repository for FRIDAY's proposals

**Advantages:** stronger isolation of AI-authored work.

**Rejected** — adds cross-repository coordination for no additional safety. Branch protection plus
CODEOWNERS plus CI restrictions already provide the isolation, and `friday/*` branches keep
provenance visible in one history.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Every change requires a PR**, including one-line fixes. | Accepted — mitigated by fast CI and a template that is short for small changes. |
| **Squash merge loses intermediate commits.** | Accepted — clean history is worth more, and the PR retains the detail. |
| **You are the bottleneck** on every merge. | Accepted — it is your decision and it is correct. Managed by the 400-line cap keeping reviews short. |
| **Short-lived branches force decomposing large work.** | Accepted — decomposition is a feature. |
| **Conventional Commits is discipline** that will occasionally feel like paperwork. | Accepted — enforced by commitlint, and it produces a genuinely readable changelog. |
| **Signed commits require key setup.** | Accepted — one-time cost, and it matters once FRIDAY is a contributor. |

---

## Review triggers

- PRs routinely exceed 400 lines → decomposition is not happening; investigate why
- Branches routinely live longer than 7 days → work is scoped too large
- FRIDAY's PRs are merged without genuine review → the size cap or the summary requirement is failing
- Revert rate exceeds ~10% → change quality or verification is inadequate
- A second contributor joins → revisit review requirements and consider merge queues

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
