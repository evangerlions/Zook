## ADDED Requirements

### Requirement: Existing functionality has explicit disposition
The migration SHALL inventory current Grow routes, pages, workflow states, formulas, exports, materials and non-HTTP tasks. Each item MUST map to an accepted implementation or explicit approved replacement with behavioral evidence. Hidden menus or a login demonstration SHALL NOT qualify as completion.

#### Scenario: Research dependency is missing
- **WHEN** a market provider, strategy result or export lacks an accepted replacement
- **THEN** the item remains incomplete and the overall migration cannot be declared complete

### Requirement: Existing products remain compatible
LightTick and other products SHALL retain existing contracts, permissions, default models and feature flags. Grow off/on regression and mixed-load tests MUST verify agreed latency, error, database and queue thresholds.

#### Scenario: Grow budget is exhausted
- **WHEN** Grow research jobs consume their allocation
- **THEN** work is queued or rejected within that budget and existing-product acceptance thresholds still pass

### Requirement: No rejected deployment dependencies
The new source and release topology MUST NOT include `services/grow`, Grow Python images, source locks, dedicated release groups or the legacy Python proxy. Source cleanup MUST remain distinct from historical-server and volume retirement.

#### Scenario: Clean source is built
- **WHEN** the supported release topology is built and started
- **THEN** only existing Zook services are required and no dependency reaches the removed Grow backend

### Requirement: Verified historical import and single writer
Historical data import SHALL require verified ownership, source-to-canonical mappings, dry-run comparisons and idempotency. Unknown completion timestamps MUST remain unknown. Product or account names MUST NOT automatically merge identities. Each migrated dataset SHALL have one active writer.

#### Scenario: Repeated authorized import
- **WHEN** the same historical dataset is imported twice
- **THEN** stable mappings prevent duplication and versions, source links and private ownership remain intact

### Requirement: Zook release flow and compatible rollback
Changes SHALL enter main before release scripts. Online promotion SHALL use the same backend SHA and frontend artifact verified in dev. Rollback MUST use a verified compatible pair and preserve accepted database/file writes, without restoring the whole database or forwarding new-user writes to a historical service.

#### Scenario: Backend rollback is incompatible
- **WHEN** the previous backend cannot serve the current frontend contract
- **THEN** deployment selects a compatible verified pair or disables Grow while preserving saved data
