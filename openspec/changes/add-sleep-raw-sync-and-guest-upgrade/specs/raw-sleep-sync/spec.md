## ADDED Requirements
### Requirement: Private raw terminal sleep history
The backend SHALL store bounded, validated terminal sleep sessions as account-scoped revisioned resources and expose restore, changes, deletes and idempotent retries.
#### Scenario: Recovery and deletion
- **WHEN** an authenticated account uploads, updates and deletes a session
- **THEN** restore and changes expose the correct latest revision and tombstone without reviving deleted data.
#### Scenario: Invalid or cross-account writes
- **WHEN** a request has invalid timestamps, oversized payload, stale revision/epoch or forged ownership
- **THEN** it fails without committing any resource or receipt.
