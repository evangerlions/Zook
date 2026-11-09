## ADDED Requirements

### Requirement: Same-object continuity and native independence
The three clients SHALL preserve canonical object identity, versions, history and product semantics. Native basic planning, execution and reflection MUST remain usable without Grow Web or AI.

#### Scenario: Web is disabled
- **WHEN** Grow Web and optional AI enhancement are unavailable
- **THEN** native local/basic cloud workflows remain usable under their existing service and identity requirements

### Requirement: Durable synchronization and visible conflicts
Confirmed mutations, receipts and change logs SHALL have a verified consistency boundary. Clients MUST apply durable projections before advancing owner-scoped cursors, preserve unresolved input, handle expired cursors and reject unauthorized stale writes. Old clients MUST receive compatible entities or negotiated coverage.

#### Scenario: Process dies after receiving a page
- **WHEN** a client dies while applying changes or before persisting its next cursor
- **THEN** replay neither duplicates accepted effects nor permanently loses changes and local drafts remain recoverable

### Requirement: Explicit completion and immutable publication
Reading position, notes, answers, explicit lesson completion, action completion and practice outcomes SHALL remain distinct. A content update MUST NOT overwrite old-version private answers or silently mark a practice complete.

#### Scenario: Published content changes during an offline edit
- **WHEN** a mobile client has an old-version note and Web publishes a new lesson version
- **THEN** both content/version references remain available within authorization and the user can resolve private edits without silent replacement

### Requirement: Preserved legacy scope and historical data
Historical import SHALL verify identity, permissions, mappings and receipts without username-based account merging or dual writers. Authority changes MUST reject late old-source writes and preserve unknown timestamps as unknown. Removed Grow deployment code MUST NOT be restored as a new-client runtime dependency.

#### Scenario: Late source event arrives
- **WHEN** an old bridge sends a write after its module authority was switched
- **THEN** the server rejects or reconciles it under the recorded authority boundary without overwriting canonical data

### Requirement: Functional and release evidence
Every inventoried capability MUST have implementation or an explicit accepted disposition with behavioral evidence. Existing Apps SHALL pass off/on regression and agreed mixed-load gates. Release SHALL follow main/dev/same-SHA online with a fixed compatible frontend artifact; native binary compatibility MUST be recorded separately.

#### Scenario: New server version is promoted
- **WHEN** a verified candidate is promoted
- **THEN** its existing mobile contracts remain supported and neither historical database writes nor local-only data are replaced by a rollback snapshot
