# FrogSleep Buddy Growth Operations Runbook

## Funnel and safety metrics

All dimensions use opaque `invitation_id`, `relationship_id`, or `notification_id` only. Never export tokens, codes, names, notes, sleep/focus summaries, or report content.

```sql
SELECT event_name, date_trunc('day', occurred_at) AS day,
       count(*) AS events, count(DISTINCT user_id) AS users
FROM analytics_events
WHERE app_id = 'frogsleep' AND event_name LIKE 'frogsleep_buddy_%'
GROUP BY 1, 2 ORDER BY 2 DESC, 1;

SELECT date_trunc('week', occurred_at) AS week,
       count(DISTINCT metadata->>'relationship_id') AS weekly_active_growth_relationships
FROM analytics_events
WHERE app_id = 'frogsleep'
  AND event_name = 'frogsleep_buddy_weekly_active_growth'
GROUP BY 1 ORDER BY 1 DESC;
```

Track invitation created → delivered → previewed → accepted/declined → first interaction → first joint action → weekly active growth. Guardrails are Push opt-out, pause, revoke, block, report, complaint, duplicate delivery, and unauthorized access rates.

## Rollout controls

The invite-only release template explicitly enables
`FROGSLEEP_BUDDY_INBOX_ENABLED`,
`FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED`,
`FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED`,
`FROGSLEEP_BUDDY_INTERACTIONS_ENABLED`,
`FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED`,
`FROGSLEEP_BUDDY_PUSH_ENABLED`, and
`FROGSLEEP_BUDDY_EMAIL_ENABLED`. It explicitly sets
`FROGSLEEP_BUDDY_FOCUS_MATCHING_ENABLED=false`; do not enable stranger
matching as part of an invitation rollout.

P0 inbox/consent, P1 hub/interactions, P2 goals/reports, and P3 prompts/Push
remain independently controlled. Evaluate at least one full reporting week per
stage. Disable prompts and Push above 15% Push opt-out; disable all growth
surfaces above 8% revoke, 3% block, 1% report, or 0.5% complaint. Record owner,
cohort, observation window, metric snapshot, and go/no-go decision.

Before production rollout, run `npm run observe:frogsleep-buddy-rollout`. The deterministic seven-day preproduction rehearsal must return `ok: true` and one GO decision for every stage. It validates flag isolation and decision logic but does not replace the required production observation week.

## Retention and deletion

Run `SELECT * FROM frogsleep_purge_expired_buddy_data(now());` daily and alert on failure. Feed/projections/interactions retain 90 days, delivery attempts and structured shares 30 days, completed goals 365 days, reports 400 days, and audits 730 days. Revocation blocks reads immediately; deletion windows never extend authorization.

## Incident response

For suspected enumeration, replay, IDOR, notification leakage, or rate-limit evasion: disable the affected capability, preserve opaque audit IDs, revoke active sessions where required, validate bilateral block enforcement, and never copy protected payloads into tickets or logs.

## Invitation email operations

Development and production must separately provision the common Tencent SES sender and template named `frogsleep_buddy_invitation`. Required template variables are `invitationLink`, `invitationCode`, `domains`, `expiresAt`, and `productName`; do not add recipient email, token, inviter notes, or profile data. Configure and authenticate `/api/v1/email/tencent/callback`, then enable `FROGSLEEP_BUDDY_EMAIL_ENABLED` only after API and worker run the same release.

Preflight:

1. Apply migration 017 and confirm delivery/attempt tables and ready/provider indexes.
2. Confirm sender domain approval, template approval, region, quotas, callback token and clock synchronization.
3. Run API and worker, create one invitation to a controlled mailbox, and observe `queued → provider_accepted → delivered`.
4. Run `npm run smoke:frogsleep-buddy-invitation` with `BUDDY_SMOKE_A_EMAIL/PASSWORD` and `BUDDY_SMOKE_B_EMAIL/PASSWORD`; never commit these values.
5. Query the admin delivery endpoint and verify logs contain no raw email, code, token, template data or provider secret.

Recovery: restart the worker for queued/retryable rows; exponential retries are bounded at five. Fix configuration and explicitly requeue reviewed dead-letter rows through an audited operational procedure—never mutate an accepted/cancelled/expired invitation back to pending. Bounce, complaint and unsubscribe callbacks suppress future delivery while code/link acceptance remains available.

Rollback order: disable `FROGSLEEP_BUDDY_EMAIL_ENABLED`, keep preview/accept/decline/cancel available, stop the worker, and retain outbox/audit evidence. Roll back the whole invitation surface only for relationship-integrity or privacy failures; do not down-migrate tables while any release can still write them.

## APNs operations

The APNs topic is `com.hulusleep.app` in every environment. Development device
acceptance requires `APNS_SANDBOX=true`; production preflight requires
`APNS_SANDBOX=false`. Keep the `.p8` key outside Git and provide it through
`APNS_PRIVATE_KEY_PATH`.

Before enabling Push:

1. Confirm key ID, team `LTN9Y4UXN3`, topic, private-key permissions, and server
   clock.
2. Register a real device, send a buddy notification, and verify provider
   acceptance and device receipt.
3. Open the notification and prove the buddy deep link restores authentication
   and the intended invitation or growth route.
4. Inspect structured logs and confirm they contain only opaque device and
   notification identifiers, never a device token or private key.

Rollback Push independently with `FROGSLEEP_BUDDY_PUSH_ENABLED=false`.
Invitation code/link acceptance and the inbox must remain available.
