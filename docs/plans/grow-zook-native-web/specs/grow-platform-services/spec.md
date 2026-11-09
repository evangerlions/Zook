## ADDED Requirements

### Requirement: Existing LightTick domain authority
Grow, iOS and Android SHALL submit commands to the same LightTick domain services and canonical `/api/v1/lighttick/...` contracts. Zook SHALL enforce owner membership, state, versions and idempotency. Other Apps MUST retain their isolation and behavior.

#### Scenario: Multiple clients edit a record
- **WHEN** Web and mobile edit the same record from one base version
- **THEN** the domain service accepts the valid mutation and exposes conflicts without overwriting newer data or discarding local input

### Requirement: Explicit per-domain synchronization coverage
Implementation SHALL verify command support, receipts, transactional change logs, pull projections and client application for each domain. Existing task-only sync push MUST NOT be represented as complete write synchronization for records, learning or other entities.

#### Scenario: Unsupported entity is inventoried
- **WHEN** a contract enum names an entity whose push handler is not implemented
- **THEN** that capability remains an explicit gap and its domain API/queue is used until a validated extension exists

### Requirement: Native learning authority transition
Course versions and private learning SHALL move from legacy source mirrors/receipts to native Zook authority only after owner-scoped freeze, import, reconciliation and an atomic authority transition. Existing IDs, versions, authorization and operation receipts MUST remain traceable.

#### Scenario: Old private command is pending during cutover
- **WHEN** a client retries an already accepted command after authority switches
- **THEN** the migrated receipt or compatible native handler resolves the same operation without waiting for a removed Python source or applying it twice

### Requirement: Zook conventions and platform reuse
All backend changes SHALL follow Zook module, repository, migration, application composition, contract generation, documentation and release conventions. Platform AI/files/worker SHALL be reused with bounded resources, stable model identities and execution-local state.

#### Scenario: New Web-only research feature
- **WHEN** research is added to the LightTick product
- **THEN** its domain, contract, storage and worker execution extend the existing service topology without creating a new App identity or backend process
