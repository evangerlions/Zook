# FrogSleep account and buddy release verification

Last updated: 2026-07-30

This record separates code readiness, development acceptance, and production
release authorization. The candidate is invite-only: inbox, explicit consent,
growth hub, interactions, goals/reports, Push, and email are enabled; focus
stranger matching remains disabled.

## Candidate verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Zook full suite | Pass, 636/636 twice | Two consecutive `npm test` runs |
| SSE stability | Pass, 20/20 | The first stream chunk arrived before the upstream completion barrier was released |
| Source line count | Pass | 318 source files are at or below 599 lines |
| PostgreSQL 16 migrations and concurrency | Pass, 6/6 | Disposable database; migrations 000 through 017 applied |
| Rollout rehearsal | Pass | `npm run observe:frogsleep-buddy-rollout` returned `ok: true`; P0–P3 were GO |
| iOS full unit suite | Pass, 669/669 | `FrogSleepTests` |
| iOS invitation UI smoke | Pass, 4/4 | Accessibility, inbox/outbox consent, email creation, and login-return restoration |
| iOS localization audit | Pass | All 15 invitation keys contain translations for all 16 release languages |
| iOS device archive | Conditional pass | Archive and embedded binary validation succeeded for App, Shield, Widgets, and Watch |

The Release build settings use team `LTN9Y4UXN3` and
`FrogSleepRelease.entitlements`, whose APNs environment is `production`.
The machine used for this verification has a valid distribution certificate
but does not have an App Store provisioning profile for `com.hulusleep.app`.
Automatic signing therefore produced a development-signed archive. Before an
App Store upload, install or generate the matching App Store profile and verify
the archived App has `aps-environment=production` and
`get-task-allow=false`.

## Environment acceptance

Development acceptance must record the deployed commit and version, then prove:

1. Health is 200; unauthenticated `me` and buddy capability requests are 401,
   never 404.
2. Three controlled accounts complete login, invitation, wrong-account
   rejection, acceptance, idempotent retry, bilateral relationship checks,
   revocation, and cleanup.
3. A disposable account completes `me`, refresh, logout, re-login, device
   registration, account deletion, and post-deletion token rejection.
4. Tencent SES reaches `queued → provider_accepted → delivered` in a controlled
   mailbox and the callback is authenticated.
5. A development device receives APNs through topic `com.hulusleep.app` with
   sandbox enabled, opens the invitation deep link, restores login, and resumes
   the preview route.
6. Logs contain no email address, verification code, invitation token, APNs
   private material, or provider credential.

Code-level success is not evidence for provider delivery or physical-device
Push. Missing credentials or devices must remain explicit release blockers;
they must not be recorded as a pass.

## Production boundary

This candidate may be deployed only to `release-dev`. Do not run
`release_online.sh`, deploy a production tag, or submit to App Store during this
verification cycle. Production preflight additionally requires
`APNS_SANDBOX=false`, the same `com.hulusleep.app` topic, a production APNs
delivery, the App Store-signed archive check above, and an approved rollback
owner.
