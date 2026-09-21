# LightTick Coach goal isolation

Base: origin/main `da267a73ff56a5c943c62f01c5443cb107e54452`. Implements the goal-isolation slice of plan/OpenSpec `unify-goal-coach-product` task 1.2. This is a backend candidate, not a production release or the full persistent-memory feature.

## Behavior

- Coach chat and planning history read by owner, goal and thread before limiting; reused thread IDs cannot mix goals. Message ties use created_at and ID ordering.
- Chat references are checked before any message/run write and again when context is assembled for a delayed run. Foreign-owner or absent resources return404; same-owner goal/task-plan mismatches return422.
- Execution events are selected through owner-scoped task membership in PostgreSQL, excluding other goals and orphaned task events. Canonical `task_complete/task_skip` events are normalized for the existing legacy Coach fact aggregator; source events are not rewritten.
- Shared capacity is not introduced by this slice, and per-goal execution facts must not be presented as a cross-goal budget. Private reflection text is not added to context.
- Public request/response shapes remain compatible; OpenAPI descriptions,422 response and README_API were updated. Generated schema output is unchanged after regeneration.

## Review

Correctness: source and delayed validation agree; resource checks precede writes, history filtering precedes limit, real service-generated events are covered. Security: parameterized SQL, owner plus goal filtering, mixed references and cross-account tests. Architecture: repository optional goal filters preserve other callers; planning uses the same scoped message read. No dependency, schema migration or framework was added.

Performance: events are filtered at the database rather than loading all owner events into Coach. Per-goal history/event window budgeting remains part of later bounded Context Builder work; no claim of complete long-term memory performance validation. Orphaned historical events are deliberately excluded until event-time goal ownership is designed.

## Verification

New unit/HTTP regressions cover real task completions, same-thread different goals with limit1, foreign-owner tasks, inconsistent task/plan, invalid requests with no writes, planning history isolation, skips and orphaned legacy events. The pre-fix regression run failed; the fixed targeted run passed all5 cases.

Real PostgreSQL integration uses a disposable local database, not production. It covers scoped selection, correct completion counts, cross-goal/cross-account rejection, tied timestamps and migration rerun. Result:1 passed,0 skipped.

Contract regeneration/check and git diff whitespace validation passed. Full test-suite result is recorded in the plan delivery evidence with the final candidate SHA.

The repository line-count gate fails identically on this candidate and untouched main: `src/application-factory.ts`636, `src/services/common-llm-config.service.ts`625, `apps/admin-web/app/lib/admin-api.ts`602. These files were not changed. Candidate is not merged or released while the existing gate remains unresolved. No native UI or real-provider execution was claimed.
