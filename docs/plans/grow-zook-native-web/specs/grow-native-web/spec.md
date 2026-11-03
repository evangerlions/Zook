## ADDED Requirements

### Requirement: Same deployment and isolated Web routing
The system SHALL serve Grow under `/grow/` using the existing Web process and image without a dedicated Grow backend, port, or container. Existing Admin and handoff routing MUST remain compatible.

#### Scenario: Grow deep link and missing resources
- **WHEN** Grow is enabled and a user opens `/grow/learning` or a missing `/grow/assets/missing.js`
- **THEN** the deep link returns Grow HTML and the missing resource returns404, while `/config` still returns the existing Admin application

#### Scenario: Prefix boundary and disabled mode
- **WHEN** Grow is disabled or a request is for `/grower` or an encoded path traversal
- **THEN** only the exact Grow namespace is affected by its disabled state, traversal is rejected, and existing routing behavior outside Grow remains unchanged

### Requirement: Existing ordinary user identity
Grow MUST authenticate through existing Zook ordinary-user contracts and application membership, with server-verified appId/userId ownership. Admin authentication SHALL remain separate. Grow MUST NOT silently provision or link old Grow accounts by username.

#### Scenario: User and app isolation
- **WHEN** user B or a token for another app requests user A's Grow resource
- **THEN** access is denied without leaking the resource body, and browser-supplied owner headers cannot grant access

#### Scenario: Session expiry with unsaved input
- **WHEN** the user session expires or another tab changes the active user while an editor has unsaved input
- **THEN** requests under the previous identity stop, draft content is protected, and no save or paid generation is automatically replayed

### Requirement: Independent frontend lifecycle with reusable components
Grow SHALL have an independent frontend build and session provider. Shared components MUST have no dependency on Admin permissions or session state, and Grow assets/styles MUST NOT alter Admin runtime behavior.

#### Scenario: Grow build or runtime failure
- **WHEN** Grow assets are missing in a disabled deployment or a Grow component fails
- **THEN** Admin can still boot and authenticate, while the Grow namespace reports its own unavailable/error state

### Requirement: Historical service remains intact
The migration SHALL preserve existing Grow historical data, account credentials, GitHub configuration, AI settings and the old deployment unless the user separately authorizes their migration.

#### Scenario: New Zook user enters Grow
- **WHEN** a Zook user opens Grow after login
- **THEN** their own product space is used and matching old usernames do not cause historical data import or password copying
