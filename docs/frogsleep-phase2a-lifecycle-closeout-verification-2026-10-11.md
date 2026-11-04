# FrogSleep phase 2A directional consent and relationship lifecycle — 2026-10-11

Scope: `deliver-sleep-phase2a-backend` 2.2 and Sleep `deliver-sleep-phase2a-client` 4.3. Backend worktree: `/Users/hao/Documents/project/Zook/.worktrees/sleep-phase2a-backend`, branch `feature/sleep-phase2a-readiness`, baseline `4599ef52ff6e017b39d01ceb8d4ea6830be78bb7`. No commit/push/deployment in this batch; earlier invitation/account/Focus WIP is retained.

## Implemented

- Canonical and compatibility relationship metadata, participant-owned pause/resume, per-recipient relation mute/unmute and terminal revoke. Pending legacy Focus invitations cannot use lifecycle endpoints to bypass recipient acceptance.
- Atomic PUT of only the authenticated grantor's four-category selection with original versions; absent canonical grants are revoked/version 0 read defaults. GET does not create grants. Independent directions, complete batch validation, audit rollback and active-state checks occur under shared participant/domain slot locks. Paused relations allow withdrawal but reject new granting. Canonical relationships never use implicit legacy backfill; legacy backfill now locks and rereads current state.
- Pause closes existing shared coordination sessions without releasing slots; resume removes only the caller's pause and never revives closed sessions. Shared_activity withdrawal closes shared coordination. Revoke/block revoke both grant directions and release only slots whose relationship identity still matches. Block covers current canonical/legacy Sleep and Focus relationships; unblock restores none. Personal Focus/Sleep histories are untouched.
- Shared Sleep session writes, structured shares and joint-activity writes revalidate current relationship/consent under lifecycle slot locks. Personal timing can continue locally. Common goal/milestone/report reads are gated or filtered using current relationship and category permissions.
- Notification opens check exact kind/IDs, recipient, expiration, relationship and incoming grant. Buddy worker repeats target/consent/silence checks on every attempt before feed/Push enqueue. Legacy shared Sleep Push enqueue also honors current silence/consent. Silence changes no grants and cannot be overwritten by legacy guardianship settings. Route fields now match client parsing; compatibility interaction_id must refer to the same target.
- iOS adds protocol/model → API repository → lifecycle service → relationship settings UI via AppEnvironment. Direction selection uses server viewer identity and preserves own original versions. A single cache invalidation coordinator fences late reads/writes/navigation and purges shared session/report/presence/comparison/message/growth/goal caches and pending routes around mutations. Notification opening starts with shared cache invalidation and server resolution; mark-read awaits and destination refreshes are fenced. Legacy Sleep notifications refresh their authenticated status. Private sessions and history remain unchanged.

## Validation

| Gate | Result |
| --- | --- |
| `npm test` | 1317 passed, 0 failed |
| New lifecycle API/service tests | 11 included in full suite |
| New live PG lifecycle suite | 8 passed (7 subtests + parent) |
| Invitation closeout PG regression | 10 passed |
| Existing PG slot/concurrency | 6 passed |
| Existing PG migration upgrade | 1 passed |
| iOS targeted regressions | 94 passed |
| generic Simulator build | passed |
| `check:api-contracts` | passed |
| `lint:api-contracts` | 0 errors / existing 194 warnings |
| `git diff --check`, xcstrings JSON | passed |
| global source line-count | existing 9 failures; no new source-limit failures |

New API tests prove independent grants, grantor ownership, stale-batch no-partial-writes, paused withdrawal/no new grants, dual actor resume, repeated revoke not releasing a new slot, dual-domain block/unblock, real session/summary reads and events after pause/withdraw/revoke, notification kind/route/expiry checks, retry silence, one-way summary publication, legacy Sleep Push silence, and no pending Focus acceptance bypass.

New PostgreSQL tests use independent connections for competing grant versions, pause-held slot locks preventing a late grant, audit-failure rollback, per-actor resume, revoke/grant race, a real new invitation taking the slot followed by old revoke replay, and persisted dual-domain block cleanup. The final four PG suites ran sequentially. One earlier parallel regression run shared a database and suffered mutual test cleanup; its results are discarded. Dedicated database `sleep_phase2a_lifecycle_20261011` is deleted after verification. No development or production database is used.

iOS adds 14 behavioral lifecycle/cache tests and 5 canonical relationship repository tests. They cover own/partner duplicate categories, unknown viewer, delayed consent/save/command/cache/report responses, single-flight, no fabricated success, account invalidation callbacks, notification resolution/mark-read invalidation, real DI private Focus/history preservation and account-scoped GRDB message cleanup. API tests check method/path/original version, actor block target, absent token and changed token before response; consent date decoding accepts fractional ISO8601.

Durable companion evidence: Sleep `开发规划/Sleep二期2A方向授权与关系生命周期验证记录-20261011.md`. Temporary local logs: `/tmp/sleep-lifecycle-backend-full.log`, `client-tests.log`, `build.log`, `postgres.log`, `pg-invitations.log`, `pg-concurrency.log`, `pg-migration.log`, `contract-check.log`, `contract-lint.log` (all with `/tmp/sleep-lifecycle-` prefix).

## Status and boundaries

Backend 2.2 and client 4.3 are locally complete: **8/16 backend; 15/22 client**. These counts do not declare release readiness.

Backend 2.3 retains complete mail/Push/provider retries, disabled/quiet/provider failure/no-device and generic Push queue final delivery acceptance; this batch covers current relationship target/consent/silence gates. 2.4 remaining contract audit, 2.5 complete migration/grant acceptance and §3 current dev/provider/device/main-release gates remain unchecked. Client 4.1/4.4/4.5, Android and device/dev/release gates remain unchecked. Two previously reported v11 client test fixtures conflict with current v12 and were not changed; no full iOS-suite pass is claimed. Global source line-count retains the same nine existing over-baseline files.
