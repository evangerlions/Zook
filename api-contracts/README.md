# Zook API Contracts

`api-contracts/` is the Zook-owned source of truth for public OpenAPI contracts. It was migrated into Zook from the former standalone API repository at revision `98bb27e82016cfe21d84a7c5ce6789eedf17e7a8`.

## Contents

- `openapi/` — canonical external OpenAPI specifications
- `openapi/bodylog/api.yaml` — BodyLog profile, social, leaderboard, invitation, and challenge APIs
- `openapi/frogsleep/api.yaml` — FrogSleep app-scoped public API
- `openapi/lighttick/api.yaml` — LightTick app-scoped planning, execution, review, AI-run, sync, device, and deletion API
- `docs/` — protocol and consumer workflow notes
- `package.json` and `package-lock.json` — reproducible, isolated OpenAPI lint tooling
- `API.toml` and `_ACTIVE.md` — lightweight ownership metadata

## Build boundary

This directory is a maintenance-time asset, not a runtime package:

- Zook runtime code consumes committed files under `src/generated/openapi/`.
- Root `npm install`, TypeScript execution, and production Docker images do not install or copy this directory.
- The nested `package.json` exists only for OpenAPI linting and is not a root npm workspace.
- Runtime code must not import or read files from this directory.

## Zook workflow

Run from the Zook repository root:

```bash
npm run generate:public-contracts
npm run check:api-contracts
```

Install and run the isolated lint tool when the OpenAPI source changes:

```bash
npm ci --prefix api-contracts --ignore-scripts
npm run lint:api-contracts
```

Commit OpenAPI changes, related documentation, and regenerated runtime contracts together.

External consumers should pin a Zook commit and export only `api-contracts/` when they need a stable contract snapshot. The former standalone API repository and its submodule flow are no longer authoritative.

## LightTick consumers

LightTick iOS and Android clients consume the same `lighttick/api.yaml` snapshot. Zook owns
the wire contract and generated runtime types; native packages and shared success/error fixtures
live under `api-contracts/clients/lighttick/` and `api-contracts/fixtures/lighttick/`. Contract
changes must regenerate and compile-test both native packages before merge.
