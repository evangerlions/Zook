# LightTick Operations Runbook

LightTick is an independently gated Zook product. Production runtime ownership is Zook API, Worker, PostgreSQL, Redis-backed queues, configured LLM providers, and APNs/FCM. The old Go service is not a recovery path.

## Health and triage

1. Confirm `/api/health`, PostgreSQL migration state, Redis connectivity, and `lighttick` app status.
2. Open Admin → LightTick Ops. Check AI failures/schema failures, average latency, Token usage, estimated cost upper bound, sync conflicts, pending proposals, active devices, and the versioned AI routing history.
3. Treat `lighttick.ai-routing.write` as a sensitive operation: obtain a secondary-operation grant before updating or restoring a routing revision. Runtime workers resolve the latest validated revision for every run; Admin changes cannot raise a scene above its code-owned cost cap.
4. Correlate by request ID, run ID, or job ID. Logs must never include bearer/refresh/push Tokens, provider keys, Prompt bodies, task notes, Coach text, or private context.
5. Inspect failed events and DLQ entries. Retry only idempotent jobs with the same stable run/resource IDs.

## Push configuration and checks

- APNs reuses the configured team/key and selects `LIGHTTICK_APNS_BUNDLE_ID=com.lighttick.app` as the LightTick topic. Dev physical devices require `APNS_SANDBOX=true`; Online requires `false`.
- Android uses `LIGHTTICK_FCM_PROJECT_ID` and `LIGHTTICK_FCM_SERVICE_ACCOUNT_PATH` when LightTick has a separate Firebase project. Provider credentials and device tokens must never enter logs or committed env files.
- Register devices through the app-scoped `/api/v1/lighttick/devices` route. Profile notification preferences own enablement, review reminders, daily reminder time, and quiet hours; profile timezone is the scheduling authority.
- A scheduler tick is keyed by app, user, notification type/resource, and business date. Repeated ticks materialize one provider job. Paused goals suppress task pressure, and invalid provider tokens disable only the matching LightTick device.
- Provider smoke tests belong to Dev acceptance: verify one valid and one invalid token on each enabled platform, quiet-hour suppression, paused goals, duplicate scheduling, retryable 429/5xx behavior, and cross-app isolation.

## Failure controls

- API/DB incident: disable LightTick without changing other app registrations or memberships.
- LLM incident: disable `ai_planning`; deterministic task execution, Today, sync, and facts-only/template fallbacks remain available.
- Push incident: disable notifications; task and review state remains authoritative in PostgreSQL.
- Sync conflicts: clients keep the server snapshot, refresh, and retry only a non-terminal compatible command with the current version.
- Account deletion: verify LightTick membership, sessions, devices, operations, proposals, jobs, and product tables are removed while global user and other app data remain.

## Release and rollback

Deploy migration/contracts/runtime to dev with LightTick disabled. Enable internal accounts, observe the gates in `docs/lighttick-release-gates.md`, and release the identical verified `origin/main` SHA. Rollback is feature disablement first; database migrations remain upgrade-safe and are not destructively reversed during an incident.
