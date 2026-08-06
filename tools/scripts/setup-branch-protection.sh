#!/usr/bin/env bash
#
# Configure branch protection on main.
#
# This is what makes "the owner approves every merge" structural rather than a
# habit. Without it, the guarantee depends on every future AI assistant —
# running in the owner's terminal, with the owner's credentials — choosing not
# to push directly because it is faster and it can.
#
# Idempotent. Safe to run repeatedly, and safe to run just to verify state.
#
# Reference: docs/runbooks/branch-protection.md
#            docs/01-bible/32-branch-strategy.md

set -euo pipefail

REPO="${FRIDAY_REPO:-Fluffyburr1to/FRIDAY}"
BRANCH=main
CHECK="Ready for review"

say()  { printf '\n\033[1m%s\033[0m\n' "$*"; }
ok()   { printf '  \033[32m✓\033[0m %s\n' "$*"; }
warn() { printf '  \033[33m!\033[0m %s\n' "$*"; }
die()  { printf '\n\033[31m✗ %s\033[0m\n\n' "$*" >&2; exit 1; }

# ── Preflight ───────────────────────────────────────────────────────────────

say "Preflight"

command -v gh >/dev/null 2>&1 || die "gh is not installed. brew install gh"

gh auth status >/dev/null 2>&1 \
  || die "Not authenticated. Run: gh auth login"
ok "gh authenticated"

gh repo view "$REPO" >/dev/null 2>&1 \
  || die "Cannot reach $REPO. Check the name and your permissions."
ok "repository reachable: $REPO"

gh api "repos/$REPO/branches/$BRANCH" >/dev/null 2>&1 \
  || die "Branch '$BRANCH' does not exist yet. Push at least once first."
ok "branch exists: $BRANCH"

# A CODEOWNERS still containing the placeholder means every owner-review rule
# below silently does nothing — which is worse than not enabling them, because
# the settings page would claim protection that is not real.
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
if grep -q '@OWNER' "$root/CODEOWNERS" 2>/dev/null; then
  die "CODEOWNERS still contains the @OWNER placeholder.

Replace it with your real GitHub username first, or the Code Owners rules
below will be enabled but will never actually require anyone's review.

  sed -i '' 's/@OWNER/@your-username/g' CODEOWNERS"
fi
ok "CODEOWNERS has a real username"

if ! gh api "repos/$REPO/commits/$BRANCH/check-runs" --jq '.check_runs[].name' 2>/dev/null \
     | grep -qF "$CHECK"; then
  warn "Status check '$CHECK' has not run on $BRANCH yet."
  warn "It will be required anyway; GitHub accepts a check that has not run."
  warn "Open one pull request to confirm it appears."
fi

# ── Apply ───────────────────────────────────────────────────────────────────

say "Applying branch protection to $REPO@$BRANCH"

gh api -X PUT "repos/$REPO/branches/$BRANCH/protection" \
  -H 'Accept: application/vnd.github+json' \
  --input - >/dev/null <<JSON
{
  "required_status_checks": {
    "strict": true,
    "contexts": ["$CHECK"]
  },

  "enforce_admins": true,

  "required_pull_request_reviews": {
    "required_approving_review_count": 1,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "require_last_push_approval": true
  },

  "restrictions": null,

  "required_linear_history": true,
  "required_conversation_resolution": true,
  "required_signatures": true,

  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "lock_branch": false
}
JSON

ok "pull request required, 1 approval"
ok "stale approvals dismissed on new commits"
ok "Code Owners review required"
ok "self-approval blocked (require_last_push_approval)"
ok "status check required: $CHECK"
ok "branches must be up to date before merging"
ok "conversation resolution required"
ok "signed commits required"
ok "linear history required"
ok "force push and deletion blocked"
ok "ENFORCED FOR ADMINS — including you"

# ── Merge settings ──────────────────────────────────────────────────────────

say "Repository merge settings"

gh api -X PATCH "repos/$REPO" \
  -f allow_squash_merge=true \
  -F allow_merge_commit=false \
  -F allow_rebase_merge=false \
  -f squash_merge_commit_title=PR_TITLE \
  -f squash_merge_commit_message=PR_BODY \
  -F delete_branch_on_merge=true \
  -F has_wiki=false \
  -F has_projects=false >/dev/null

ok "squash merge only — one commit per PR on main"
ok "commit message taken from the PR title and body"
ok "head branches deleted automatically"

# ── Verify ──────────────────────────────────────────────────────────────────

say "Verification"

gh api "repos/$REPO/branches/$BRANCH/protection" --jq '
  "  approvals required : \(.required_pull_request_reviews.required_approving_review_count)
  dismiss stale      : \(.required_pull_request_reviews.dismiss_stale_reviews)
  code owner review  : \(.required_pull_request_reviews.require_code_owner_reviews)
  last push approval : \(.required_pull_request_reviews.require_last_push_approval)
  status checks      : \(.required_status_checks.contexts | join(", "))
  strict (up to date): \(.required_status_checks.strict)
  applies to admins  : \(.enforce_admins.enabled)
  linear history     : \(.required_linear_history.enabled)
  signed commits     : \(.required_signatures.enabled)
  force push allowed : \(.allow_force_pushes.enabled)
  deletion allowed   : \(.allow_deletions.enabled)"
'

cat <<'DONE'

Branch protection is configured.

Now prove it actually blocks you — a setting that claims protection but does
not enforce it is worse than no setting at all:

    git commit --allow-empty -m "chore: verify branch protection"
    git push origin main        # this MUST be rejected
    git reset --hard HEAD~1     # clean up

If that push succeeds, protection is NOT working. Do not start Milestone 1
until it fails.

DONE
