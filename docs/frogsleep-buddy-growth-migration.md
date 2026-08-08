# FrogSleep Buddy Growth Migration

Migration `007_frogsleep_buddy_growth.sql` is additive. It creates directional sharing grants, invitation bundles/projections, a transactional notification outbox, in-app notifications, and delivery attempts.

Migration `009_frogsleep_buddy_legacy_grant_backfill.sql` idempotently creates bilateral grants for relationships accepted before explicit consent shipped. Its deterministic `legacy-` identifiers make those rows auditable and selectively removable. New relationships are excluded because explicit acceptance already creates preview-scoped grants.

## Rollback

Disable all `FROGSLEEP_BUDDY_*` capabilities first. Existing sleep/focus tables and APIs remain authoritative, so rollback does not require deleting the new tables. If physical rollback is required after confirming no new client is active, drop delivery, notification, outbox, receipt, bundle, and grant tables in reverse dependency order.

## Retention

- invitation receipts: terminal rows may be archived after 180 days;
- in-app notifications: expire or archive after 90 days unless required for an active safety case;
- delivery attempts: retain 30 days;
- outbox delivered rows: retain 30 days; dead letters remain until operational review;
- grants and their timestamps remain while the relationship or required audit policy exists.

## Query paths

Inbox and outbox indexes use `(app_id, user_id, status, created_at DESC)`. Unread notifications use a partial recipient/time index. Worker polling uses a partial `(status, available_at, created_at)` index. Grant checks use viewer, relationship, domain, category, and state.

Before production rollout, run `EXPLAIN (ANALYZE, BUFFERS)` for inbox, outbox, unread-count, worker-ready, and viewer-grant queries against staging-scale data.
