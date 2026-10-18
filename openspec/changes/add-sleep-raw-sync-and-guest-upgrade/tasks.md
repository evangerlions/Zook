## 1. Raw sync
- [x] 1.1 Add failing API and protocol tests for raw sessions and tombstones.
- [x] 1.2 Implement raw validation/routes, resource kind and idempotent migration.
## 2. Guest ownership
- [x] 2.1 Add guest identity/receipt persistence with atomic account locks and rollback.
- [x] 2.2 Implement scoped creation/recovery, proof-based atomic transfer and replay.
- [x] 2.3 Test scope, forgery, expiry, collisions, concurrency and failure rollback.
## 3. Contracts and verification
- [x] 3.1 Update OpenAPI/generated contracts and public documentation/overview/audit.
- [x] 3.2 Run memory and PostgreSQL tests, migration replay and contract lint.
- [ ] 3.3 Resolve independent review findings, merge to main, retest and push.
