## ADDED Requirements

### Requirement: Grow as a product in the multi-App platform
Grow SHALL have its own product namespace `/api/v1/grow/...` and registered app scope within existing Zook API/worker infrastructure. Authentication, membership, configuration, files, LLM and logging SHALL reuse platform services. URL namespace or browser-supplied owner fields MUST NOT override verified appId/userId.

#### Scenario: Cross-product request
- **WHEN** a user authorized only for LightTick requests a Grow private resource
- **THEN** existing platform membership and permissions determine access and no LightTick private record is automatically shared

### Requirement: Native domain modules and stable contracts
Grow business logic SHALL reside in `src/modules/grow` with Zook application services, route composition, repository adapters and migration runner. Public contracts SHALL originate only in `api-contracts/openapi/**`, generate committed runtime/client outputs and update API documentation in the same change. Runtime MUST NOT read the contract source directory or import another product's private repository.

#### Scenario: New Grow module
- **WHEN** a product capability is added
- **THEN** its contract, domain rules, owner-scoped persistence, frontend feature and tests are delivered without a new backend service

### Requirement: Data and workflow invariants
Writes SHALL enforce idempotency, version conflicts and owner scope. Draft publication, immutable lesson versions, private notes and explicit completion SHALL remain distinct. Monetary results SHALL preserve exact precision and documented market/time conventions.

#### Scenario: Request replay and stale edit
- **WHEN** an accepted request is replayed with the same key or a stale edit is submitted
- **THEN** replay returns its accepted result and stale writes preserve newer data without silent overwrite

### Requirement: Platform AI and bounded durable jobs
Grow SHALL use product-specific AI scenes and budgets, existing logical models/provider routes and bounded worker tasks. Request/user/stream/job state MUST remain execution-local. Provider adapters and compute MUST NOT require Python, a sidecar or arbitrary user code execution.

#### Scenario: Job restarts or owner is disabled
- **WHEN** a worker restarts or membership is disabled during execution
- **THEN** durable state enables recovery without duplicate formal writes and permissions are rechecked before execution and commit
