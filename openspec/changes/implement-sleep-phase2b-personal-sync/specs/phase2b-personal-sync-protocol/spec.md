## ADDED Requirements

### Requirement: Idempotent private resource writes

The backend MUST enforce account-scoped stable snapshot IDs and operation keys, comparing payload digests and resource revisions.

#### Scenario: Lost acknowledgement
- **WHEN** the same snapshot and operation are retried concurrently
- **THEN** only one logical resource exists and conflicting payloads return a documented conflict

### Requirement: Commit ordered restore and changes

The backend MUST provide complete database pagination, a fixed restore boundary and account scoped commit ordered change checkpoints.

#### Scenario: More than five hundred
- **WHEN** a user has more than five hundred records with concurrent writes
- **THEN** all authorized records remain reachable without pagination omission

### Requirement: Deletion cannot be resurrected

The backend MUST emit tombstones atomically and MUST invalidate old epochs before compacting deletion protection.

#### Scenario: Stale upload
- **WHEN** an old device retries an already deleted resource
- **THEN** the write is rejected until safe reconciliation rather than recreating data

### Requirement: Membership deletion includes sync storage

The backend SHALL clean all new private sync storage in the existing app-scoped deletion lifecycle.

#### Scenario: Delete and recreate membership
- **WHEN** FrogSleep membership is deleted and later recreated
- **THEN** the new epoch cannot accept old pending writes and other app data remains unchanged
