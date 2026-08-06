# API Contracts

Zook owns its public OpenAPI source in `api-contracts/`. This directory was migrated from the former standalone API repository so interface changes and their server implementation can be reviewed and versioned in one commit.

## Ownership and directory boundaries

```text
api-contracts/openapi/**
        │ maintenance-time generation
        ▼
src/generated/openapi/public-contracts.generated.ts
        │ imported by Zook runtime code
        ▼
API and worker processes
```

- `api-contracts/openapi/**` is the canonical external contract source.
- `src/generated/openapi/**` is the committed runtime boundary.
- `src/` and `apps/` must not directly import or read `api-contracts/`.
- The nested `api-contracts/package.json` is lint tooling only. It is not a root npm workspace and is not installed by the root project.
- `.dockerignore` excludes `api-contracts/`; production images do not receive contract source or lint dependencies.
- The former API repository, submodule, and synchronization script are retired. There is no fallback source.

## Change workflow

1. Modify the relevant YAML under `api-contracts/openapi/**`.
2. Update protocol notes and Zook API documentation in the same change.
3. Regenerate committed runtime contracts:

   ```bash
   npm run generate:public-contracts
   ```

4. Confirm the generated file matches the source:

   ```bash
   npm run check:api-contracts
   ```

5. Lint the OpenAPI source when contracts change. The lint dependency is deliberately installed inside the isolated directory:

   ```bash
   npm ci --prefix api-contracts --ignore-scripts
   npm run lint:api-contracts
   ```

6. Run the affected Zook tests and commit OpenAPI, documentation, and generated output together.

The generator fails if any required contract is missing. It never falls back to a workspace checkout or an external clone.

## External consumers

AINovel, ZAnalytics, or another client generator should pin the Zook commit containing the desired contract and export only `api-contracts/`. A consumer must not depend on the entire Zook Node application or assume the retired API repository still receives updates.

Consumer automation should record the pinned Zook revision beside generated output so the exact contract can be reproduced.

## Migration provenance

The initial embedded contents were copied from the former API repository's `main` revision:

```text
98bb27e82016cfe21d84a7c5ce6789eedf17e7a8
```

This revision is provenance only; subsequent contract development happens in Zook.
