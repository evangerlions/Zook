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

P0 inbox/consent, P1 hub/interactions, P2 goals/reports, and P3 prompts/Push remain independently controlled by the existing `FROGSLEEP_BUDDY_*_ENABLED` flags. Evaluate at least one full reporting week per stage. Disable prompts and Push above 15% Push opt-out; disable all growth surfaces above 8% revoke, 3% block, 1% report, or 0.5% complaint. Record owner, cohort, observation window, metric snapshot, and go/no-go decision.

Before production rollout, run `npm run observe:frogsleep-buddy-rollout`. The deterministic seven-day preproduction rehearsal must return `ok: true` and one GO decision for every stage. It validates flag isolation and decision logic but does not replace the required production observation week.

## Retention and deletion

Run `SELECT * FROM frogsleep_purge_expired_buddy_data(now());` daily and alert on failure. Feed/projections/interactions retain 90 days, delivery attempts and structured shares 30 days, completed goals 365 days, reports 400 days, and audits 730 days. Revocation blocks reads immediately; deletion windows never extend authorization.

## Incident response

For suspected enumeration, replay, IDOR, notification leakage, or rate-limit evasion: disable the affected capability, preserve opaque audit IDs, revoke active sessions where required, validate bilateral block enforcement, and never copy protected payloads into tickets or logs.
