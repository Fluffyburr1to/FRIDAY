# ADR-0014 — FRIDAY proposes; the owner approves every merge

- **Status:** accepted
- **Date:** 2026-08-06
- **Deciders:** Project owner
- **Related:** [Bible 31](../01-bible/31-git-workflow.md), [Bible 27](../01-bible/27-cicd-pipeline.md)

## Context

The owner wants FRIDAY to be able to build herself, and chose — when asked directly — the strictest
of the available options: she proposes, tests, and explains; the owner approves every merge.

Article VIII requires that *"recommendations should always be presented to the user before
significant changes are made."*

## Decision

FRIDAY's Engineering Department is **a normal contributor with normal contributor permissions.** She
works on a `friday/*` branch, runs the full pipeline, opens a pull request explaining what she
changed and why, and stops.

Enforced automatically:

| Rule | Limit |
|---|---|
| Size | ≤ 400 changed lines, ≤ 15 files (excluding docs and lockfiles) |
| Forbidden paths | `docs/00-foundation/`, `packages/guardian/policies/`, `tests/constitutional/`, `.github/workflows/`, `CODEOWNERS`, `CLAUDE.md` — **rejected outright** |
| Plain-language summary | Required, written for a non-programmer |
| Uncertainty statement | Required |
| Self-approval | Impossible (branch protection) |
| Label | `ai-authored`, permanent |

**Direct push to `main` is blocked for everyone, including the owner.**

## Constitutional review

- **Article VIII (Learning):** implemented by a mechanism thousands of organizations already trust,
  rather than by something invented here.
- **Article III (Approval):** the merge is the approval.
- **Article II (Transparency):** the `friday/*` prefix and the `ai-authored` label keep provenance
  visible in the history permanently.

## Alternatives considered

### Auto-approve small or "safe" changes
**Advantages.** Much faster improvement; less of the owner's time.
**Why rejected.** The owner considered and declined this when asked. The line between "low risk" and
"significant" is exactly the judgment a system should not make about its own changes.

### A sandbox where FRIDAY may change anything, with promotion gated
**Advantages.** Maximum freedom to experiment; still gated at the boundary.
**Why rejected as the model.** The branch already *is* this sandbox, with the additional benefit
that CI verifies the sandbox state independently.

### A bespoke approval system for code changes
**Advantages.** Could be tailored precisely to FRIDAY's model.
**Why rejected.** Git gives us, free, every property we would otherwise invent: isolation (branch),
independent verification (CI), a human-readable explanation (PR body), reversibility (revert), and
a permanent record of who and why. We would have built a worse version.

### No self-modification at all
**Why rejected.** The owner asked for it explicitly, and a single person cannot write every
improvement a decades-long system will want.

## Consequences

**Positive**
- Article VIII satisfied by mature, boring infrastructure.
- The owner remains genuinely in the loop, because 400-line diffs can actually be read.
- Reverting is one command, with no blame attached.

**Negative**
- The owner is a throughput bottleneck on every change. This is the point.
- The 400-line cap forces decomposing work, which is sometimes awkward — and is also a feature.
- FRIDAY cannot fix even obvious problems in the forbidden paths.

## Reversibility

- **Cost to reverse:** low technically. Any relaxation should require a new ADR, because it is a
  change to the safety model rather than to a workflow.

## Review triggers

- FRIDAY's PRs are merged without genuine review → the size cap or summary requirement is failing
- PRs routinely need splitting in ways that harm coherence
- Revert rate on AI-authored changes exceeds ~10%
- The owner wishes to relax the policy → **new ADR, not a quiet change**
