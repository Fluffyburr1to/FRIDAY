# 32 — Branch Strategy

> **Governing provisions:** Constitution Article II (Transparency), Article III (Approval), Article
> VII (Reliability); Manifesto Principle 6 (Architecture Is Sacred).

---

## In plain language

[Chapter 31](31-git-workflow.md) settled *how* changes are proposed and accepted. This chapter is
the narrower operational question: what branches exist, what rules protect them, and what happens
when something urgent breaks.

The short version: **there is one permanent branch, `main`, and it is always in a state you could
install and use.** Everything else is temporary and short-lived.

The reason for one permanent branch rather than several is worth stating, because the alternative is
very common. Systems with a `develop` branch alongside `main` are maintaining two versions of the
truth, and they must be kept in sync forever, in both directions. For one person, that is
bookkeeping with no payoff. The purpose `develop` serves — a place to accumulate changes before a
release — is served here by the fact that `main` is always releasable and releases are simply tags
on it.

---

## The branches

| Branch | Lifetime | Protected | Purpose |
|---|---|---|---|
| **`main`** | Permanent | **Yes, strictly** | The truth. Always releasable. |
| `feat/*`, `fix/*`, `docs/*`, `refactor/*`, `chore/*` | Days | No | Your work |
| **`friday/*`** | Days | No, but CI-restricted | FRIDAY's proposals |
| `spike/*` | ≤ 5 days | No | Timeboxed exploration. **Never merged.** |
| `hotfix/*` | Hours | No | Emergency fixes (see below) |
| `release/*` | **Does not exist** | — | Not needed; releases are tags |

### `spike/*` is never merged

A spike is exploration: try an approach, learn whether it works, throw it away. The knowledge goes
into an ADR or an RFC; the code does not go into `main`.

This rule exists because exploratory code is written without tests, without error handling, and
without the standards in [Chapter 30](30-coding-standards.md). Merging it means those shortcuts
become permanent, and the person who merges it always intends to clean it up later. Spikes are
deleted after five days, automatically.

---

## `main` protection

Configured at Milestone 0, before FRIDAY exists as a contributor.

| Rule | Setting | Why |
|---|---|---|
| Direct push | **Blocked for everyone, including you** | The pipeline must be the only path in |
| Required checks | All CI stages green | Independent verification |
| Required approvals | 1 | Your approval gate |
| Self-approval | **Blocked** | FRIDAY cannot approve her own work |
| CODEOWNERS review | Required on protected paths | Guardian, foundation docs, constitutional tests |
| Stale approval dismissal | On new commits | You approved *that* diff, not a later one |
| Linear history | Required | Bisecting works; history is readable |
| Signed commits | Required | Authorship verification |
| Force push | **Never** | The history is an audit record |
| Branch deletion | **Never** | — |
| Conversation resolution | Required before merge | Questions get answered |

**Blocking your own direct push is the rule most likely to be questioned**, so: it exists because an
AI assistant operating in your terminal, as you, can push to `main`. If the branch permits it, then
"every change is reviewed" depends on an assistant choosing not to take the shortcut. If the branch
forbids it, the guarantee is structural. The inconvenience is a few seconds per change.

**Stale approval dismissal** matters more than it seems. You approved a specific diff. If new
commits arrive after your approval, the thing you approved is not the thing that would merge. This
is Article III applied precisely — consent is to a specific act, not to a general direction.

---

## CODEOWNERS

```
# Everything defaults to the owner
*                               @tyler

# Constitutional and safety-critical — never delegable
/docs/00-foundation/            @tyler
/packages/guardian/             @tyler
/packages/guardian/policies/    @tyler
/tests/constitutional/          @tyler
/packages/model-router/         @tyler
/packages/contracts/            @tyler
/.github/workflows/             @tyler
/infra/                         @tyler
/CODEOWNERS                     @tyler
```

Everything is owned by you today. The file exists now because it is the mechanism that will matter
when it is not — and because it makes the safety-critical paths visible as a list. A contributor
(human or AI) reading this file learns immediately which parts of FRIDAY are load-bearing.

The Guardian's `policies/` directory is listed separately from `guardian/` deliberately: even if
Guardian *code* review were ever delegated, the *policies* — the rules that decide what requires
your approval — never would be.

---

## Hotfixes

Something is broken badly enough that waiting for the normal process causes harm.

```
1  Assess     Is this genuinely urgent, or does it just feel urgent?
              Genuinely urgent = data loss, security, or FRIDAY unusable.
2  Branch     hotfix/<short-description> from main
3  Fix        The minimum change. Nothing else. No refactoring.
4  Test       Full CI. ★ NOT SKIPPED — see below.
5  Review     Your approval, expedited but real.
6  Merge      Squash to main.
7  Release    Immediate, with signing, as normal.
8  Follow up  Within 48 hours: an incident note in docs/runbooks/,
              a regression test, and a root-cause fix if the hotfix
              was a patch rather than a cure.
```

**CI is never skipped, even for a hotfix.** This is the rule that will be most tempting to break at
2am, and it is the one that most needs to hold.

The reasoning is concrete: hotfixes are written under time pressure by someone stressed, which is
exactly the condition under which a change breaks something unrelated. The pipeline takes 15–25
minutes. A hotfix that makes things worse costs far more than that. If FRIDAY is unusable, she is
unusable for 25 more minutes; if the hotfix corrupts data, that is unrecoverable.

**Safe Mode is the pressure release valve.** If FRIDAY is malfunctioning, you enter Safe Mode —
kernel and dashboard only, no agents, no connectors, no autonomous action — which stops the harm
immediately while the fix goes through the normal process
([Chapter 34](34-disaster-recovery.md)). This is why Safe Mode exists: **so that urgency never has
to be a reason to skip verification.**

---

## Merge conflicts

With one contributor and short branches, conflicts are rare. When they occur:

1. **Rebase onto `main`**, never merge `main` into the branch.
2. Resolve locally, run the full test suite before continuing.
3. If a conflict is large or confusing, **abandon the rebase and re-do the work** on a fresh branch
   from current `main`. Reconstructing a small change is faster and safer than untangling a bad
   rebase.
4. **FRIDAY never resolves conflicts autonomously.** If her branch conflicts, she abandons it,
   rebases from current `main`, and redoes the work. Conflict resolution requires judgment about
   intent, and a wrong resolution silently discards someone's change.

Rule 4 is a safety rule, not a capability limitation. An automated conflict resolution that quietly
drops a line of the Guardian is exactly the failure that would be hardest to notice.

---

## Tags and releases

```
v<major>.<minor>.<patch>
```

Semantic versioning, computed by Changesets. Tags are on `main` only, signed, and never moved.

**A tag is a permanent claim about what a version contained.** Moving one makes every claim about
history unreliable, which is the same category of problem as editing the audit log.

Pre-release tags (`v0.4.0-rc.1`) are used from Milestone 4 onward when a release warrants a period
of use before being declared stable.

---

## Alternatives considered

### A `develop` branch alongside `main`

**Advantages:** a staging area for accumulated changes; `main` only moves on release.

**Rejected** — two branches to keep in sync, bidirectional merges, and a well-known source of
conflict, all to solve a problem (batching changes for scheduled releases) that does not exist for
one contributor. `main` being always releasable achieves the same outcome.

### Release branches (`release/1.2`)

**Advantages:** necessary when supporting multiple versions simultaneously — backporting security
fixes to old releases while `main` moves on.

**Rejected** because there is exactly one installation of FRIDAY and it runs the current version.
**Would become necessary** if FRIDAY is ever distributed to people who cannot upgrade immediately —
noted as a review trigger.

### Environment branches (`staging`, `production`)

**Rejected** — an antipattern even in larger systems. It conflates "what code exists" with "what is
deployed where," which is a deployment concern ([Chapter 33](33-deployment-strategy.md)), not a
branching one. Deployment is driven by tags.

### Long-lived feature branches for major work

**Advantages:** big changes can be developed without destabilizing `main`.

**Rejected** — long branches diverge and produce painful merges, and the AI-assistant problem is
acute: an assistant working on a branch that has drifted from `main` produces changes that no longer
fit. Large work is decomposed into small merges behind a feature flag instead.

### No branch protection (trust the process)

**Rejected** — the protection is what makes the process real rather than aspirational, particularly
when an AI assistant is operating with your credentials.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **You cannot push directly to `main`,** even for a typo fix. | Accepted — the guarantee has to be structural, not conventional. |
| **Full CI on hotfixes costs 15–25 minutes** during an incident. | Accepted, and mitigated by Safe Mode stopping harm immediately. This rule is worth defending under pressure. |
| **No `develop` means `main` must always be releasable**, which is discipline. | Accepted — it is the discipline that makes releases boring. |
| **Feature flags instead of long branches** add code complexity. | Accepted — flags are removable; merge conflicts compound. |
| **Spikes are thrown away**, which feels wasteful. | Accepted — the knowledge is kept in an ADR; the untested code is not. |
| **Stale approval dismissal means re-reviewing** after any change. | Accepted — you approved a specific diff, and that is what approval means. |

---

## Review triggers

- Multiple FRIDAY versions must be supported simultaneously → introduce release branches
- Merge conflicts become frequent → branches are living too long
- Hotfixes occur more than ~once a quarter → quality or testing problem upstream
- A second contributor joins → revisit CODEOWNERS and approval requirements
- CI duration makes the no-skip hotfix rule genuinely untenable → optimize CI, do not weaken the rule

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
