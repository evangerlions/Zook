## Why
Sleep reports sync safely, but raw sleep sessions have no canonical cloud resource and device identifiers cannot authorize guest ownership transfers. Clients need recoverable private history and a proof-based, atomic upgrade into a registered account.

## What Changes
- Add terminal raw sleep sessions to private revisioned sync, restore, changes and tombstones.
- Issue scoped guest identities using a client-held random secret; require independent transfer proof and registered target authentication for atomic, idempotent upgrades.
- Preserve target data on conflicts and revoke source access after transfer.
- Update OpenAPI, generated contracts, public documentation and PostgreSQL/in-memory verification.

## Capabilities
### New Capabilities
- `raw-sleep-sync`: Private terminal session storage with validation and recovery.
- `trusted-sleep-guest-upgrade`: Scoped guest credentials and atomic ownership transfer.
### Modified Capabilities

## Impact
FrogSleep routes/auth, personal sync adapters, PostgreSQL migrations, contracts and integration docs. No deployment or client application changes.
