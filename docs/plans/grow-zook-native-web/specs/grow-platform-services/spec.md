## ADDED Requirements

### Requirement: Complete capability disposition
The migration MUST maintain a reviewed disposition for every inventoried operation and non-HTTP capability, including investment research, knowledge, calibration, exports and background work. A login/homepage demonstration SHALL NOT qualify as complete migration.

#### Scenario: Research implementation is missing
- **WHEN** an investment dataset provider, strategy function, export or background task lacks an accepted replacement
- **THEN** the ledger remains incomplete and overall migration cannot be marked complete by hiding its menu

### Requirement: Canonical contracts and single data authority
New product capabilities SHALL use `/api/v1/lighttick/...` contracts and existing Zook repositories where semantically equivalent. All records, documents, files and jobs MUST enforce owner scope, idempotency and explicit version conflicts. Each module MUST have one active writer.

#### Scenario: Retry or conflicting version
- **WHEN** a saved request is retried with its original key or a stale version is submitted
- **THEN** the original accepted result is returned for a matching replay and conflicting writes are rejected without overwriting newer data

### Requirement: Platform AI and durable background services
Grow SHALL use platform model routing, worker/job infrastructure, file authorization, audit and request tracing. Existing model/provider configuration MUST remain compatible. Job execution MUST enforce authorization, capacity, cancellation, idempotency and recoverability.

#### Scenario: Worker restarts or account is disabled
- **WHEN** a worker restarts during an AI/collection job or its owner is disabled before submission
- **THEN** the durable task reaches a recoverable terminal state without duplicate formal writes, and disabled owners cannot receive unauthorized new writes

#### Scenario: Legacy browser keys exist
- **WHEN** a user enters the new Grow Web with old browser AI credentials or GitHub settings
- **THEN** those secrets are not automatically uploaded or logged and platform scene configuration is used for new AI requests

### Requirement: No independent Python runtime in target deployment
The final Grow deployment MUST run without Python, pip, a Python child process or a Grow sidecar. Data providers and CPU-intensive work SHALL have audited Node-compatible or controlled external replacements and bounded execution outside the API event loop.

#### Scenario: Target image has no Python executable
- **WHEN** the integrated target image starts without Python and all Grow capability tests run
- **THEN** all accepted module workflows succeed through Zook API/worker paths and no request attempts to reach the legacy Python upstream
