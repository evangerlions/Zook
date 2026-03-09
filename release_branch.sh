#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <target-branch> [source-branch]" >&2
  exit 1
fi

TARGET_BRANCH="$1"
SOURCE_BRANCH="${2:-main}"
REMOTE="${REMOTE:-origin}"
PUSH_REMOTE="gitee"

if ! git rev-parse --show-toplevel >/dev/null 2>&1; then
  echo "Current directory is not inside a Git repository." >&2
  exit 1
fi

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Git worktree is not clean. Commit or stash changes first." >&2
  exit 1
fi

echo "Using remote: ${REMOTE}"
echo "Using push remote: ${PUSH_REMOTE}"
echo "Merging ${REMOTE}/${SOURCE_BRANCH} into ${TARGET_BRANCH}"

if ! git remote get-url "${PUSH_REMOTE}" >/dev/null 2>&1; then
  echo "Required push remote '${PUSH_REMOTE}' is not configured." >&2
  exit 1
fi

git fetch "${REMOTE}" --tags
git fetch "${PUSH_REMOTE}" --tags

if git show-ref --verify --quiet "refs/remotes/${PUSH_REMOTE}/${TARGET_BRANCH}"; then
  git checkout -B "${TARGET_BRANCH}" "${PUSH_REMOTE}/${TARGET_BRANCH}"
elif git show-ref --verify --quiet "refs/remotes/${REMOTE}/${TARGET_BRANCH}"; then
  git checkout -B "${TARGET_BRANCH}" "${REMOTE}/${TARGET_BRANCH}"
else
  echo "Remote branch ${REMOTE}/${TARGET_BRANCH} not found. Creating it from ${REMOTE}/${SOURCE_BRANCH}."
  git checkout -B "${TARGET_BRANCH}" "${REMOTE}/${SOURCE_BRANCH}"
fi

date_stamp="$(date '+%Y%m%d')"
max_index=0

while IFS= read -r tag_name; do
  tag_number="${tag_name#version/${date_stamp}-}"
  if [[ "${tag_number}" =~ ^[0-9]{3}$ ]]; then
    tag_value=$((10#${tag_number}))
    if (( tag_value > max_index )); then
      max_index=${tag_value}
    fi
  fi
done < <(git tag --list "version/${date_stamp}-*")

next_index="$(printf '%03d' "$((max_index + 1))")"
version_core="${date_stamp}-${next_index}"
planned_version_tag="version/${version_core}"

git merge --no-ff -m "Merge ${REMOTE}/${SOURCE_BRANCH} into ${TARGET_BRANCH}

release: ${version_core}" "${REMOTE}/${SOURCE_BRANCH}"

existing_tag="$(git tag --points-at HEAD --list 'version/*' | head -n 1)"
if [[ -n "${existing_tag}" ]]; then
  version_tag="${existing_tag}"
  echo "Reusing existing version tag on HEAD: ${version_tag}"
else
  version_tag="${planned_version_tag}"
  git tag -a "${version_tag}" -m "Release ${TARGET_BRANCH} from ${SOURCE_BRANCH}"
  echo "Created version tag: ${version_tag}"
fi

git push "${PUSH_REMOTE}" "${TARGET_BRANCH}" "${version_tag}"

echo "Release branch updated successfully."
echo "  branch: ${TARGET_BRANCH}"
echo "  source: ${SOURCE_BRANCH}"
echo "  tag:    ${version_tag}"
