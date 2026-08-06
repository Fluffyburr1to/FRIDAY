# 27 — CI/CD Pipeline

> **Governing provisions:** Constitution Article III (Approval), Article V (Security), Article VIII
> (Learning); Manifesto Principle 6 (Architecture Is Sacred), Principle 8 (never silently
> implement), Engineering Culture ("testing over hope").

---

## In plain language

CI/CD is the automated process that checks every proposed change and turns approved changes into
something that runs.

For most projects this is a convenience — it catches mistakes before they reach users. For FRIDAY it
is something more, and this is the point worth understanding:

> **The CI pipeline is the mechanism that makes FRIDAY's self-modification safe.**

You decided that FRIDAY may write her own code but you approve every merge. That decision needs an
enforcement mechanism, and the pipeline is it. When FRIDAY proposes a change, the pipeline is what
independently verifies her work before you see it. It is the difference between "FRIDAY says the
tests pass" and "the tests pass."

That reframes what the pipeline is for. It is not developer convenience. It is the **verification
layer of the approval system**, applied to code instead of to actions — the same Article III
principle, one level up.

---

## Recommendation

**GitHub Actions**, with a fast pull-request pipeline, a slower main-branch pipeline, and a manual
release process. Every stage is required; none can be skipped.

### The pull request pipeline — the gate

Runs on every PR, from you or from FRIDAY. Must be entirely green before merge is possible.

```
  ┌─ Stage 1 · FAST (< 2 min) ──────────────────────────┐
  │  Biome lint + format         · type errors           │
  │  TypeScript typecheck        · secret scan (gitleaks)│
  │  dependency-cruiser          · commit message format │
  │       ↳ architecture boundary violations             │
  └──────────────────────┬───────────────────────────────┘
                         ▼  fail fast — nothing below runs
  ┌─ Stage 2 · CORRECTNESS (< 8 min) ───────────────────┐
  │  Unit tests (Vitest, affected packages only)         │
  │  Integration tests                                   │
  │  Connector contract tests                            │
  │  ★ Constitutional test suite                         │
  │  Database migration up-and-verify                    │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─ Stage 3 · SECURITY (< 5 min) ──────────────────────┐
  │  pnpm audit  ·  Semgrep  ·  CodeQL                   │
  │  License compliance  ·  new-dependency review flag   │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─ Stage 4 · BUILD & E2E (< 10 min) ──────────────────┐
  │  Build all packages · Playwright · accessibility     │
  │  Bundle size budget · Tauri build (macOS)            │
  └──────────────────────┬───────────────────────────────┘
                         ▼
  ┌─ Stage 5 · AGENT EVALS (only if agents/prompts changed)│
  │  Scored scenario suite; must not regress              │
  └──────────────────────┬───────────────────────────────┘
                         ▼
                   ✅ READY FOR YOUR REVIEW
                   (merge still requires your approval)
```

### The constitutional test suite

This is FRIDAY's most distinctive CI stage and the one I would protect most fiercely.

A dedicated test suite asserts that the founding documents' guarantees hold. Not that features work
— that **the Constitution is enforced by the code**.

| Test | Asserts |
|---|---|
| No unaudited action | Every action above `low` produces an audit event |
| No unapproved consequence | No `high`+ action executes without an approval record |
| No `critical` by standing grant | `critical` always requires live confirmation |
| No perpetual grants | Every standing grant has an expiry |
| No agent self-classification | Risk class comes only from Guardian policy |
| No ambient authority | Agents have no network, filesystem, or credential access |
| No undeclared egress | Requests to non-allowlisted hosts are blocked |
| No secrets on disk | No credential value in DB, logs, or build artifacts |
| No memory without provenance | Every memory has a `source_event_id` |
| Audit immutability | `UPDATE`/`DELETE` on `events` fails |
| Fail-closed budgets | Exhausted budget stops work; never proceeds |
| Timeout means denied | An expired approval never auto-grants |
| Self-modification is desktop-only | Mobile approval of `self_modification` is rejected |

**These tests can only be changed by you.** They are protected by CODEOWNERS, and FRIDAY's
Engineering department is forbidden from proposing changes to them. A system that can weaken its own
constitutional tests is not constrained by them.

If one of these fails, the correct response is never to adjust the test.

---

## Branch protection

`main` is protected. Configured at Milestone 0, before FRIDAY can propose anything.

| Rule | Setting |
|---|---|
| Direct push to `main` | **Blocked**, including for the owner |
| Required status checks | All stages |
| Required reviews | 1 — and FRIDAY cannot review her own PR |
| Required review from CODEOWNERS | On protected paths |
| Dismiss stale approvals on new commits | Yes |
| Require linear history | Yes (squash merge) |
| Require signed commits | Yes |
| Allow force push | **Never** |
| Allow deletion | **Never** |

**Blocking direct push to `main` even for you** is deliberate. It means the pipeline is the only path
into FRIDAY's running code, for everyone, permanently. An exception for the owner is an exception an
AI assistant will eventually use on your behalf while operating as you.

---

## AI-authored pull requests

Additional automated rules for `friday/*` branches, enforced by a CI job:

| Rule | Limit |
|---|---|
| Maximum changed lines | **400** |
| Maximum files touched | 15 |
| Protected paths | `packages/guardian/**`, `docs/00-foundation/**`, `tests/constitutional/**`, `.github/workflows/**` — **rejected outright**, not gated |
| Plain-language summary | Required in the PR body |
| Risk self-assessment | Required — what could break, what was uncertain |
| Test coverage | Must not decrease |
| Label | Automatically `ai-authored`, permanently visible |

The 400-line cap is the control that makes your approval meaningful. A 2,000-line diff will not be
genuinely reviewed — not by you, not by anyone. Forcing FRIDAY to decompose her work into reviewable
pieces is what keeps human oversight real rather than ceremonial over years.

---

## Main branch pipeline

After merge: full test suite on all packages (not just affected), performance benchmarks against
budgets, coverage reporting, nightly connector smoke tests against live services, and a changeset
version calculation.

Nightly live smoke tests run here rather than in the PR pipeline because they fail for reasons
unrelated to your code — a provider outage should not block a merge, but it should tell you the
connector needs attention.

---

## Release

**Deliberately manual.** Releases are not automatic and never will be.

```
1  You decide to release
2  Changesets computes the version and assembles the changelog
3  Tag created and pushed
4  CI builds all artifacts and produces an SBOM
5  ★ YOU SIGN — manually, with the offline key on removable media
6  Notarization submitted to Apple
7  Release published with plain-language notes
8  Update feed updated
9  FRIDAY tells you an update is available and waits for your consent
```

**Steps 5 and 9 are deliberate friction on the highest-consequence path in the system.**

The signing key can push arbitrary code to a machine holding your entire digital life. It is not on
your Mac, not in the repository, and not accessible to any automated process
([Chapter 18](18-security-model.md)). Manual signing is inconvenient exactly in proportion to how
dangerous automating it would be.

And installation requires your consent because Article III applies to FRIDAY updating herself as
much as to anything else. A system built on "never act without approval" should not upgrade itself
while you sleep.

---

## Alternatives considered

### Automatic deployment on merge to main (true continuous deployment)

**Advantages:** the industry standard for good reason — fast feedback, small increments, less
release ceremony.

**Rejected** because it conflicts with Article III. FRIDAY updating herself without your consent is
exactly the "silent implementation" Principle 8 forbids, and the fact that you approved the *merge*
does not mean you approved the *deployment* at that moment. The gap is small in practice — merge and
release are often minutes apart — but the distinction is the point.

### Self-hosted CI (Jenkins, Woodpecker, Forgejo Actions)

**Advantages:** no third-party dependency; complete control; consistent with the local-first
philosophy.

**Rejected** because it means running and maintaining CI infrastructure, which is real ongoing work
for one person. GitHub Actions is free at this scale.

**The tension is acknowledged:** GitHub is a vendor dependency in the development pipeline, which
Principle 5 disfavors. It is mitigated by the fact that CI runs standard `pnpm` scripts — everything
in the pipeline can be run locally with one command, so migrating to another CI provider is a
configuration change, not a rewrite. **Nothing in the pipeline may depend on GitHub-specific
behavior** beyond triggering; this is a standing rule.

### No CI, run tests locally

**Rejected** — it removes the independent verification that makes FRIDAY's self-modification safe. If
FRIDAY runs her own tests and reports the result, we are trusting the thing being verified.

### Trunk-based development with feature flags and no PR gate

**Advantages:** genuinely faster for experienced teams; smaller increments; less merge friction.

**Rejected** — the PR gate *is* the approval mechanism you specified. Without it, FRIDAY's changes
would reach `main` unreviewed.

### Merge queues

**Rejected as premature** — they solve contention between many concurrent PRs, which one contributor
does not have. Trivial to enable later.

---

## Trade-offs we accept

| Cost | Assessment |
|---|---|
| **Full pipeline is 15–25 minutes.** Slow for a one-line fix. | Accepted — fail-fast staging means most failures surface in under two minutes, and Turborepo caching keeps typical runs much shorter. |
| **Manual release is inconvenient** and cannot be automated. | Accepted deliberately for the signing key. |
| **GitHub is a vendor dependency** in the pipeline. | Accepted with the mitigation that everything runs locally too, and no GitHub-specific behavior is depended upon. |
| **The 400-line cap forces splitting AI work**, which is sometimes awkward. | Accepted — splitting is what makes review real. |
| **Constitutional tests will occasionally block legitimate changes.** | Accepted — that is what a constitution does. The response is an ADR and a deliberate amendment, never adjusting the test to pass. |
| **Free-tier CI minutes are finite.** | Accepted — well within limits at this scale; monitored. |

---

## Review triggers

- Pipeline exceeds 30 minutes → parallelize or split
- CI minutes approach the free tier limit → consider self-hosted runners
- A constitutional test is proposed for modification → **stop and think very hard**; requires an ADR
  and owner sign-off
- Flaky tests appear → fix or delete immediately; a flaky gate is not a gate
- A second contributor joins → enable merge queues, revisit review requirements

---

## Document history

| Version | Date | Change |
|---|---|---|
| 1.0 | 2026-08-06 | Initial ratification |
