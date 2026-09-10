#!/usr/bin/env bash
#
# Publish each part of this monorepo to its own GitHub repository.
#
# This repo stays the place work happens; the four repos below are
# published copies of one folder each. That is why this is a script and not
# a one-time migration — it is run again after every change worth shipping.
#
#   ./scripts/sync-repos.sh            push every component
#   ./scripts/sync-repos.sh backend    push just one
#   DRY_RUN=1 ./scripts/sync-repos.sh  show what would happen, push nothing
#
# How it works: for each folder it builds a commit whose tree is that
# folder's contents at the root, parented on whatever the target repo's
# Gokul branch already points at. That means
#
#   - only tracked files are published: no node_modules, no .env, no dist
#   - the target repo's existing history is preserved, never rewritten
#   - the push is a fast-forward, so it can never need --force
#
# Nothing here rewrites history, so a mistake is always recoverable by
# pushing again.
#
# ── Which branch is which ──────────────────────────────────────────────
# This workspace sits on the branch `monorepo`, and publishes to `Gokul` in
# each of the four repos. Those are deliberately different names.
#
# IOTDatabase's `Gokul` branch is the MQTT collector, not this workspace.
# When both were called Gokul, a plain `git push` from here aimed at it and
# would have put all four folders back into the MQTT repo, undoing the
# split. Renaming the local branch makes that mistake impossible rather
# than merely discouraged.

set -euo pipefail

BRANCH="${BRANCH:-Gokul}"
SSH_HOST="${SSH_HOST:-github-account2}"     # the key that owns Gokul-1997
DRY_RUN="${DRY_RUN:-}"

# folder → repository
COMPONENTS=(
  "pms-backend:IOTDatabase:MQTT collector"
  "FrontendIOT:IOTFrontend:Angular frontend"
  "Backend:IOTBackend:API server"
  "MobileApp:IOTMobile:Expo mobile app"
)

cd "$(git rev-parse --show-toplevel)"

# Publishing a dirty tree would ship a state that exists on nobody's
# machine but this one, and the commit it claims to come from would not
# match what was sent.
if [[ -n "$(git status --porcelain)" ]]; then
  echo "Working tree is not clean. Commit or stash first." >&2
  git status --short >&2
  exit 1
fi

SOURCE_SHA="$(git rev-parse --short HEAD)"
SOURCE_SUBJECT="$(git log -1 --format=%s)"

sync_one() {
  local folder="$1" repo="$2" label="$3"
  local url="git@${SSH_HOST}:Gokul-1997/${repo}.git"

  if [[ ! -d "$folder" ]]; then
    echo "  SKIP  $folder does not exist"
    return
  fi

  local files
  files="$(git ls-files "$folder" | wc -l | tr -d ' ')"
  if [[ "$files" == "0" ]]; then
    echo "  SKIP  $folder has no tracked files"
    return
  fi

  printf '  %-14s → %-13s %s tracked files\n' "$folder" "$repo" "$files"

  # The folder's tree, read in at the root rather than nested. A temporary
  # index keeps this completely separate from the working tree, so an
  # interrupted run cannot leave the checkout in a strange state.
  local tmp_index tree parent commit
  tmp_index="$(mktemp -t syncidx.XXXXXX)"
  rm -f "$tmp_index"
  tree="$(GIT_INDEX_FILE="$tmp_index" bash -c "git read-tree 'HEAD:$folder' && git write-tree")"
  rm -f "$tmp_index"

  # Whatever the target branch points at now becomes the parent, so the
  # remote's own history is kept rather than replaced.
  parent="$(git ls-remote "$url" "refs/heads/$BRANCH" 2>/dev/null | awk '{print $1}')"

  if [[ -n "$parent" ]]; then
    # Nothing to do when the content already matches — avoids a stream of
    # empty commits from re-running the script.
    if git fetch -q --depth 1 "$url" "$BRANCH" 2>/dev/null && \
       [[ "$(git rev-parse 'FETCH_HEAD^{tree}' 2>/dev/null)" == "$tree" ]]; then
      echo "         already up to date"
      return
    fi
    commit="$(git commit-tree "$tree" -p "$parent" \
      -m "Sync $label from monorepo $SOURCE_SHA

$SOURCE_SUBJECT

Published by scripts/sync-repos.sh from the $folder folder.")"
  else
    # First push into an empty repository: no parent to build on.
    commit="$(git commit-tree "$tree" \
      -m "Initial import of $label from monorepo $SOURCE_SHA

$SOURCE_SUBJECT

Published by scripts/sync-repos.sh from the $folder folder.")"
  fi

  if [[ -n "$DRY_RUN" ]]; then
    echo "         DRY RUN — would push $commit to $repo:$BRANCH"
    return
  fi

  git push -q "$url" "$commit:refs/heads/$BRANCH"
  echo "         pushed $(git rev-parse --short "$commit")"
}

echo "Publishing from $SOURCE_SHA ($SOURCE_SUBJECT)"
echo

if [[ $# -gt 0 ]]; then
  for want in "$@"; do
    found=""
    for c in "${COMPONENTS[@]}"; do
      IFS=: read -r folder repo label <<< "$c"
      # macOS ships bash 3.2, which has no ${var,,} lowercase expansion
      lc() { printf '%s' "$1" | tr '[:upper:]' '[:lower:]'; }
      if [[ "$(lc "$folder")" == "$(lc "$want")" || "$(lc "$repo")" == "$(lc "$want")" ]]; then
        sync_one "$folder" "$repo" "$label"; found=1
      fi
    done
    [[ -n "$found" ]] || echo "  unknown component: $want" >&2
  done
else
  for c in "${COMPONENTS[@]}"; do
    IFS=: read -r folder repo label <<< "$c"
    sync_one "$folder" "$repo" "$label"
  done
fi

echo
echo "Done."
