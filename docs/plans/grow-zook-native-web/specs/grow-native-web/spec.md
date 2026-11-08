## ADDED Requirements

### Requirement: React Web as a LightTick client
Grow SHALL be a statically built React/TypeScript Web client in plan/LightTick-Web, managed by the plan repository alongside native-client planning and use the existing LightTick product identity and membership. It MUST NOT create a separate Grow appId or duplicate product data/API solely for the Web surface.

#### Scenario: Existing LightTick user opens Grow
- **WHEN** a member signs into Grow
- **THEN** the applicable existing LightTick resources use the same canonical IDs and permissions without pairing a newly created Grow product

### Requirement: Independent sessions and local state
Web, iOS and Android SHALL use independent secure device sessions for the same product. Local drafts, queues and caches MUST be partitioned by canonical environment/appId/userId. Login MUST NOT automatically upload device-only content.

#### Scenario: Account changes with a pending edit
- **WHEN** the user changes accounts during an edit or unresolved mutation
- **THEN** prior requests stop, private state stays scoped to its owner and no paid or mutating request is replayed as the new user

### Requirement: Existing static hosting and artifact compatibility
Grow SHALL build versioned static artifacts hosted by the existing Web process at `/grow/`, without a dedicated service, Python dependency or SSR process. The release MUST bind artifact digest, source commit and compatible backend contracts.

#### Scenario: Missing artifact or resource
- **WHEN** an enabled release lacks a compatible artifact or a browser requests a missing asset
- **THEN** release preflight rejects an invalid artifact and missing assets return404 rather than API or asset requests receiving SPA HTML
