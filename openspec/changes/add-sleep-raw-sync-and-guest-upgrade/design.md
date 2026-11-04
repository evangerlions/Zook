## Context
Personal sync already provides account locks, immutable revisions, epochs, signed cursors and tombstones. Guest ownership by device ID was disabled because identifiers do not prove ownership.

## Goals / Non-Goals
**Goals:** Raw terminal history and safe, recoverable guest upgrades with matching contracts.
**Non-Goals:** Restoring live device locks, client UI changes, sleep diagnosis, release deployment.

## Decisions
- Reuse personal sync for `sleep_session`; validate bounded raw JSON and terminal timestamps. Runtime locks stay local.
- Create guest identities with a cryptographically random client secret; persist only hashes. Derive a recoverable upgrade credential using HMAC with the client secret and server-generated guest ID. A device ID alone confers no rights.
- Use regular auth sessions with a guest capability allowlist. Guests can only sync private sleep records/preferences and inspect/logout their session.
- Transfer latest private resources, including tombstones, inside one database transaction; serialize source and target account locks. Identical target data deduplicates; differing data conflicts and rolls back all writes. Preserve the target epoch and invalidate the source epoch and membership.
- Persist transfer receipts in that transaction. Exact authenticated replay returns the original result and retries session revocation after SQL commit.
- PostgreSQL adapters join the ambient transaction. The in-memory guest unit of work snapshots its owned state to provide equivalent rollback.

## Risks / Trade-offs
- Guest secrets must be retained in secure client storage; loss cannot be recovered from a device ID → explicitly document rotation and local import fallback.
- SQL and KV revocation cannot commit atomically → membership revocation is in SQL; replay retries KV cleanup.
- Large transfer transactions → resource limit and paged reads; reject oversized transfers before mutation, never truncate.

## Migration Plan
Add idempotent migrations for raw kind and guest identity/receipts. Generate contracts and run migration replay plus transactional PostgreSQL tests before main merge. Sync feature flags can disable private writes without schema rollback.
