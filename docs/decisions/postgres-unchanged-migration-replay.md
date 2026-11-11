# Skip unchanged applied PostgreSQL migrations at startup

2026-11-12, Grow completion integration acceptance.

Concurrent reading PG suites exposed a real startup/active-writer lock inversion: migration SQL requested a lock on `zook_lighttick_task_steps` while an owner deletion held that table and waited for `zook_lighttick_tasks`. The existing migration session advisory lock serializes migrators, not business transactions, so it cannot prevent this cycle. The original six-file run observed PostgreSQL 40P01; a reduced test reliably failed with lock timeout while an owner held the child-table lock.

The migrator now reads its existing name/checksum journal under the existing session lock and skips exact matches. It does not rerun unchanged DDL or overwrite historical applied_at timestamps. New files and legacy null/changed checksums retain the existing idempotent upgrade path. No migration file or business table is modified by this fix. An unchanged restart consequently no longer tries to reacquire historical business-table DDL locks.

Regression: `test/integration/postgres-migration-unchanged.test.ts` uses an isolated localhost Grow database, holds the task-step write lock and runs startup with a bounded database lock timeout. It fails before the change, passes after it, and verifies unchanged migration journal facts. All five reading domain PG tests plus this regression pass together with default test-file parallelism. New or changed DDL still needs its own deployment validation; this fix is not a claim that arbitrary schema changes are safe under every live workload.
