# engineering — FRIDAY Improving FRIDAY

**The department you asked for.** Milestone: **M6**

## Charter

FRIDAY proposes changes to her own code. She writes on a branch, runs the full test suite, explains
what she changed in plain language, and **stops**. You are the merge button.

Article VIII: *"recommendations should always be presented to the user before significant changes."*
Implemented by a mechanism thousands of organizations already trust — the pull request — rather than
by something invented here.

## Owns

- Reading the repository and understanding the codebase
- Turning improvement proposals into concrete changes
- Running tests and evaluations before proposing
- Adversarial self-review — a critic agent reviews before a PR is opened
- Writing pull requests with plain-language summaries and **uncertainty statements**

## May NEVER

| Forbidden | Why |
|---|---|
| Touch `packages/guardian/policies/` | A system that can change the rules governing it is not governed |
| Touch `docs/00-foundation/` | Owner only, by deliberate amendment |
| Touch `tests/constitutional/` | It cannot weaken the tests that constrain it |
| Touch `.github/workflows/` | It cannot weaken the pipeline that checks it |
| Approve its own pull request | Blocked by branch protection |
| Exceed 400 changed lines | A diff you will not read is not a diff you reviewed |
| Resolve a merge conflict autonomously | A wrong resolution silently discards someone's change |

Enforced by CI, not by trust.

## Rollout

**First four weeks: documentation and test-only pull requests.** Code changes come after the
pipeline has been observed working end to end.

Reference: [Chapter 31](../../docs/01-bible/31-git-workflow.md),
[Chapter 27](../../docs/01-bible/27-cicd-pipeline.md)
