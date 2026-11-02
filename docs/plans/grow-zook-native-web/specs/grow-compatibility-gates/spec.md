## ADDED Requirements

### Requirement: Existing observable behavior remains compatible
Existing Web routes, API status/envelopes, permissions, guest access, pagination, streaming, client-version rules, product flags and default model choices MUST remain compatible. New business requirements SHALL use additive contracts and migrations.

#### Scenario: Existing client exercises its contract
- **WHEN** existing Admin, FrogSleep, LightTick, BodyLog or AINovel clients call their established flows with Grow disabled and enabled
- **THEN** contract fixtures and authorization expectations pass in both modes with no newly required Grow credentials or payload fields

### Requirement: Disabled Grow has no new background side effects
Dedicated Grow functionality SHALL be gated independently of existing product master switches. Disabled Grow MUST NOT start Grow-specific jobs, require Grow secrets, contact external content providers or reserve extra database capacity.

#### Scenario: Existing deployment starts without Grow configuration
- **WHEN** the original three-service deployment starts with no new Grow-specific settings
- **THEN** its existing health and business checks pass and no Grow task is scheduled

### Requirement: Mixed-load acceptance
Grow SHALL have dedicated request/job/AI capacity limits. Releases MUST compare fixed-load baselines of existing products with Grow off/on, and reject new5xx or P95 degradation beyond the threshold fixed in the baseline stage, initially10%.

#### Scenario: Research task consumes its budget
- **WHEN** Grow import/research jobs reach their configured concurrency or CPU limit while existing APIs receive baseline traffic
- **THEN** Grow work is queued or rejected within its budget and the existing-product acceptance threshold still passes

### Requirement: Controlled release and non-destructive rollback
Code SHALL ship through main and the existing release scripts. Production promotion requires the same main SHA verified in dev. Rollback SHALL preserve database/file writes and MUST NOT restore a database snapshot or route new-user writes into the historical service.

#### Scenario: Failure after new data is saved
- **WHEN** Grow writes data and the new frontend is subsequently disabled or application code is rolled back
- **THEN** the saved data remains intact, existing APIs remain operational, and no destructive schema rollback or old-service write fallback occurs
