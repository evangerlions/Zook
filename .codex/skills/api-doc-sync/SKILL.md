---
name: api-doc-sync
description: Use this skill when adding, deleting, renaming, or changing any API interface, route, request shape, response shape, auth behavior, header contract, or error semantics in the Zook repository. This skill enforces that API changes must update the correct documentation before finishing the task.
---

# API Doc Sync

This skill is for Zook API work.

Use it whenever a change affects any of the following:

1. New route added
2. Existing route removed
3. Route path renamed
4. Request body changed
5. Response body changed
6. Header requirements changed
7. Auth behavior changed
8. Scope / appId validation changed
9. Error code or status code behavior changed
10. Public-vs-admin exposure changed

Do not treat documentation updates as optional. In this repo, API changes are incomplete until the matching docs are updated.

## What counts as API change

You must trigger this skill if the task changes any of these areas:

1. `src/app.module.ts`
2. `src/modules/**`
3. `src/services/**` when the service affects request/response contract
4. `src/core/guards/**`
5. `src/core/pipes/**`
6. `src/core/filters/**`
7. `src/shared/types.ts`
8. `apps/admin-web/app/lib/types.ts`
9. Any API test that proves route behavior changed

If you touched an endpoint indirectly through validation, permission checks, or config resolution, that still counts.

## Document placement rules

Choose the target doc by audience, not by implementation file.

### 1. External API docs

Update [README_API.md](../../../README_API.md) when the change affects:

1. External App / Web / H5 integrators
2. Public platform APIs under `/api/v1/auth`, `/api/v1/users`, `/api/v1/files`, `/api/v1/notifications`, `/api/v1/analytics`
3. Product-facing APIs such as `/api/v1/{productKey}/...`
4. Shared headers, auth rules, app scope rules, response format, or common error semantics

`README_API.md` is the external integration entrypoint.

Do not put admin-only routes there.

### 2. Public feature-specific docs

Update a focused public doc in `docs/public-*` when the change is a deep protocol change for one public capability.

Current example:

1. [docs/public-api-spec.md](../../../docs/public-api-spec.md) for QR login protocol details

If a public flow gets complex, keep `README_API.md` concise and move sequence details into a focused public doc.

### 3. Internal admin docs

Update [docs/admin-api-spec.md](../../../docs/admin-api-spec.md) when the change affects:

1. `/api/v1/admin/...`
2. Admin auth / bootstrap
3. Admin app management
4. Sensitive operation verification
5. Common workspace config APIs
6. Admin metrics
7. Admin-only request/response fields or validation rules

### 4. Implementation overview docs

Update [docs/current-backend-implementation-overview.md](../../../docs/current-backend-implementation-overview.md) when the change affects:

1. What the backend currently supports
2. Which API groups are now live
3. Major storage/runtime behavior
4. Important implementation milestones

This doc is not the main protocol contract. It is the "what is currently implemented" snapshot.

### 5. Design docs

Update a design doc only when the architectural/design intent changed, not for every small route tweak.

Examples:

1. [docs/admin-web-design.md](../../../docs/admin-web-design.md)
2. [docs/backend-i18n-design.md](../../../docs/backend-i18n-design.md)
3. [docs/small-medium-app-backend-design-discussion.md](../../../docs/small-medium-app-backend-design-discussion.md)

## Mandatory workflow

Follow this order:

1. Identify whether the changed API is external, internal admin, or both
2. Implement the code change
3. Update tests
4. Update the matching docs before finishing
5. In the final response, explicitly say which docs were updated

Do not leave doc updates as a suggestion for later.

## Required doc checks

For every API change, check these questions:

1. Did the route list change?
2. Did the method change?
3. Did the path shape change?
4. Did request fields change?
5. Did response fields change?
6. Did auth requirements change?
7. Did app scope behavior change?
8. Did the error code/status behavior change?
9. Did the intended audience of the endpoint change?

If the answer to any item is yes, docs need an update.

## How much detail to write

Keep docs practical and contract-focused.

### For route lists

Update the route inventory table with:

1. Method
2. Path
3. Short purpose

### For behavior notes

Update bullets for:

1. Required headers
2. Required auth
3. Request body constraints
4. Response semantics
5. Important error behavior

### For validation changes

If validation changed, document the user-visible rule, not the regex implementation detail unless useful.

Example:

Good:

```text
App ID only allows lowercase letters, numbers, and underscores.
```

Less useful:

```text
App ID matches ^[a-z0-9_]+$
```

## Zook-specific rules

### External vs internal split

In this repo:

1. [README_API.md](../../../README_API.md) is external only
2. [docs/admin-api-spec.md](../../../docs/admin-api-spec.md) is internal admin only

Never mix them again.

### Sensitive operation changes

If you change sensitive verification behavior, update:

1. [docs/admin-api-spec.md](../../../docs/admin-api-spec.md)
2. [docs/current-backend-implementation-overview.md](../../../docs/current-backend-implementation-overview.md) if the implemented behavior materially changed

Example: email verification changed to fixed 6-digit secondary password.

### Product public config changes

If you implement or remove `/api/v1/{productKey}/public/...` endpoints:

1. Update [README_API.md](../../../README_API.md)
2. Update [docs/current-backend-implementation-overview.md](../../../docs/current-backend-implementation-overview.md) if the backend support matrix changed

### Admin common workspace changes

If you change:

1. `common.email_service_regions`
2. `common.passwords`
3. `common.llm_service`
4. app-scoped `admin.delivery_config`

then update [docs/admin-api-spec.md](../../../docs/admin-api-spec.md). If the page/interaction model changes materially, also update [docs/admin-web-design.md](../../../docs/admin-web-design.md).

## Completion checklist

Before finishing an API task, verify:

1. Code changed
2. Tests changed or validated
3. Correct doc changed
4. No wrong-audience doc was updated instead
5. Final response names the updated doc paths

If docs were intentionally not updated, explain exactly why. "No doc changes needed" is only acceptable when the API contract truly did not change.

## Examples

### Example 1: add a new admin route

If you add:

```text
POST /api/v1/admin/apps/common/feature-flags/reload
```

you must update:

1. [docs/admin-api-spec.md](../../../docs/admin-api-spec.md)

and maybe:

1. [docs/current-backend-implementation-overview.md](../../../docs/current-backend-implementation-overview.md) if this is a meaningful new backend capability

### Example 2: add public product bootstrap

If you add:

```text
GET /api/v1/flutter_demo/public/config
```

you must update:

1. [README_API.md](../../../README_API.md)

and maybe:

1. [docs/public-api-spec.md](../../../docs/public-api-spec.md) if the flow needs protocol detail
2. [docs/current-backend-implementation-overview.md](../../../docs/current-backend-implementation-overview.md) if support status changed

### Example 3: tighten validation

If you change app creation so `appId` only allows lowercase letters, digits, and underscores:

1. Update code and tests
2. Update [docs/admin-api-spec.md](../../../docs/admin-api-spec.md)
3. If [README_API.md](../../../README_API.md) mentions that rule for external callers, update it there too

