# FrogSleep 2A local verification — 2026-10-11

> This document preserves the first account-baseline evidence. The later focus-idempotency implementation and current task state are recorded in [the follow-up verification](frogsleep-phase2a-focus-idempotency-verification-2026-10-11.md).

Status at the first batch: account baseline verified; overall 2A and production readiness remain incomplete.

## Candidate and scope

Base: fetched origin/main `4599ef5`. Branch: `feature/sleep-phase2a-readiness`; worktree: `/Users/hao/Documents/project/Zook/.worktrees/sleep-phase2a-backend`.
The existing `feature/frogsleep-data-ownership` / `94602cc` is preserved and excluded from 2A. No runtime API/migration, deployment or other product code was changed. New `frogsleep-phase2a-account-isolation.test.ts` verifies authentication with all Buddy capabilities off, owner-field spoofing isolation, and deletion preserving another user and another app session.

## Results

- All FrogSleep unit/contract tests: 197/197 passed, including 3 new scenarios.
- Disposable PostgreSQL migration/concurrency tests: 7/7 passed with `--test-concurrency=1 --test-force-exit`; the created database was removed. No pre-existing database was used as the test target.
- `npm run check:api-contracts`: passed.
- Both new backend OpenSpec changes: strict validation passed; 2A tasks 1.1–1.5 completed, all environment/release tasks remain open; 2B not applied.
- Client standard simulator build and 54 related tests passed, including 9 new account tests; final account-only rerun also passed 9/9. This is not real-device or production evidence.

Logs: `/tmp/sleep-phase2a-backend-tests.log`, `/tmp/sleep-phase2a-postgres-tests.log`, `/tmp/sleep-phase2a-client-tests.log`.

## Existing global gate failure

`npm run check:line-count` fails on these unchanged files:

| Lines | File |
|---|---|
| 873 | src/modules/bodylog/bodylog-group.service.ts |
| 820 | src/infrastructure/database/postgres/postgres-bodylog-admin.ts |
| 733 | src/infrastructure/database/application-database.ts |
| 692 | src/infrastructure/database/postgres/postgres-database.ts |
| 669 | apps/admin-web/app/lib/admin-api.ts |
| 646 | src/application-factory.ts |
| 644 | src/infrastructure/database/postgres/postgres-bodylog-checkin.ts |
| 605 | src/app/lighttick-v1-routes.ts |
| 604 | src/infrastructure/database/postgres/postgres-lighttick-repository.ts |

No unrelated refactor was performed. This gate is not reported as passing.

## Remaining gates

Full directional-grant/notification audit, client owner partitions and late request identity protection, current dev dual/third/disposable account evidence, SES delivered, APNs/FCM physical-device deep links, signing, rollback ownership, and main-to-dev-to-online same-SHA release verification remain incomplete. Historical release-readiness reports are reference only. No commit/push/deployment was performed.

OpenSpec is ignored by the inherited repository gitignore; the new config and change files were explicitly included with intent-to-add so they are visible for review and future staging. Nothing was committed.


## Client partition follow-up (2026-10-11)

Sleep completed client tasks 3.1–3.7 with owner-scoped local histories/outbox, immutable request credentials and account lifecycle handling; see Sleep `开发规划/Sleep二期2A账号分区与生命周期验证记录-20261011.md`. These client tests do not change backend readiness or prove cloud exactly-once ingestion. Source inspection found reportSession assigns a random entity ID on every POST and only stores client_session_id in payload, so duplicate submissions can count twice. Backend task 2.6 remains unchecked; total backend progress is now 5/16. This follow-up only changes planning and evidence documents, not runtime code or canonical contracts.


## Focus idempotency completed locally

Backend task 2.6 is now complete: atomic owner-scoped focus writes, 021 legacy deduplication migration, canonical/generated contract and API docs. Final evidence: full unit tests 1301/1301; FrogSleep 207/207 (subset); focus PostgreSQL 8/8; existing PostgreSQL regression 7/7. Current progress is backend 6/16 and client 13/22. See the dedicated follow-up for scope, temporary-database cleanup and the remaining global line-count gate. No deployment or dev acceptance is implied.
