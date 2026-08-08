#!/usr/bin/env bash
# verify-dev-buddy-gates.sh
#
# One-shot post-deploy verification for the FrogSleep buddy-growth rollout
# on the dev backend. Checks, per capability gate, that the matching
# /api/v1/frogsleep/buddy/* routes no longer 404.
#
# Usage:
#   ./scripts/verify-dev-buddy-gates.sh \
#       --base-url https://app-dev.youwoai.net \
#       --email qa@example.com --password ***
#
#   # Or pass an existing token directly:
#   ./scripts/verify-dev-buddy-gates.sh --token "$TOKEN"
#
#   # Run from a laptop (no docker access):
#   ./scripts/verify-dev-buddy-gates.sh --token "$TOKEN" --skip-worker
#
# Exit codes:
#   0  all gate routes respond (not 404)
#   1  one or more gate routes still 404 / unreachable
#   2  usage / configuration error

set -euo pipefail

# --- defaults --------------------------------------------------------------

BASE_URL="${FROGSLEEP_BASE_URL:-https://app-dev.youwoai.net}"
TOKEN="${FROGSLEEP_TOKEN:-}"
EMAIL="${FROGSLEEP_EMAIL:-}"
PASSWORD="${FROGSLEEP_PASSWORD:-}"
SKIP_WORKER=0
SKIP_LEGACY=0
JSON_SUMMARY=0
TIMEOUT=10

# --- args ------------------------------------------------------------------

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)    BASE_URL="${2:-}"; shift 2 ;;
    --token)       TOKEN="${2:-}"; shift 2 ;;
    --email)       EMAIL="${2:-}"; shift 2 ;;
    --password)    PASSWORD="${2:-}"; shift 2 ;;
    --skip-worker) SKIP_WORKER=1; shift ;;
    --skip-legacy) SKIP_LEGACY=1; shift ;;
    --json)        JSON_SUMMARY=1; shift ;;
    --timeout)     TIMEOUT="${2:-10}"; shift 2 ;;
    -h|--help)
      sed -n '2,20p' "$0"; exit 0 ;;
    *)
      echo "unknown option: $1" >&2; exit 2 ;;
  esac
done

# --- terminal --------------------------------------------------------------

if [[ -t 1 ]]; then
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'
  C_CYAN=$'\033[36m'; C_BOLD=$'\033[1m'; C_RESET=$'\033[0m'
else
  C_RED=''; C_GREEN=''; C_YELLOW=''; C_CYAN=''; C_BOLD=''; C_RESET=''
fi

have_cmd() { command -v "$1" >/dev/null 2>&1; }

if ! have_cmd curl; then
  echo "curl is required" >&2; exit 2
fi

# --- state -----------------------------------------------------------------

declare -a FAIL_GATE_ROUTES=()
declare -a PASS_GATE_ROUTES=()
declare -a PASS_LEGACY_ROUTES=()
declare -a FAIL_LEGACY_ROUTES=()

# --- helpers ---------------------------------------------------------------

# json_get <json> <key>
# Supports dotted paths (e.g. "data.status") via jq when available; otherwise
# falls back to a grep+sed extractor that handles flat and one-level nested
# objects. Good enough for /api/health and the login endpoint.
json_get() {
  local json="$1" key="$2"
  if have_cmd jq; then
    printf '%s' "$json" | jq -r ".${key} // empty" 2>/dev/null
    return
  fi
  # fallback: walk dotted keys by progressively narrowing the JSON text
  local current="$json"
  IFS='.' read -r -a parts <<< "$key"
  local i=0
  for part in "${parts[@]}"; do
    i=$((i+1))
    if [[ $i -lt ${#parts[@]} ]]; then
      # dive into the nested object
      current=$(printf '%s' "$current" \
        | sed -E "s/.*\"${part}\"[[:space:]]*:[[:space:]]*\{/\{/" \
        | sed -E 's/^[^{]*\{/\{/')
    else
      printf '%s' "$current" \
        | grep -o "\"${part}\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
        | head -n1 \
        | sed -E "s/.*\"${part}\"[[:space:]]*:[[:space:]]*\"([^\"]*)\".*/\1/"
    fi
  done
}

http_code_for() {
  local method="$1" path="$2" token="$3"
  local args=(-sS -o /dev/null -w "%{http_code}" --max-time "$TIMEOUT" -X "$method")
  if [[ -n "$token" ]]; then
    args+=(-H "Authorization: Bearer $token")
  fi
  args+=(-H "Accept: application/json")
  if [[ "$method" == "POST" || "$method" == "PATCH" || "$method" == "PUT" ]]; then
    args+=(-H "Content-Type: application/json" -d '{}')
  fi
  args+=("${BASE_URL}${path}")
  curl "${args[@]}" 2>/dev/null || echo "000"
}

print_gate_header() {
  local gate="$1" env_var="$2" status="$3"
  local color="$C_RESET"
  case "$status" in
    open)   color="$C_GREEN" ;;
    closed) color="$C_RED" ;;
    warn)   color="$C_YELLOW" ;;
  esac
  printf '\n%s[%s]%s %s  (%s)\n' "$color" "$gate" "$C_RESET" "$1" "$env_var"
}

print_route() {
  local method="$1" path="$2" code="$3"
  local icon color
  case "$code" in
    404) icon="✗"; color="$C_RED" ;;
    000) icon="?"; color="$C_YELLOW" ;;
    401|403) icon="✓"; color="$C_CYAN" ;;   # route exists, needs auth — OK for no-token runs
    2*|4*|5*) icon="✓"; color="$C_GREEN" ;; # 2xx/4xx/5xx all mean the route mounted
    *) icon="?"; color="$C_YELLOW" ;;
  esac
  printf '  %b%-3s%b %-7s %s  ->  %s\n' "$color" "$icon" "$C_RESET" "$method" "$path" "$code"
}

record_route() {
  local method="$1" path="$2" code="$3" bucket_var="$4"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    eval "$bucket_var+=$(printf '%q ' "$method $path ($code)")"
    return 1
  fi
  eval "$bucket_var+=$(printf '%q ' "$method $path ($code)")"
  return 0
}

# --- preflight -------------------------------------------------------------

echo "${C_BOLD}FrogSleep buddy-gate verifier${C_RESET}"
echo "  target:  ${BASE_URL}"
echo "  time:    $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo ""

# 1. Health check
echo "${C_CYAN}[health]${C_RESET}"
health_json=$(curl -sS --max-time "$TIMEOUT" "${BASE_URL}/api/health" 2>/dev/null || echo '{}')
# /api/health returns { code, message, data: { status, version }, requestId }
health_top_status=$(json_get "$health_json" "code")
health_status=$(json_get "$health_json" "data.status")
health_version=$(json_get "$health_json" "data.version")
if [[ "$health_status" == "ok" || "$health_top_status" == "OK" ]]; then
  printf '  server status : %s%s%s\n' "$C_GREEN" "${health_status:-ok}" "$C_RESET"
else
  printf '  server status : %s%s%s\n' "$C_RED" "${health_status:-UNREACHABLE}" "$C_RESET"
fi
printf '  server version: %s\n' "${health_version:-<unknown>}"

# 2. Token acquisition
echo ""
echo "${C_CYAN}[auth]${C_RESET}"
if [[ -z "$TOKEN" ]]; then
  if [[ -n "$EMAIL" && -n "$PASSWORD" ]]; then
    printf '  logging in as %s ... ' "$EMAIL"
    if ! have_cmd jq; then
      echo "jq is required when using --email and --password" >&2
      exit 2
    fi
    login_body=$(jq -nc --arg e "$EMAIL" --arg p "$PASSWORD" '{account:$e,password:$p}')
    login_resp=$(curl -sS --max-time "$TIMEOUT" \
      -X POST -H "Content-Type: application/json" \
      -d "$login_body" \
      "${BASE_URL}/api/v1/frogsleep/auth/password/login" 2>/dev/null || echo '{}')
    # Login response: { code, data: { access_token, refresh_token, ... } }
    TOKEN=$(json_get "$login_resp" "data.access_token")
    if [[ -z "$TOKEN" ]]; then
      TOKEN=$(json_get "$login_resp" "data.accessToken")
    fi
    if [[ -z "$TOKEN" ]]; then
      printf '%sFAILED%s (no token in response)\n' "$C_RED" "$C_RESET"
      echo "  login response: $login_resp"
      exit 2
    fi
    printf '%sOK%s\n' "$C_GREEN" "$C_RESET"
  else
    printf '  %sno --token / --email+--password; routes will be probed without auth (401 = route exists).%s\n' "$C_YELLOW" "$C_RESET"
  fi
else
  printf '  using provided token (len=%d)\n' "${#TOKEN}"
fi

# --- gate probing ---------------------------------------------------------

probe_gate() {
  local gate="$1" env_var="$2"
  shift 2
  # remaining args: "METHOD /path" pairs
  local -a pass=()
  local -a fail=()
  local any_open=0

  # We don't know if the gate is actually enabled on the server, so we probe
  # and report what we see. A gate is "open" if at least one of its routes
  # returns non-404.
  while [[ $# -gt 0 ]]; do
    local method="$1" path="$2"; shift 2
    local code
    code=$(http_code_for "$method" "$path" "$TOKEN")
    print_route "$method" "$path" "$code"
    if [[ "$code" == "404" || "$code" == "000" ]]; then
      fail+=("$method $path -> $code")
    else
      pass+=("$method $path -> $code")
      any_open=1
    fi
  done

  local gate_status="closed"
  if (( any_open )); then
    if (( ${#fail[@]} == 0 )); then
      gate_status="open"
    else
      gate_status="warn"
    fi
  fi
  print_gate_header "$gate" "$env_var" "$gate_status"

  if (( ${#pass[@]} > 0 )); then
    PASS_GATE_ROUTES+=("${pass[@]}")
  fi
  if (( ${#fail[@]} > 0 )); then
    FAIL_GATE_ROUTES+=("${fail[@]}")
  fi

  # re-print header AFTER we've printed the children, so the grouping is
  # obvious in terminal scrollback. (We already printed above; keep it.)
  [[ "$gate_status" != "closed" ]]
}

echo ""
echo "${C_BOLD}=== capability gates ===${C_RESET}"

# Growth Hub — FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED
print_gate_header "growthHub" "FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED" "probe"
while IFS= read -r line; do
  method="${line%% *}"
  path="${line#* }"
  code=$(http_code_for "$method" "$path" "$TOKEN")
  print_route "$method" "$path" "$code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    FAIL_GATE_ROUTES+=("growthHub: $method $path -> $code")
  else
    PASS_GATE_ROUTES+=("growthHub: $method $path -> $code")
  fi
done <<'EOF'
GET /api/v1/frogsleep/buddy/hub
GET /api/v1/frogsleep/buddy/activity
EOF

# Structured Interactions — FROGSLEEP_BUDDY_INTERACTIONS_ENABLED
print_gate_header "structuredInteractions" "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED" "probe"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  method="${line%% *}"
  path="${line#* }"
  code=$(http_code_for "$method" "$path" "$TOKEN")
  print_route "$method" "$path" "$code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    FAIL_GATE_ROUTES+=("structuredInteractions: $method $path -> $code")
  else
    PASS_GATE_ROUTES+=("structuredInteractions: $method $path -> $code")
  fi
done <<'EOF'
POST /api/v1/frogsleep/buddy/shares
POST /api/v1/frogsleep/buddy/interactions
POST /api/v1/frogsleep/buddy/joint-activities
EOF

# Goals & Reports — FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED
print_gate_header "goalsAndReports" "FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED" "probe"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  method="${line%% *}"
  path="${line#* }"
  code=$(http_code_for "$method" "$path" "$TOKEN")
  print_route "$method" "$path" "$code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    FAIL_GATE_ROUTES+=("goalsAndReports: $method $path -> $code")
  else
    PASS_GATE_ROUTES+=("goalsAndReports: $method $path -> $code")
  fi
done <<'EOF'
GET /api/v1/frogsleep/buddy/goals
POST /api/v1/frogsleep/buddy/goals
GET /api/v1/frogsleep/buddy/milestones
GET /api/v1/frogsleep/buddy/weekly-reports
EOF

# Invitation Inbox — FROGSLEEP_BUDDY_INBOX_ENABLED
print_gate_header "invitationInbox" "FROGSLEEP_BUDDY_INBOX_ENABLED" "probe"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  method="${line%% *}"
  path="${line#* }"
  code=$(http_code_for "$method" "$path" "$TOKEN")
  print_route "$method" "$path" "$code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    FAIL_GATE_ROUTES+=("invitationInbox: $method $path -> $code")
  else
    PASS_GATE_ROUTES+=("invitationInbox: $method $path -> $code")
  fi
done <<'EOF'
GET /api/v1/frogsleep/buddy/notifications
GET /api/v1/frogsleep/buddy/notifications/unread-count
POST /api/v1/frogsleep/buddy/notifications/mark-all-read
EOF

# Explicit Invite Consent — FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED
print_gate_header "explicitInviteConsent" "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED" "probe"
while IFS= read -r line; do
  [[ -z "$line" ]] && continue
  method="${line%% *}"
  path="${line#* }"
  code=$(http_code_for "$method" "$path" "$TOKEN")
  print_route "$method" "$path" "$code"
  if [[ "$code" == "404" || "$code" == "000" ]]; then
    FAIL_GATE_ROUTES+=("explicitInviteConsent: $method $path -> $code")
  else
    PASS_GATE_ROUTES+=("explicitInviteConsent: $method $path -> $code")
  fi
done <<'EOF'
GET /api/v1/frogsleep/buddy/invitations
POST /api/v1/frogsleep/buddy/invitations
GET /api/v1/frogsleep/buddy/invitations/preview
EOF

# Push delivery — FROGSLEEP_BUDDY_PUSH_ENABLED
# Not a routed gate (it only flips in-worker behavior), but we surface it so
# the operator remembers whether to expect push at all.
print_gate_header "pushDelivery" "FROGSLEEP_BUDDY_PUSH_ENABLED" "probe"
if [[ -n "${APNS_KEY_ID:-}" ]]; then
  printf '  %sAPNs key configured locally (APNS_KEY_ID set); push should deliver when FROGSLEEP_BUDDY_PUSH_ENABLED=true.%s\n' "$C_GREEN" "$C_RESET"
  PASS_GATE_ROUTES+=("pushDelivery: APNS_KEY_ID set")
else
  printf '  %sAPNs key NOT configured; push will be skipped even if the gate is on.%s\n' "$C_YELLOW" "$C_RESET"
  PASS_GATE_ROUTES+=("pushDelivery: APNs key absent (push gracefully skipped)")
fi

# --- legacy regression -----------------------------------------------------

if (( SKIP_LEGACY == 0 )); then
  echo ""
  echo "${C_BOLD}=== legacy routes (regression) ===${C_RESET}"
  while IFS= read -r line; do
    [[ -z "$line" ]] && continue
    method="${line%% *}"
    path="${line#* }"
    code=$(http_code_for "$method" "$path" "$TOKEN")
    print_route "$method" "$path" "$code"
    if [[ "$code" == "404" || "$code" == "000" ]]; then
      FAIL_LEGACY_ROUTES+=("$method $path -> $code")
    else
      PASS_LEGACY_ROUTES+=("$method $path -> $code")
    fi
  done <<'EOF'
GET /api/v1/frogsleep/me
POST /api/v1/frogsleep/auth/password/login
POST /api/v1/frogsleep/auth/token/refresh
GET /api/v1/frogsleep/buddy/capabilities
GET /api/v1/frogsleep/buddy/safety-baseline
GET /api/v1/frogsleep/sleep-buddy/guardianship/status
GET /api/v1/frogsleep/focus-buddy/relationships/current
EOF
fi

# --- worker / container status --------------------------------------------

if (( SKIP_WORKER == 0 )) && have_cmd docker; then
  echo ""
  echo "${C_BOLD}=== dev slot containers ===${C_RESET}"
  # Try both possible project names; pick whichever has running containers.
  for proj in zook-dev zook; do
    if docker compose -p "$proj" ps >/dev/null 2>&1 \
       && docker compose -p "$proj" ps -q api 2>/dev/null | grep -q .; then
      printf '  project: %s\n' "$proj"
      docker compose -p "$proj" ps --format "table {{.Name}}\t{{.Status}}\t{{.Ports}}" 2>/dev/null \
        | sed 's/^/    /'
      echo ""
      echo "  worker recent logs (last 30 lines, buddy / error filter):"
      docker compose -p "$proj" logs --tail 60 worker 2>/dev/null \
        | grep -iE "buddy|milestone|notification|error|panic|FROGSLEEP_BUDDY" \
        | tail -n 15 \
        | sed 's/^/    /'
      break
    fi
  done
elif (( SKIP_WORKER == 0 )); then
  echo ""
  echo "${C_YELLOW}[worker] docker not available locally; use --skip-worker or run on the dev host.${C_RESET}"
fi

# --- summary ---------------------------------------------------------------

echo ""
echo "${C_BOLD}=== summary ===${C_RESET}"
printf '  gate routes   pass: %s%d%s   fail: %s%d%s\n' \
  "$C_GREEN" "${#PASS_GATE_ROUTES[@]}" "$C_RESET" \
  "$C_RED" "${#FAIL_GATE_ROUTES[@]}" "$C_RESET"
if (( SKIP_LEGACY == 0 )); then
  printf '  legacy routes pass: %s%d%s   fail: %s%d%s\n' \
    "$C_GREEN" "${#PASS_LEGACY_ROUTES[@]}" "$C_RESET" \
    "$C_RED" "${#FAIL_LEGACY_ROUTES[@]}" "$C_RESET"
fi

if (( ${#FAIL_GATE_ROUTES[@]} > 0 )); then
  echo ""
  echo "${C_RED}${C_BOLD}Failing gate routes:${C_RESET}"
  for entry in "${FAIL_GATE_ROUTES[@]}"; do
    printf '  %s- %s%s\n' "$C_RED" "$entry" "$C_RESET"
  done
  echo ""
  echo "Next step: on the dev server, set the matching env var(s) to true in deploy_configs/dev.env, then redeploy."
  exit 1
fi

echo ""
printf '%s%sAll buddy-growth gates are live on %s.%s\n' "$C_GREEN" "$C_BOLD" "$BASE_URL" "$C_RESET"
exit 0
