# FrogSleep account deletion and buddy safety

## Goal

Make FrogSleep ready for App Store account and user-generated-content requirements without changing a user's account or data in other Zook products.

## Account deletion

The iOS app will call the existing `DELETE /api/v1/frogsleep/me/account` endpoint. The endpoint remains app-scoped: it deletes FrogSleep membership and FrogSleep-owned runtime data, revokes FrogSleep sessions, and retains the shared Zook user and every other app membership.

After a successful response, iOS clears the Keychain session, account presentation state, shared-guardianship relationship/session/report state, and local buddy cache before returning the customer to the signed-out state. A failed request leaves local state intact and presents a recoverable error.

## Safety controls

FrogSleep buddy messages are restricted to predefined encouragement templates. Zook rejects `custom_text` so an older client cannot introduce free-text messaging.

Matching profile display names and bios are checked by Zook's existing content-safety service before they are stored or surfaced. A sensitive result is rejected without persisting the profile change and is recorded by the existing content-safety audit path.

## Reports and blocks

Zook adds app-scoped report and block records:

- `POST /api/v1/frogsleep/focus-buddy/users/{userId}/report` creates a report for another user with an enumerated reason. Reports are de-duplicated for an unresolved reporter-target-reason tuple.
- `PUT /api/v1/frogsleep/focus-buddy/users/{userId}/block` creates an active block and revokes any focus-buddy relationship between the pair.
- `DELETE /api/v1/frogsleep/focus-buddy/users/{userId}/block` removes the current user's block.
- `GET /api/v1/frogsleep/focus-buddy/blocked-users` lists the caller's active blocks.

An active block is bilateral for discovery and communication: neither person can appear in matching, create or accept a focus invite, exchange messages, or access presence, comparison, or shared-moment data with the other. Reports remain visible to operations and do not expose reporter identity to the reported user.

The report records use the FrogSleep entity store, with an operator status of `open`, `reviewing`, `resolved`, or `dismissed`. Admin endpoints expose a bounded report queue and allow a privileged operator to change status with an audit entry.

## iOS behavior

The account sheet provides a destructive delete-account action with a confirmation alert. The match result card offers a destructive safety menu for report and block. A successful report removes the candidate from the current list; a successful block also removes it and refreshes relationship state. All new copy is localized.

## API and data flow

```text
iOS safety action
  -> FocusAPIClient
  -> /api/v1/frogsleep/focus-buddy/users/:id/report|block
  -> FrogSleepFocusBuddyService
  -> FrogSleep entity records + relationship revocation
  -> admin review queue / audit log
```

## Verification

Zook unit/API tests prove account deletion remains app-scoped, custom text is rejected, unsafe profile input is rejected, reports are de-duplicated, and a block isolates every buddy endpoint. iOS tests prove account deletion clears only local FrogSleep state and that report/block feedback maps to localized UI state. Zook's public API documentation describes all new endpoints and deletion semantics.

## Scope boundaries

This change does not delete platform-wide Zook users, alter other product memberships, introduce arbitrary chat, or add a new third-party moderation provider. It reuses the existing Content Safety service and admin authentication model.
