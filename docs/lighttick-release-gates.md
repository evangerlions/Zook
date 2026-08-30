# LightTick development-slot release gates

## Decision model

LightTick starts disabled by default. Promotion from development to online is
`GO` only when every hard gate passes against one recorded `origin/main` SHA.
Any change to that SHA invalidates prior dev evidence and requires a fresh dev
deployment and observation.

The initial thresholds below are release gates, not product success targets.
They may be tightened through versioned configuration and documented review;
they must not be silently relaxed during a release.

## 1. Deterministic quality gates

| Gate | Required result |
|---|---|
| OpenAPI lint and generated-contract drift | 100% pass; zero drift |
| Root typecheck and production build | 100% pass |
| Affected unit/API suites | 100% pass |
| LightTick provider-free end-to-end suite | 100% pass |
| PostgreSQL migration from empty and upgrade | 100% pass |
| PostgreSQL concurrency/idempotency suite | 100% pass |
| Swift and Kotlin shared contract fixtures | 100% decode/encode pass |
| Security review | Zero unresolved P0/P1 findings |
| Cross-app deletion isolation | 100% pass on at least two non-LightTick apps |

## 2. Core-loop acceptance gates

The following scenarios must pass for at least three independent QA accounts,
including one disposable deletion account:

1. Register/login and restore a session.
2. Submit onboarding and recover after leaving during generation.
3. Receive a proposed plan and confirm it.
4. Load Today and complete, skip, and defer separate tasks.
5. Generate and read a weekly review.
6. Receive, reject, regenerate, and accept a Plan B proposal.
7. Repeat a mutation after losing its response without duplicate events.
8. Perform offline operations on two devices and converge through sync.
9. Delete the LightTick account and prove old tokens/membership are rejected.
10. Prove the same global user's other Zook app remains active after deletion.

Required result: 100% of scenarios pass with attached request/run/job IDs.

## 3. API and sync health gates

Measured over a minimum 60-minute internal observation window with at least
500 non-health API requests and 100 mutation/sync operations:

| Metric | GO threshold | HOLD threshold |
|---|---|---|
| Non-4xx server error rate | `< 1.0%` | `>= 1.0%` |
| Non-AI read P95 | `< 300 ms` | `>= 300 ms` |
| Non-AI mutation P95 | `< 500 ms` | `>= 500 ms` |
| Unknown/ambiguous write outcome | `0` | `> 0` |
| Duplicate effects from replay | `0` | `> 0` |
| Lost committed changes in pull | `0` | `> 0` |
| Cursor scope violations | `0` | `> 0` |
| Unresolved sync conflict rate | `< 5%` | `>= 5%` or any silent overwrite |

Expected validation/auth 4xx responses are excluded from server error rate but
must remain within documented codes.

## 4. AI gates

Measured with the complete versioned golden/eval set plus at least 30 internal
dev runs across plan, review, and replan scenes:

| Metric | GO threshold | HOLD threshold |
|---|---|---|
| JSON/schema parse rate after bounded retry | `>= 99%` | `< 99%` |
| Deterministic constraint pass rate | `>= 98%` | `< 98%` |
| Successful persisted terminal run rate | `>= 97%` | `< 97%` |
| Material changes executed without confirmation | `0` | `> 0` |
| AI outage blocking existing task execution | `0` | `> 0` |
| Runs missing prompt/schema/model/usage provenance | `0` | `> 0` |
| User/private Prompt text in ordinary logs | `0` | `> 0` |

Per-scene Token and currency budgets must be configured before external rollout.
The release is HOLD when budget enforcement cannot reject before provider use or
when estimated cost attribution is incomplete.

## 5. Worker, notification, and operations gates

| Gate | Required result |
|---|---|
| Queue jobs with unknown terminal state | 0 |
| Duplicate business notification from repeated worker tick | 0 |
| Failed enqueue without durable failed event | 0 |
| Invalid token cleanup affecting another app/device | 0 |
| Valid-device provider acceptance in controlled smoke | 100% for APNs and FCM platforms enabled for release |
| Request/run/job correlation coverage | 100% for failed core-loop scenarios |
| Required LightTick dashboards and alerts | Present and verified |

## 6. Privacy and deletion gates

- No access token, refresh token, verification code, push token, provider key,
  full Coach message, private note, or raw sensitive Prompt appears in ordinary
  logs or analytics.
- Every product repository lookup is owner/app scoped or explicitly Admin/RBAC
  scoped.
- LightTick deletion removes product profile, goals, plans, tasks, events,
  reviews, proposals, AI runs as required by policy, sync operations, devices,
  and pending jobs.
- Required minimal audit retention is documented and does not retain private
  content unnecessarily.
- Deleted membership and old sessions cannot regain LightTick access through
  refresh or automatic join.

Any failure is an immediate HOLD.

## 7. Rollout and rollback

Rollout stages:

1. Routes and migrations deployed with `lighttick` disabled.
2. Internal allowlist only.
3. Small controlled cohort after all dev gates pass.
4. Wider rollout only after the same dashboards remain healthy.

Rollback must be demonstrated before online promotion:

- Disable LightTick app/product routes without affecting Common or other apps.
- Disable individual AI scenes while preserving deterministic execution.
- Stop new Worker scheduling while allowing known persisted jobs to be audited.
- Restore the prior application version without reversing additive migrations.

Rollback does not switch writes back to the legacy Go backend. Dual-write and
dual-primary recovery are prohibited.

