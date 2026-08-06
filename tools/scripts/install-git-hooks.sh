#!/usr/bin/env bash
#
# Install local git hooks.
#
# ── What this is, and what it is NOT ────────────────────────────────────────
#
# This is a STOPGAP, not branch protection. GitHub Free does not allow branch
# protection or rulesets on private repositories, so until the repository is
# either public or on GitHub Pro, there is no server-side enforcement.
#
# A local hook is bypassable with `git push --no-verify`. Anyone determined to
# skip it can.
#
# It is still worth installing, because it addresses the threat that actually
# matters here: an AI assistant running in the owner's terminal taking the fast
# path — pushing straight to main because it is quicker and the branch permits
# it. An assistant hitting this hook stops and reports the block rather than
# reaching for --no-verify, because the hook explains why it exists.
#
# It does NOT protect against a deliberate bypass, and it must not be mistaken
# for the real thing. See docs/runbooks/branch-protection.md
#
# Reference: docs/01-bible/32-branch-strategy.md

set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
hooks="$root/.git/hooks"

[ -d "$root/.git" ] || { echo "Not a git repository: $root" >&2; exit 1; }

mkdir -p "$hooks"

# ── pre-push: refuse direct pushes to main ──────────────────────────────────

cat > "$hooks/pre-push" <<'HOOK'
#!/usr/bin/env bash
# Installed by tools/scripts/install-git-hooks.sh — do not edit here.
set -uo pipefail

protected=main
current="$(git rev-parse --abbrev-ref HEAD)"

if [ "$current" = "$protected" ]; then
  cat >&2 <<'MSG'

  ✗ Direct push to main is not allowed.

  Every change goes through a pull request — including one-line fixes, and
  including the owner's own changes. The pull request IS the approval
  mechanism this project is built around (ADR-0014).

  Instead:

      git switch -c fix/short-description
      git push -u origin fix/short-description
      gh pr create

  This is a LOCAL hook, not server-side protection. GitHub Free does not
  allow branch protection on private repositories. If you are seeing this
  and believe you should override it, that belief is worth a moment's
  thought first — see docs/runbooks/branch-protection.md

MSG
  exit 1
fi

exit 0
HOOK

chmod +x "$hooks/pre-push"

# ── commit-msg: Conventional Commits ────────────────────────────────────────

cat > "$hooks/commit-msg" <<'HOOK'
#!/usr/bin/env bash
# Installed by tools/scripts/install-git-hooks.sh — do not edit here.
set -uo pipefail

subject="$(head -1 "$1")"

# Ignore merges, reverts, and fixups
case "$subject" in
  Merge*|Revert*|fixup!*|squash!*) exit 0 ;;
esac

pattern='^(feat|fix|docs|refactor|test|chore|perf|build|ci|revert|amend)(\([a-z0-9._/-]+\))?!?: .+'

if ! printf '%s' "$subject" | grep -qE "$pattern"; then
  cat >&2 <<MSG

  ✗ Commit subject does not follow Conventional Commits.

    got: $subject

  Expected:  <type>(<scope>): <subject in the imperative>

  Types: feat fix docs refactor test chore perf build ci revert amend

  The body should explain WHY. The diff already shows what.

MSG
  exit 1
fi

if [ "${#subject}" -gt 72 ]; then
  echo "  ! Subject is ${#subject} chars; 72 is the limit." >&2
  exit 1
fi

exit 0
HOOK

chmod +x "$hooks/commit-msg"

# ── pre-commit: secrets and formatting ──────────────────────────────────────

cat > "$hooks/pre-commit" <<'HOOK'
#!/usr/bin/env bash
# Installed by tools/scripts/install-git-hooks.sh — do not edit here.
set -uo pipefail

root="$(git rev-parse --show-toplevel)"
cd "$root"

# A commit containing a secret must never reach the remote. Once it is in
# history it is effectively permanent.
if command -v gitleaks >/dev/null 2>&1; then
  if ! gitleaks protect --staged --no-banner --redact --quiet; then
    echo "" >&2
    echo "  ✗ A secret was detected in the staged changes." >&2
    echo "    Remove it. Do not commit and clean up later — git history is forever." >&2
    echo "" >&2
    exit 1
  fi
fi

# Format and lint only what is staged
if [ -x node_modules/.bin/biome ]; then
  staged="$(git diff --cached --name-only --diff-filter=ACM | grep -E '\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc)$' || true)"
  if [ -n "$staged" ]; then
    echo "$staged" | xargs node_modules/.bin/biome check --write --no-errors-on-unmatched
    echo "$staged" | xargs git add
  fi
fi

exit 0
HOOK

chmod +x "$hooks/pre-commit"

cat <<'DONE'

Git hooks installed:

  pre-commit   secret scan (if gitleaks present) · format and lint staged files
  commit-msg   Conventional Commits, 72-char subject
  pre-push     refuse direct pushes to main

⚠  These are LOCAL and bypassable with --no-verify. They are a stopgap, not
   branch protection. GitHub Free does not allow branch protection on private
   repositories — see docs/runbooks/branch-protection.md for the real fix.

DONE
