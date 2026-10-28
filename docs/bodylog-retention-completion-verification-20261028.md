# BodyLog account/social retention completion — 2026-10-28

Source branch: `feature/bodylog-retention-completion`, from synchronized local main `edbfbf8`. This worktree was clean at creation; the original Zook directory and unrelated local changes were preserved. No deployment or production configuration change is included.

Delivered: invitation preview/code attribution/owner revocation and repeatable binding; eligibility reconciled from stored local-goal plan missions; separate source-deduplicated invitation/Campaign/buddy/group promotional grants; effective contiguous entitlement and social quotas; durable protocol-specific encouragement delivery across concurrent instances/restarts; block stops broadcast/feed access; real authenticated campaign review/claim and audited admin operation; minimal opt-in telemetry and stable disabled-by-default experiment assignment/mature retention metrics.

Migration: `079_bodylog_retention_integrity.sql`. App-data deletion includes the new documents. Public OpenAPI and generated source were updated with runtime and API/admin documentation.

Validation:

- Full repository unit run: 1661 passed, zero failed, one preexisting skipped test. A missing worktree-local admin TypeScript dependency was resolved by reusing the installed locked admin dependencies; no lockfile changed.
- Final affected BodyLog/Postgres-adapter unit run after protocol and milestone follow-ups: 152 passed, zero failed.
- Real PostgreSQL plus loopback HTTP: eight passed, zero failed, using only disposable `bodylog_retention_20261028` on the local PostgreSQL instance. Includes real password login, two-account API journey, concurrent copies, process restart, revocation, rollback and scoped deletion.
- `npm run check:api-contracts`, isolated contract dependency installation followed by `npm run lint:api-contracts`, and `git diff --check` passed.
- Supplemental TypeScript compile is not a clean global gate: HEAD has127 diagnostics, current126, no newly introduced diagnostic messages. Existing admin/session/ErrorCode and shared content-safety type issues remain outside this change; no clean global typecheck is claimed.
- Paired physical Watch was discoverable but its development tunnel/DDI was unavailable. Production AASA/signing, real paired transfer and D7 outcome gates remain unverified.

Cross-repository evidence and rollout checklist:
`/Volumes/肖豪/project/sport/docs/qa/account-social-retention/2026-10-28-completion/README.md`
`/Volumes/肖豪/project/sport/docs/qa/account-social-retention/2026-10-28-completion/ROLLOUT.md`

Reproduce local backend verification (disposable database only):

```sh
node --experimental-transform-types --test test/unit/bodylog-*.test.ts test/unit/postgres-bodylog-*.test.ts
BODYLOG_TEST_DATABASE_URL='postgresql://hao@localhost/bodylog_retention_20261028?host=/tmp' node --experimental-transform-types --test --test-concurrency=1 test/integration/bodylog-retention-postgres.test.ts test/integration/bodylog-retention-http.test.ts
npm run check:api-contracts
npm run lint:api-contracts
```

Remain on the feature branch pending the normal Zook main→dev→online workflow and owner verification. Do not push unrelated already-ahead local main commits or treat source completion as production acceptance.
