#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

PIDS=()
NAMES=()

log() {
  printf '[dev:stack] %s\n' "$*"
}

load_env_file() {
  local file="$1"
  if [[ -f "$file" ]]; then
    log "加载环境文件: $file"
    set -a
    # shellcheck disable=SC1090
    source "$file"
    set +a
  fi
}

discover_local_redis_url() {
  local conf
  local port
  local password

  for conf in \
    /usr/local/etc/zook-online.redis.conf \
    /usr/local/etc/zook-dev.redis.conf \
    /opt/homebrew/etc/zook-online.redis.conf \
    /opt/homebrew/etc/zook-dev.redis.conf
  do
    if [[ ! -f "$conf" ]]; then
      continue
    fi

    port="$(sed -n 's/^port[[:space:]]\{1,\}//p' "$conf" | head -n 1)"
    password="$(sed -n 's/^requirepass[[:space:]]\{1,\}//p' "$conf" | head -n 1)"

    if [[ -n "$port" && -n "$password" ]]; then
      printf 'redis://:%s@127.0.0.1:%s/0' "$password" "$port"
      return 0
    fi
  done

  return 1
}

ensure_port_free() {
  local port="$1"
  local name="$2"

  if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
    log "$name 端口 $port 已被占用，请先停掉旧进程，或临时指定新的端口。"
    return 1
  fi
}

ensure_command() {
  local command_name="$1"
  if ! command -v "$command_name" >/dev/null 2>&1; then
    log "缺少命令: $command_name"
    exit 1
  fi
}

admin_rollup_native_ok() {
  (
    cd "$ROOT_DIR/apps/admin-web"
    node -e "require('rollup/dist/native.js')"
  ) >/dev/null 2>&1
}

ensure_admin_web_dependencies() {
  if [[ ! -d "$ROOT_DIR/apps/admin-web/node_modules" ]]; then
    log "安装 Admin Web 依赖..."
    npm run admin:install
    return
  fi

  if admin_rollup_native_ok; then
    return
  fi

  log "检测到 Admin Web 的 Rollup 原生依赖缺失，正在自动修复..."
  rm -rf "$ROOT_DIR/apps/admin-web/node_modules/rollup" "$ROOT_DIR/apps/admin-web/node_modules/@rollup"
  npm run admin:install

  if ! admin_rollup_native_ok; then
    log "Admin Web 依赖自动修复失败，请手动执行 npm run admin:install 后重试。"
    exit 1
  fi
}

cleanup() {
  local exit_code=$?
  trap - EXIT INT TERM

  if [[ "${#PIDS[@]}" -gt 0 ]]; then
    log "正在停止本地服务..."
    for pid in "${PIDS[@]}"; do
      kill "$pid" 2>/dev/null || true
    done
    wait 2>/dev/null || true
  fi

  exit "$exit_code"
}

start_service() {
  local name="$1"
  shift

  (
    "$@" 2>&1 | while IFS= read -r line; do
      printf '[%s] %s\n' "$name" "$line"
    done
  ) &

  PIDS+=("$!")
  NAMES+=("$name")
}

wait_for_http() {
  local url="$1"
  local name="$2"
  local attempt

  for attempt in $(seq 1 60); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      log "$name 已就绪: $url"
      return 0
    fi
    sleep 1
  done

  log "$name 启动超时: $url"
  return 1
}

monitor_children() {
  while true; do
    local index

    for index in "${!PIDS[@]}"; do
      if ! kill -0 "${PIDS[$index]}" 2>/dev/null; then
        log "${NAMES[$index]} 已退出，正在结束其他服务..."
        return 1
      fi
    done

    sleep 1
  done
}

trap cleanup EXIT INT TERM

ensure_command npm
ensure_command curl
ensure_command lsof

load_env_file "$ROOT_DIR/local/env/dev.env"
load_env_file "$ROOT_DIR/.env.local"
load_env_file "$ROOT_DIR/deploy_configs/dev.local.env"

if [[ -z "${REDIS_URL:-}" ]]; then
  if REDIS_URL="$(discover_local_redis_url)"; then
    export REDIS_URL
    log "已从本机 Redis 配置自动推断 REDIS_URL。"
  fi
fi

export ADMIN_BASIC_AUTH_USERNAME="${ADMIN_BASIC_AUTH_USERNAME:-admin}"
export ADMIN_BASIC_AUTH_PASSWORD="${ADMIN_BASIC_AUTH_PASSWORD:-Admin123456!}"
export ADMIN_DEFAULT_APP_ID="${ADMIN_DEFAULT_APP_ID:-app_a}"
export ADMIN_BRAND_NAME="${ADMIN_BRAND_NAME:-Zook Control Room}"
API_PORT="${API_PORT:-3100}"
ADMIN_PORT="${ADMIN_PORT:-3110}"

if [[ -z "${DATABASE_URL:-}" ]]; then
  log "缺少 DATABASE_URL。请在 local/env/dev.env、deploy_configs/dev.local.env 或 .env.local 中配置。"
  exit 1
fi

if [[ -z "${REDIS_URL:-}" ]]; then
  log "缺少 REDIS_URL。请在 local/env/dev.env、deploy_configs/dev.local.env 或 .env.local 中配置。"
  exit 1
fi

ensure_port_free "$API_PORT" "API"
ensure_port_free "$ADMIN_PORT" "Admin Web"

if [[ ! -d "$ROOT_DIR/node_modules" ]]; then
  log "安装根依赖..."
  npm install --include=dev
fi

ensure_admin_web_dependencies

log "构建 Admin Web..."
npm run admin:build

log "启动 API 和 Admin Web..."
start_service api env PORT="$API_PORT" npm run dev
start_service admin env PORT="$ADMIN_PORT" ADMIN_API_PROXY_TARGET="http://127.0.0.1:$API_PORT" npm run admin

wait_for_http "http://127.0.0.1:$API_PORT/api/health" "API"
wait_for_http "http://127.0.0.1:$ADMIN_PORT/_admin/health" "Admin Web"

printf '\n'
printf '本地联调已启动\n'
printf 'API:        http://127.0.0.1:%s\n' "$API_PORT"
printf 'Admin:      http://127.0.0.1:%s\n' "$ADMIN_PORT"
printf '用户名:      %s\n' "$ADMIN_BASIC_AUTH_USERNAME"
printf '密码:        %s\n' "$ADMIN_BASIC_AUTH_PASSWORD"
printf '按 Ctrl+C 可一起停止这两个服务。\n'
printf '\n'

monitor_children
