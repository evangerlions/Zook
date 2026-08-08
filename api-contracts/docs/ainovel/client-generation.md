# AINovel Client Generation Workflow

## Source of truth

The canonical consumer contract is:

```text
Zook/api-contracts/openapi/ainovel/client.yaml
```

It is consumed by both the Flutter AINovel app and the TypeScript/Node ZAnalytics API. The former standalone API repository and submodule synchronization workflow are retired.

## Zook runtime generation

From the Zook repository root:

```bash
npm run generate:public-contracts
npm run check:api-contracts
```

The generator reads only `api-contracts/openapi/**` and writes committed runtime types to `src/generated/openapi/public-contracts.generated.ts`.

## External consumers

When refreshing AINovel or ZAnalytics clients:

1. Pin the exact Zook commit that contains the desired contract.
2. Export or copy only `api-contracts/` into the consumer's contract input location.
3. Run that consumer's API generation command.
4. Commit the pinned Zook revision, contract snapshot, and generated client output together.

Do not add the Zook repository as a Node dependency or workspace. Consumer automation should also stop treating the former API repository as authoritative.

## Current manual client exception

- `POST /api/v1/ai_novel/feedback` is documented here because it is a product-external client contract.
- The AINovel app currently calls it through the shared `YouwoCore` business client (`postBusiness("feedback")`) rather than the generated `zook_api_client`.
- When the consumer client is refreshed from a pinned Zook contract snapshot, this endpoint can be moved into the generated client path.

## Admin contracts

Admin-only endpoints are excluded from `openapi/ainovel/client.yaml`. The AINovel feedback Admin API is specified separately in `openapi/ainovel/admin-feedback.yaml`, including list/filter, status update, and private attachment proxy endpoints.
