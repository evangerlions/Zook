# FrogSleep buddy invitation verification

Last updated: 2026-07-24

This record separates local implementation evidence from development and
production rollout evidence. Local success does not imply that email delivery
or the new routes are live in either remote environment.

## Local verification

| Gate | Result | Evidence |
| --- | --- | --- |
| Backend unit and contract suite | Pass, 636/636 | `npm test` |
| PostgreSQL concurrency suite | Pass, 6/6 | `FROGSLEEP_TEST_DATABASE_URL=... npm run test:postgres:buddy` against disposable PostgreSQL 16; migrations 000 through 017 applied |
| iOS focused unit suite | Pass, 38/38 | `BuddyCapabilityTests`, `BuddyInvitationAPIRepositoryTests`, `BuddyInvitationServiceTests`, and `BuddyRouterTests` |
| iOS invitation UI smoke | Pass, 4/4 | Invitation Center accessibility, inbox/outbox consent, email creation result, and login-return restoration on the iPhone 17 Pro simulator |
| Local two-account API/worker smoke | Pass | Two isolated accounts created and accepted one bundled invitation; both sleep and focus results were `accepted` and both relationship views agreed |
| OpenSpec and generated contracts | Pass | Strict OpenSpec validation, generated-contract drift, documentation, and source line-count checks |

The local smoke returned a queued delivery because it used no Tencent Cloud SES
credentials. Code/link acceptance remained available and the accepted
invitation was eligible for worker suppression. This is expected local behavior
and is not evidence of provider delivery.

The UI smoke uses Debug-only invitation and capability repositories. The
capability fixture is required so an unauthenticated network capability request
does not incorrectly close the invitation screen during UI acceptance tests.

## Development preflight

Read-only probe on 2026-07-24:

- `https://app-dev.youwoai.net/api/health` returned healthy.
- Reported backend version remained `20260719_002`.
- Seven existing authenticated/legacy routes were mounted.
- Fifteen new buddy invitation, notification, and growth routes returned
  `404`, including the canonical invitation create/list/preview routes.
- No development credentials, SES provider delivery, callback, worker, APNs,
  or two-account remote journey were claimed as verified.

Conclusion: the implementation has not yet been deployed to the development
slot. OpenSpec rollout tasks 8.1 through 8.8 must remain open until the dev
deployment, real provider checks, controlled production rollout, and evidence
reconciliation are completed.
