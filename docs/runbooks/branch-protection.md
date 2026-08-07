# Runbook — Configure branch protection on `main`

**When to use this:** at Milestone 0, before FRIDAY can propose anything; after restoring or
recreating the repository; or when verifying that protection has not drifted.

**Why it matters:** you decided FRIDAY may propose changes and you approve every merge. Branch
protection is what makes that **structural** rather than a habit you keep. Without it, "every change
is reviewed" depends on an AI assistant — running in your terminal, as you, with your credentials —
choosing not to take the shortcut. With it, the guarantee holds whether anyone remembers it or not.

Reference: [Chapter 32](../01-bible/32-branch-strategy.md) ·
[Chapter 27](../01-bible/27-cicd-pipeline.md) · [ADR-0014](../adr/0014-human-approval-every-merge.md)

---

## ⚠ Order matters — learned the hard way, 2026-08-07

Three things went wrong the first time this was configured. All three came from applying the
**end-state** configuration to a **day-one** repository. Read this before running anything.

### 1. Never require a status check that has never run

Branch protection was enabled with `Ready for review` required, on a repository where CI had never
executed. That produced an unbreakable deadlock: the check could not run until a pull request
merged, and the pull request could not merge until the check ran.

**Correct order:**

```
1  Push workflows to main
2  Open a PR and confirm CI actually runs and passes    ← prove it
3  THEN add the required status check                   ← require it
```

Prove, then require. Never the reverse.

### 2. `.github/workflows/` may contain ONLY workflow YAML

A `README.md` was placed in that directory to document the pipelines. **GitHub parses every file in
`.github/workflows/` as a workflow definition**, saw a broken one, and silently scheduled nothing —
no runs, no errors, three workflows still reporting `state: active`.

The symptom is maddening: the Actions tab says "no workflow yet" while `gh workflow list` shows
them all as active.

Documentation about workflows lives at [`.github/WORKFLOWS.md`](../../.github/WORKFLOWS.md).
`tools/scripts/check-docs.mjs` exempts the directory from the every-folder-needs-a-README rule, with
the reason recorded so nobody puts one back.

### 3. Required approvals must be 0 until FRIDAY exists

**GitHub does not allow anyone to approve their own pull request.** With one human contributor,
requiring 1 approval means *no pull request can ever merge* — including the owner's own.

The rule is not wrong; it was applied a year early. The approval gate exists so that **the owner
approves FRIDAY's changes**, where author and approver are genuinely different identities. It has
nothing useful to say about the owner's own pull requests.

| Phase | Required approvals | Why |
|---|---|---|
| M0 → M5 | **0** | Only one human. Self-approval is impossible; the gate would protect nothing and block everything. |
| **M6 onward** | **1** | FRIDAY becomes a contributor with her own identity. The gate now protects exactly what it was designed to. |

**This is a scheduled change, not a permanent relaxation.** Restoring it is a Milestone 6
prerequisite, listed in [Chapter 39](../01-bible/39-roadmap.md).

What stays enforced throughout, including against the owner: no direct pushes to `main`, no force
pushes, no branch deletion, linear history, and required conversation resolution.

---

## Prerequisites

- `gh` installed and authenticated (`gh auth status` shows you logged in)
- At least one push to `main` has landed, so the branch exists
- **CI has run and passed at least once** — see ordering note above
- **`CODEOWNERS` has `@OWNER` replaced with your real GitHub username** — otherwise
  owner-review rules silently do nothing

---

## Option A — Apply it with one command (recommended)

```bash
bash tools/scripts/setup-branch-protection.sh
```

The script is idempotent: safe to run repeatedly, and safe to run to verify current state.
Read it before running it — it is short, and it is worth knowing exactly what it turns on.

---

## Option B — The web UI checklist

Go to **github.com/Fluffyburr1to/FRIDAY → Settings → Branches → Add branch ruleset**
(or **Add classic branch protection rule**).

Branch name pattern: **`main`**

### Required settings

| # | Setting | Value | Why this one |
|---|---|---|---|
| 1 | **Require a pull request before merging** | ✅ On | The PR *is* the approval mechanism. Without this, nothing else matters. |
| 2 | Required approvals | **1** | Your merge approval |
| 3 | **Dismiss stale approvals when new commits are pushed** | ✅ On | You approved *that* diff. New commits mean the thing that would merge is not the thing you approved. Article III — consent is to a specific act. |
| 4 | **Require review from Code Owners** | ✅ On | Protects the Guardian, the founding documents, the constitutional tests, and the pipeline |
| 5 | **Require approval of the most recent reviewable push** | ✅ On | Blocks self-approval. FRIDAY cannot approve her own work. |
| 6 | **Require status checks to pass** | ✅ On | Independent verification |
| 7 | Required check | **`Ready for review`** | The single aggregating check from `pr.yml`. Pointing at one check means adding pipeline stages later needs no settings change. |
| 8 | **Require branches to be up to date before merging** | ✅ On | Prevents merging something never tested against current `main` |
| 9 | **Require conversation resolution before merging** | ✅ On | Questions get answered, not scrolled past |
| 10 | **Require signed commits** | ✅ On | Authorship verification — matters more once FRIDAY is a contributor |
| 11 | **Require linear history** | ✅ On | Bisecting works; every commit on `main` is a state that passed CI |
| 12 | **Do not allow bypassing the above settings** | ✅ On | ★ **See below** |
| 13 | **Allow force pushes** | ❌ Off | The history is an audit record |
| 14 | **Allow deletions** | ❌ Off | — |

### Setting 12 is the one people skip

"Do not allow bypassing" applies the rules **to you as well**, including as repository admin.

That feels wrong, and it is correct. The realistic threat is not that you would deliberately bypass
review — it is that an AI assistant operating in your terminal, with your credentials, will push
directly to `main` because it is faster and it *can*. If the branch permits it, your entire review
guarantee rests on every future assistant choosing restraint.

The inconvenience is a few seconds per change. The alternative is a guarantee that holds only on
good days.

### Then, in Settings → General

| Setting | Value | Why |
|---|---|---|
| **Allow squash merging** | ✅ Only this | One commit per PR on `main`. Reverting is one command; bisecting works. |
| Allow merge commits | ❌ Off | Produces a tangled graph and unreliable bisect |
| Allow rebase merging | ❌ Off | Puts commits on `main` that were never individually tested |
| Default commit message | **Pull request title and description** | Preserves the plain-language explanation in history |
| **Automatically delete head branches** | ✅ On | Branches are short-lived by design |

---

## Verify it worked

```bash
gh api repos/Fluffyburr1to/FRIDAY/branches/main/protection | jq '{
  reviews: .required_pull_request_reviews,
  checks: .required_status_checks.contexts,
  admins_included: .enforce_admins.enabled,
  force_push: .allow_force_pushes.enabled,
  linear: .required_linear_history.enabled
}'
```

Then prove it actually blocks you:

```bash
git commit --allow-empty -m "chore: verify branch protection"
git push origin main     # MUST be rejected
git reset --hard HEAD~1  # clean up
```

**If that push succeeds, protection is not working.** Do not proceed to Milestone 1 until it fails.

---

## Known friction, and why it is worth it

**You cannot push a one-line typo fix directly.** Correct. The guarantee has to be structural.

**Signed commits need setup.** One-time:

```bash
gh auth status                          # confirm you're logged in
git config --global gpg.format ssh
git config --global user.signingkey ~/.ssh/id_ed25519.pub
git config --global commit.gpgsign true
```

Then add that public key to GitHub as a **signing key** (Settings → SSH and GPG keys → New SSH key
→ key type: **Signing Key**). It is separate from an authentication key even if the file is the same.

**Solo, you still need a PR for everything.** Yes. It is a few extra seconds, and it means the
process is real before FRIDAY ever uses it — rather than being retrofitted under pressure at
Milestone 6.

---

## If something is wrong

| Symptom | Cause | Fix |
|---|---|---|
| `Ready for review` not offered as a status check | The workflow has never run | Open one PR, let CI run, then add the check |
| CODEOWNERS review never required | `@OWNER` placeholder still in the file, or the username is wrong | Fix `CODEOWNERS`, push, retry |
| Push to `main` still succeeds | Setting 12 is off, or you are bypassing as admin | Turn on "Do not allow bypassing" |
| Signed-commit requirement blocks every push | Signing key not registered on GitHub, or registered as auth-only | Add it as a **Signing Key** |
