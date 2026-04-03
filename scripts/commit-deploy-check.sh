#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
cd "$REPO_ROOT"

if [[ "${ZOOK_SKIP_COMMIT_DEPLOY_CHECK:-0}" == "1" ]]; then
  echo "[commit-check] skipped because ZOOK_SKIP_COMMIT_DEPLOY_CHECK=1"
  exit 0
fi

resolve_env_file() {
  if [[ -n "${ZOOK_COMMIT_CHECK_ENV_FILE:-}" ]]; then
    printf '%s\n' "${ZOOK_COMMIT_CHECK_ENV_FILE}"
    return 0
  fi

  local candidate
  for candidate in \
    "$REPO_ROOT/deploy_configs/local.env" \
    "$REPO_ROOT/deploy_configs/dev.env" \
    "$REPO_ROOT/deploy_configs/online.env"
  do
    if [[ -f "$candidate" ]]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

BASE_ENV_FILE="$(resolve_env_file || true)"
if [[ -z "$BASE_ENV_FILE" ]]; then
  echo "[commit-check] no runtime env file found." >&2
  echo "[commit-check] set ZOOK_COMMIT_CHECK_ENV_FILE or create deploy_configs/local.env." >&2
  exit 1
fi

APP_ENV_FILE="${ZOOK_COMMIT_CHECK_APP_ENV_FILE:-$BASE_ENV_FILE}"
BRANCH_NAME="$(git branch --show-current 2>/dev/null || true)"
if [[ -z "$BRANCH_NAME" ]]; then
  BRANCH_NAME="main"
fi

SLOT_NAME="${ZOOK_COMMIT_CHECK_SLOT:-commit-check}"
API_PORT="${ZOOK_COMMIT_CHECK_PORT:-3120}"
ADMIN_PORT="${ZOOK_COMMIT_CHECK_ADMIN_PORT:-3121}"
TMP_ENV_FILE="$(mktemp "${TMPDIR:-/tmp}/zook-commit-check.env.XXXXXX")"
trap 'rm -f "$TMP_ENV_FILE"' EXIT

cp "$BASE_ENV_FILE" "$TMP_ENV_FILE"
{
  printf '\nPORT=%s\n' "$API_PORT"
  printf 'ADMIN_HOST_PORT=%s\n' "$ADMIN_PORT"
  printf 'ADMIN_CONTAINER_PORT=%s\n' "$ADMIN_PORT"
} >> "$TMP_ENV_FILE"

echo "[commit-check] running local deployment verification"
echo "[commit-check] branch=${BRANCH_NAME} slot=${SLOT_NAME} apiPort=${API_PORT} adminPort=${ADMIN_PORT}"
echo "[commit-check] env=${BASE_ENV_FILE}"

DEPLOY_ARGS=(
  python3
  build_scripts/build_and_push_docker.py
  --branch "$BRANCH_NAME"
  --skip-git-sync
  --allow-dirty
  --slot "$SLOT_NAME"
  --env-file "$TMP_ENV_FILE"
  --app-env-file "$APP_ENV_FILE"
)

if [[ "${ZOOK_COMMIT_CHECK_DRY_RUN:-0}" == "1" ]]; then
  DEPLOY_ARGS+=(--dry-run)
fi

"${DEPLOY_ARGS[@]}"
