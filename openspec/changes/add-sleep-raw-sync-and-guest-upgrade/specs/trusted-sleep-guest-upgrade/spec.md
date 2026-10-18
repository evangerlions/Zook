## ADDED Requirements
### Requirement: Proof-based guest identity
The backend SHALL issue scoped guest sessions using a client-held random secret and store only credential hashes. Device identifiers alone MUST NOT authorize recovery or upgrade.
#### Scenario: Recovery and isolation
- **WHEN** the exact device proof is retried
- **THEN** the same unexpired guest identity is recovered, while guests cannot access other platform capabilities.
### Requirement: Atomic registered-account upgrade
The backend SHALL require registered target authentication, transfer proof, consent, target epoch and an idempotency key. It SHALL move private history atomically, retain tombstones, reject target conflicts and revoke source access.
#### Scenario: Replay and collisions
- **WHEN** an exact transfer is retried after a lost acknowledgement
- **THEN** the stored result is returned once; conflicting content or another target cannot receive the guest data.
#### Scenario: Rollback
- **WHEN** any target resource conflicts or persistence fails
- **THEN** neither account's ownership, sync history nor transfer receipt changes.
