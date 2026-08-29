# LightTick unified backend implementation guide

## Runtime ownership

Zook is the single production backend for LightTick. LightTick is registered as
an app-scoped product with canonical business APIs under
`/api/v1/lighttick/...`. Common identity, membership, RBAC, notification,
analytics, logging, file, configuration, and LLM provider capabilities remain
owned by existing Zook Common modules.

The repositories below are reference-only for the new runtime:

- `/Users/hao/Documents/project/plan/lighttick-backend`: legacy Go endpoint,
  prompt, schema, and fallback intent. It must not receive production writes.
- `/Users/hao/Documents/project/plan/lighttick_flutter`: historical UI/mock
  prototype. It is not the production client implementation.
- `/Users/hao/Documents/project/plan/lighttick-backend/prototype/index.html`:
  interaction reference for the latest Today/Journey concept.

Production clients are native SwiftUI and Jetpack Compose applications. They
share generated API contracts and fixtures, not UI or lifecycle code.

## Required module boundaries

```text
api-contracts/openapi/lighttick/**
        -> src/generated/openapi/**
        -> src/app/lighttick-v1-routes.ts
        -> src/modules/lighttick/**
        -> LightTickRepository
        -> PostgreSQL zook_lighttick_* tables
```

LightTick modules may depend on stable Zook platform ports. Common modules must
not import LightTick product services or types. Runtime code must not read
`api-contracts/` directly.

Suggested layout:

```text
src/modules/lighttick/
  lighttick-app.ts
  domain/
  application/
  ai/
  sync/
  notifications/
  lighttick-repository.ts
src/infrastructure/database/postgres/
  postgres-lighttick-repository.ts
src/app/
  lighttick-v1-routes.ts
```

## Business truth and mutation rules

- PostgreSQL is the only service-side business truth.
- Redis is limited to cache, rate limit, locks, and queue coordination.
- A task command transaction validates owner/version/idempotency, updates the
  aggregate, appends an immutable execution event, and appends a sync change.
- AI output is a proposal. It cannot directly update user commitments.
- Material plan changes require a persisted diff and explicit acceptance.
- Worker payloads carry stable IDs and reload state from PostgreSQL.
- Request, stream, run, retry, and tool-call state stays request/session local;
  it must not be stored on singleton service fields.

## Progressive action loop

The action-first path is an additive product-domain extension. It preserves the
existing plan-first `/api/v1/lighttick/onboarding` route and adds:

```text
POST /api/v1/lighttick/onboarding/starter
POST /api/v1/lighttick/onboarding/first-action
POST /api/v1/lighttick/onboarding/commitment
POST /api/v1/lighttick/tasks/{taskId}/variant
```

Starter generation always has a deterministic 5–15 minute fallback and never
requires an LLM response. First-action feedback is factual only. Standard,
light, and minimum variants share one lineage; minimum completion is a valid
action but does not satisfy the standard commitment. Pause metadata and
recovery mode are stored only in LightTick tables and do not modify Common or
other product behavior. Migration `032_lighttick_progressive_action_loop.sql`
is intentionally numbered after the in-flight 027–031 migrations on `main`.

Native delivery uses the committed Swift Package and Kotlin contracts under
`api-contracts/clients/lighttick/`. Production UI belongs in explicit SwiftUI
and Jetpack Compose app repositories; the historical Flutter prototype is not
a deployment target.

## Implementation order

1. Contract and generated models.
2. App registration and security boundary.
3. Upgrade-safe PostgreSQL schema and repository.
4. Deterministic state machines and core-loop services.
5. HTTP routes and provider-free acceptance tests.
6. AI scenes, schemas, validators, persisted runs, and Worker jobs.
7. Offline sync.
8. Devices, notifications, analytics, logs, and Admin controls.
9. Native-client contract verification and dev rollout.

Do not begin with live LLM calls. The core loop must pass with a fake provider
and deterministic fixtures first.

## Branch and release discipline

Implementation started from clean `origin/main` in the isolated worktree:

```text
/Users/hao/Documents/project/plan/.worktrees/lighttick-unified-backend
branch: feature/lighttick-unified-backend
```

The original `/Users/hao/Documents/project/Zook` worktree contains user-owned
BodyLog changes and must not be modified, stashed, reset, or merged as part of
LightTick work.

The feature branch can merge only into `main`. Releases must follow Zook's
`main -> release_dev.sh -> same-SHA validation -> release_online.sh` process.

## Definition of done for a capability

A LightTick capability is complete only when all applicable items are present
in the same change:

- OpenAPI source and generated runtime contract.
- Public or Admin documentation.
- App-scope, ownership, validation, and error behavior.
- In-memory deterministic tests.
- Real PostgreSQL migration/transaction/concurrency tests.
- Privacy-safe logging and audit behavior.
- Swift/Kotlin shared fixture compatibility where externally consumed.
- Independent disable/rollback behavior.
