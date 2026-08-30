# LightTick legacy backend to Zook migration map

## 1. Purpose and source boundary

This document records the complete migration decision for the legacy backend in
`/Users/hao/Documents/project/plan/lighttick-backend`. It is an implementation
input, not a public API contract. The canonical LightTick contract will live in
`api-contracts/openapi/lighttick/**` and all runtime implementation will live in
Zook.

Migration rules:

1. Zook is the only production writer and identity owner.
2. No legacy endpoint is kept as a long-lived alias.
3. The legacy Go code is used only as product-intent, prompt, validation, and
   fallback reference.
4. Legacy handlers that returned success without persistence are not considered
   implemented behavior and must not be reproduced.
5. There is no known production LightTick dataset. Mock Flutter records and
   template responses are not migrated.

## 2. Endpoint disposition

| Legacy method and path | Legacy behavior | Canonical Zook direction | Decision |
|---|---|---|---|
| `POST /api/v1/auth/verify` | Decodes JWT payload without signature verification | Existing Zook `/api/v1/auth/*` and authenticated user endpoints | Remove; do not alias insecure verification |
| `POST /api/v1/auth/register` | Creates a standalone legacy user and token without Zook app membership semantics | Zook Common `POST /api/v1/auth/register` with `appId=lighttick` | Reuse Common Auth; require LightTick membership activation and do not import legacy users/tokens |
| `POST /api/v1/auth/login` | Authenticates against the standalone legacy user table | Zook Common `POST /api/v1/auth/login` with `appId=lighttick` | Reuse Common Auth and app-scoped membership checks; no credential migration |
| `POST /api/v1/auth/guest` | Creates an unscoped guest in the legacy user table | `POST /api/v1/lighttick/account/guest-sessions` | Replace with device-bound, expiring, LightTick-only guest identity |
| `POST /api/v1/auth/upgrade` | Converts the legacy guest row without transactional product-data transfer | `POST /api/v1/lighttick/account/upgrade` | Replace with idempotent PostgreSQL ownership migration and token revocation |
| `POST /api/v1/auth/refresh` | Rotates a legacy token without Zook session/app isolation | Zook Common `POST /api/v1/auth/refresh` with `appId=lighttick` | Reuse single-use Common refresh rotation; legacy refresh tokens are invalid |
| `POST /api/v1/auth/logout` | Revokes only the standalone legacy session | Zook Common `POST /api/v1/auth/logout` | Reuse Common session revocation; product data remains intact |
| `GET /api/v1/auth/me` | Returns the standalone legacy user shape | `GET /api/v1/lighttick/account/session` plus Common user APIs | Replace with LightTick account kind, membership, expiry, and sync cursor; do not expose legacy IDs |
| `POST /api/v1/goals` | Validates input, returns `status=created`, writes nothing | `POST /api/v1/lighttick/goals` | Rebuild with app/owner scope, persistence, version, event, change log |
| `GET /api/v1/goals` | Returns empty paged list | `GET /api/v1/lighttick/goals` | Rebuild with stable cursor and owner scope |
| `GET /api/v1/goals/{id}` | Always returns not found | `GET /api/v1/lighttick/goals/{goal_id}` | Rebuild; non-owner lookup must not disclose existence |
| `PUT /api/v1/goals/{id}` | Validates title, returns success, writes nothing | `PATCH /api/v1/lighttick/goals/{goal_id}` | Replace PUT with versioned partial update |
| `DELETE /api/v1/goals/{id}` | Returns success, writes nothing | `POST /api/v1/lighttick/goals/{goal_id}/archive` | Use lifecycle/archive; hard deletion only through account-data policy |
| `POST /api/v1/plans/month` | Calls LLM/template, validates, does not save | `POST /api/v1/lighttick/plan-runs` with `granularity=month` | Persist run and proposed plan; async result is recoverable |
| `POST /api/v1/plans/week` | Calls LLM/template, does not save | `POST /api/v1/lighttick/plan-runs` with `granularity=week` | Same run protocol; base plan/version required |
| `POST /api/v1/plans/day` | Calls LLM/template, does not save | `POST /api/v1/lighttick/plan-runs` with `granularity=day` | Same run protocol; result remains proposed until applicable |
| `GET /api/v1/plans/{id}` | Returns `not_implemented` | `GET /api/v1/lighttick/plans/{plan_id}` | Rebuild with owner scope and explicit lifecycle/version |
| `POST /api/v1/plans/replan` | Calls LLM and returns unpersisted plan | `POST /api/v1/lighttick/change-proposal-runs` | AI creates diff proposal; separate accept/reject endpoints execute it |
| `GET /api/v1/summary/weekly` | Returns all-zero placeholder | `GET /api/v1/lighttick/reviews/weekly/current` | Derive from execution facts; no placeholder success |
| `POST /api/v1/onboarding/complete` | Returns template and `goal_id=0` | `POST /api/v1/lighttick/onboarding` plus run status | Persist draft goal/profile, return recoverable generation run |
| `POST /api/v1/tasks/{id}/complete` | Returns completed without updating storage | `POST /api/v1/lighttick/tasks/{task_id}/complete` | Atomic task/event/change-log write with idempotency and version |
| `POST /api/v1/tasks/{id}/skip` | Requires reason, returns success only | `POST /api/v1/lighttick/tasks/{task_id}/skip` | Preserve controlled reason concept; persist immutable event |
| `POST /api/v1/tasks/{id}/defer` | Requires date, returns success only | `POST /api/v1/lighttick/tasks/{task_id}/defer` | Preserve schedule history; use date + timezone and version |
| `GET /api/v1/tasks/week/{weekId}` | Returns empty list | `GET /api/v1/lighttick/plans/{plan_id}/tasks` | Replace storage-shaped week endpoint with plan-scoped task query |
| `POST /api/v1/sync/push` | Marks every syntactically valid action accepted | `POST /api/v1/lighttick/sync/push` | Replace with operation IDs, payload hash, versions, per-item results |
| `GET /api/v1/sync/pull` | Returns empty changes and `not_implemented` time | `GET /api/v1/lighttick/sync/pull` | Replace with user-bound cursor, ordered upserts, tombstones |
| `POST /api/v1/review/weekly` | Calls LLM over client-supplied counts, does not save | `POST /api/v1/lighttick/review-runs` with `period=weekly` | Server derives source facts and persists run/review |
| `POST /api/v1/review/monthly` | Calls LLM over client-supplied counts, does not save | `POST /api/v1/lighttick/review-runs` with `period=monthly` | Same server-derived review protocol |
| `POST /api/v1/calendar/connect` | Returns empty OAuth URL/state stub | Future `/api/v1/lighttick/integrations/calendar/...` | Do not migrate in core-loop release |
| `GET /api/v1/calendar/callback` | Returns placeholder success | Future platform integration callback | Do not migrate in core-loop release |
| `DELETE /api/v1/calendar` | Returns disconnected without state | Future calendar integration | Do not migrate in core-loop release |
| `GET /api/v1/calendar/status` | Returns disconnected placeholder | Future calendar integration | Do not migrate in core-loop release |
| `GET /health` | Plain text `ok` | Existing Zook `/api/health` | Use Zook health/readiness; no LightTick-specific alias |

The new contract also adds endpoints that have no working legacy equivalent:
Today snapshot, task start/cancel, plan confirmation, run status, change proposal
read/accept/reject, devices, account deletion, and full sync conflicts.

## 3. Request-field mapping

### 3.1 Goal and onboarding

| Legacy field | Canonical field | Decision |
|---|---|---|
| `title`, `goal_title` | `title` | Preserve as required user-visible goal title |
| `description` | `description` | Preserve as optional text |
| `duration_months` | `target_date` plus optional `duration_months` input | Store an explicit date and the originating estimate |
| `current_level` | `constraints.current_level` | Preserve under structured constraints |
| `weekly_hours` | `constraints.weekly_available_minutes` | Normalize to minutes; validate positive bounded value |
| `learning_pace` | `constraints.pace` | Enum: compact, balanced, relaxed |
| `motivation_statement`, `motivation` | `motivation` | Preserve, redact from ordinary logs |
| absent | `timezone` | Required IANA timezone for Today and period boundaries |
| absent | `availability_windows` | Optional structured weekly availability |

The Flutter `totalYears`, `goalId`, `weekId`, and camelCase payloads are not
accepted as canonical wire fields. Generated Swift/Kotlin clients use the
OpenAPI snake_case contract.

### 3.2 Plan generation

| Legacy field | Canonical field | Decision |
|---|---|---|
| numeric `goal_id` | string `goal_id` | Replace database-shaped integer with opaque string ID |
| `month_plan_id` / `week_plan_id` | `base_plan_id` | Generalize parent/base relation |
| `month_index` / `week_index` | `cycle_index` and explicit date range | Preserve display index but use dates as business truth |
| `goal_title`, `month_goal`, `week_goal` | loaded by server from owner-scoped resources | Client must not repeat authoritative context |
| `weekly_hours` | loaded from saved constraints | Client cannot override without a versioned goal update |
| `previous_summary` | loaded from persisted review | Client does not inject review authority |
| `available_minutes` | optional run constraint | Validate against saved availability |
| `remaining_minutes`, `mood` | replan context | Preserve as bounded contextual input, not direct mutation authority |
| `completed_tasks`, `skipped_tasks`, `skip_reasons` | derived from execution events | Do not trust client aggregate lists |

### 3.3 Task commands

| Legacy field | Canonical field | Decision |
|---|---|---|
| `completion_criteria` | stored on task, not resubmitted to complete | Server validates task definition |
| `notes` | `note` | Optional private text; excluded from analytics/logs |
| missing legacy actual duration | `actual_duration_minutes` | Optional non-negative integer |
| `reason` | `reason_code` and optional `reason_note` | Controlled enum plus private detail |
| `new_date` | `target_date` plus `timezone` | Preserve business date explicitly |
| absent | `base_version` | Required for mutations |
| absent | `Idempotency-Key` header | Required for mutation replay safety |

### 3.4 Reviews

Legacy `completed_count`, `skipped_count`, `skip_reasons`, `total_minutes`,
`weeks_completed`, and task totals are no longer authoritative request input.
Zook derives them from persisted execution facts. User-provided `mood` and
`self_reflection` remain optional review context. Every review records source
window, data version, prompt/schema version, and AI run ID.

### 3.5 Sync

| Legacy field | Canonical field | Decision |
|---|---|---|
| `action` | `action` | Preserve but constrain by entity type/state machine |
| numeric `task_id` | string `entity_id` | Generalize to all syncable entities |
| `payload` | typed action payload | OpenAPI one-of schema per action |
| `client_ts` | `client_occurred_at` | Context only; never controls server ordering |
| `client_version` | per-operation `base_version` | Resource-level optimistic concurrency |
| absent | `operation_id` | Required and unique within app/user |
| absent | `device_id` | Required operation origin |
| `since` timestamp | opaque `cursor` | Cursor is app/user bound and monotonic |

## 4. Response mapping

All successful responses move from raw maps or arrays to the Zook envelope:

```json
{
  "code": "OK",
  "message": "Success",
  "data": {},
  "requestId": "request_..."
}
```

Resource responses include opaque string `id`, integer `version`,
`created_at`, and `updated_at`. Async creation returns a persisted run with
`queued|running|succeeded|failed|cancelled` state. Template fallbacks include
an explicit `source=template`; they never masquerade as model output.

Legacy placeholder values such as `goal_id=0`, `not_implemented`, all-zero
weekly summaries, empty OAuth values, and accepted-but-unapplied sync actions
are explicitly removed.

## 5. Error mapping

| Legacy code | Zook direction |
|---|---|
| `INVALID_REQUEST` | `REQ_INVALID_BODY` or a field-specific validation code |
| `MISSING_FIELD` | `REQ_FIELD_REQUIRED` with field metadata |
| `INVALID_VALUE` | `REQ_FIELD_INVALID` with field metadata |
| `NOT_FOUND` | product resource not-found code without ownership disclosure |
| `FORBIDDEN` | existing auth/app-scope/RBAC codes where appropriate |
| `PLAN_VALIDATION_ERROR` | `LIGHTTICK_PLAN_CONSTRAINT_FAILED` with safe violations |
| `AI_GENERATION_FAILED` | retryable `LIGHTTICK_AI_RUN_FAILED` or unavailable/quota code |
| implicit conflicts | `LIGHTTICK_VERSION_CONFLICT` with server snapshot/actions |
| implicit duplicate success | replay of first operation result |

Authentication errors are owned by Zook Common and are not redefined by the
LightTick product contract.

## 6. Prompt and schema disposition

| Legacy builder/schema | New scene | Migration decision |
|---|---|---|
| `buildMonthSystemPrompt` / `monthPlanSchema` | `lighttick_plan_month` | Rewrite as versioned template/schema; retain weekly milestones and executable task intent |
| `buildWeekSystemPrompt` / `weekPlanSchema` | `lighttick_plan_week` | Rewrite; add saved constraints, dates, completion criteria, IDs assigned by server |
| `buildDaySystemPrompt` / `dayPlanSchema` | `lighttick_plan_day` | Rewrite; bind to Today date/timezone and existing weekly plan |
| `buildReplanSystemPrompt` / `replanSchema` | `lighttick_replan` | Rewrite to produce diff/reason/impact only; no direct task mutation |
| `buildWeeklyReviewSystemPrompt` / `weeklyReviewSchema` | `lighttick_review_weekly` | Rewrite using server-derived facts and data-sufficiency rules |
| `buildMonthlyReviewSystemPrompt` / `monthlyReviewSchema` | `lighttick_review_monthly` | Rewrite using persisted weekly reviews and goal progress |
| template month/week/day builders | matching generation scene fallback | Preserve only as explicit deterministic fallback with `source=template` |

Legacy prompts are not copied verbatim. They omit prompt versioning, user
confirmation, privacy boundaries, server-owned facts, and robust constraint
rules. The new implementation must add those controls and test them with
provider-free fixtures.

## 7. Explicit non-migrations

- Insecure JWT payload decoding and placeholder user synchronization.
- The Go process, Go database wrapper, integer resource IDs, and cost tracker
  placeholders.
- Flutter mock goals/tasks/chat/reviews and its mismatched API paths.
- Calendar stubs until a separate integration change is approved.
- SSE as a source of job truth; progress transport may be added after persisted
  runs exist.
- Kafka, Neo4j, Weaviate, full multi-agent orchestration, social features, and
  growth visualization in the core-loop release.
