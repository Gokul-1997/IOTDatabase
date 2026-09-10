#!/usr/bin/env bash
#
# Save your work and send it everywhere, in one command.
#
#   ./scripts/publish.sh "what you changed"
#
# It does three things in order, and stops at the first problem:
#
#   1. commits everything you have changed
#   2. pushes the workspace to its backup branch
#   3. publishes each folder to its own GitHub repo
#
# Step 2 runs the test suites first, because a pre-push hook is configured.
# If a test fails nothing is pushed — which is the point.

set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

MESSAGE="${1:-}"

if [[ -z "$MESSAGE" ]]; then
  echo "Say what you changed:" >&2
  echo "  ./scripts/publish.sh \"fixed the alarm dashboard\"" >&2
  exit 1
fi

BRANCH="$(git branch --show-current)"
if [[ "$BRANCH" != "monorepo" ]]; then
  # Pushing the whole workspace at a branch named Gokul would overwrite a
  # published component repo with the monorepo. The branch name is what
  # keeps those apart, so this refuses rather than guessing.
  echo "You are on branch '$BRANCH', expected 'monorepo'." >&2
  echo "Switch back with:  git checkout monorepo" >&2
  exit 1
fi

echo "──────────────────────────────────────────"
echo " 1. Saving your changes"
echo "──────────────────────────────────────────"
if [[ -z "$(git status --porcelain)" ]]; then
  echo "  nothing changed — skipping the commit"
else
  git add -A
  git status --short | sed 's/^/  /'
  git commit -q -m "$MESSAGE"
  echo "  committed $(git rev-parse --short HEAD)"
fi

echo
echo "──────────────────────────────────────────"
echo " 2. Backing up the workspace"
echo "──────────────────────────────────────────"
# The pre-push hook runs both test suites here, which is hundreds of lines
# of output nobody reads when it passes. Capture it, and show it only if
# the push actually fails — then it is the only thing you want to see.
PUSH_LOG="$(mktemp -t publish.XXXXXX)"
if git push origin monorepo > "$PUSH_LOG" 2>&1; then
  echo "  tests passed, pushed to IOTDatabase/monorepo"
  rm -f "$PUSH_LOG"
else
  echo "  PUSH FAILED — nothing was published. Output below:" >&2
  echo >&2
  tail -40 "$PUSH_LOG" >&2
  rm -f "$PUSH_LOG"
  exit 1
fi

echo
echo "──────────────────────────────────────────"
echo " 3. Publishing to the four repos"
echo "──────────────────────────────────────────"
bash scripts/sync-repos.sh | sed -n '/→/,$p' | grep -E "→|pushed|already up to date" | sed 's/^/  /'

echo
echo "Done. Everything is saved and published."
