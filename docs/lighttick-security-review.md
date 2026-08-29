# LightTick Security Review

Scope: LightTick public APIs, persistence, AI runs/tools, sync, notifications, Admin, and account deletion.

- App scope and enumeration: every route uses the shared product authenticator for fixed `app_id=lighttick`; repositories bind reads/writes to `app_id + user_id`; foreign-owner lookups return the same not-found response.
- JWT/session state: access Token version, expiry, app membership, deleted membership, and `X-App-Id` equality are enforced before product handlers. App deletion revokes only LightTick sessions.
- Guest upgrade: missing and incorrect guest proofs are indistinguishable; expired/revoked guests, guest targets,
  cross-app tokens, reused operations owned by another formal account, and guest aggregates that reference a
  third-party owner are rejected before migration. Relationship conflicts roll back the PostgreSQL transaction.
- Idempotency abuse: keys are owner-scoped; canonical payload hashes prevent key reuse with a different payload; first results are replayed; sync batches are capped at 50.
- Concurrency/conflicts: aggregate versions use database CAS. Mutually exclusive terminal task actions and stale proposals return stable conflicts with server snapshots and bounded resolution actions.
- AI/prompt injection: user text is serialized as input data beneath a server-owned Prompt. JSON Schema and deterministic time/date/ownership/material-change validators run before persistence. Agent Tools expose only proposal accept/reject with explicit confirmation and current version; no SQL Tool exists.
- Privacy/logging: context assemblers omit notes and Coach text. log/analytics allowlists redact Tokens, verification codes, push Tokens, provider keys, Prompt bodies, private notes, and user text. Admin returns aggregates only and audits access.
- Devices: platform/provider pairs and Tokens are scoped per owner. Invalid APNs/FCM Tokens are disabled; cross-app notification jobs are rejected.
- Deletion isolation: all LightTick product, event, AI, operation, sync, proposal, and device tables are removed while the global user and other app memberships/sessions/data remain.

Evidence is covered by the LightTick boundary, account-security, repository, state-machine, API, AI, Worker,
sync, notification, Admin, E2E, deletion, and real PostgreSQL concurrency/rollback suites.
