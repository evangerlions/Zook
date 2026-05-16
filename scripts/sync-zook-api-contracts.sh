#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SUBMODULE_PATH="$ROOT_DIR/third_party/zook-api-contracts"
if [[ ! -e "$SUBMODULE_PATH/.git" ]]; then
  echo "[sync-zook-api-contracts] Missing submodule at $SUBMODULE_PATH"
  echo "[sync-zook-api-contracts] Add it first: git submodule add <api-contracts-repo-url> third_party/zook-api-contracts"
  exit 1
fi
git -C "$ROOT_DIR" submodule update --init --remote third_party/zook-api-contracts
printf '\n[sync-zook-api-contracts] Current contracts revision:\n'
git -C "$ROOT_DIR" submodule status third_party/zook-api-contracts
