# FrogSleep release-readiness report — 2026-07-30

## Decision

Development deployment is healthy and the invite-only account/buddy candidate
is functionally verified. Production and App Store release remain **HOLD**
until the external signing, SES, APNs, and disposable-account gates below are
completed. No production deployment or App Store submission was performed.

## Candidate identity

- iOS commit: `19df943`
- Zook candidate commits: `2b0a9da`, `52c3ab2`, `3cddcac`
- Gitee candidate branch: `release/v1-buddy-launch`
- Development branch release commit: `8e595ba`
- Development tag/version: `version/20260730_003` / `20260730_003`
- Rollback switches: each `FROGSLEEP_BUDDY_*_ENABLED` capability; stranger
  matching remains `FROGSLEEP_BUDDY_FOCUS_MATCHING_ENABLED=false`

## Automated gates

| Gate | Result |
| --- | --- |
| iOS localization | Pass; 15 invitation keys × 16 release languages |
| iOS unit tests | Pass; 669/669 |
| iOS invitation UI smoke | Pass; 4/4 |
| iOS archive build | Pass; App, Shield, Widgets, and Watch embedded validation |
| Zook unit/contract tests | Pass; 636/636 twice before final gate fix, 637/637 after it |
| Zook line-count gate | Pass; 318 files |
| SSE stability | Pass; 20/20 barrier-based runs |
| PostgreSQL migrations/concurrency | Pass; migrations 000–017, 6/6 |
| Rollout observation | Pass; `ok: true`, P0–P3 GO |
| Relevant OpenSpec strict validation | Pass; five account/buddy/localization changes |
| Generated public contract | Pass; no drift |

The all-change OpenSpec command still reports one pre-existing Android-only
failure in `add-android-kmp-app-cn-intl`. It was excluded from this iOS/Zook
release scope and not modified.

## Development evidence

- `/api/health`: 200, version `20260730_003`.
- Unauthenticated `/api/v1/frogsleep/me` and
  `/api/v1/frogsleep/buddy/capabilities`: 401, not 404.
- Authenticated capability document: create, accept, preview, email delivery,
  activity, and share enabled; focus matching disabled.
- Capability route verifier: 16 passed, 0 failed.
- Canonical two-account smoke: sleep and focus accepted, same-key replay
  accepted, outgoing/incoming projections agreed, both relationships revoked.
- Account smoke: me 200, refresh 200, device register/delete 200, logout 200,
  revoked refresh 401, re-login 200.
- Invitation handoff HTML route: 200.
- SES delivery status observed: `queued`.

## Remaining production blockers

1. Install or generate an App Store provisioning profile for
   `com.hulusleep.app`; recreate the archive and prove
   `aps-environment=production` plus `get-task-allow=false`.
2. Configure development APNs credentials, verify topic
   `com.hulusleep.app` with sandbox enabled on a physical device, then verify
   production preflight with sandbox disabled.
3. Complete Tencent SES sender/template/callback configuration and capture
   `queued → provider_accepted → delivered` for a controlled mailbox.
4. Provision a third development QA account for wrong-account rejection and a
   separate disposable account for account deletion plus post-deletion token
   rejection.
5. Complete physical-device notification Deep Link, login restoration, and
   invitation preview restoration.

Production rollout is authorized only after these five items have attached
evidence and an assigned rollback owner.
