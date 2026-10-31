# Yaohezi M2 local security and acceptance record — 2026-10-31

This is an internal adversarial design/code review with real local tests, not an external cryptographic audit or production approval. Scope is self-account trusted devices, per-resource/version encrypted capabilities, recovery and revocable health sessions. Family invitations and clinical ingestion remain M3/M4 work.

## Review reconciliation

| Finding | Resolution and evidence |
| --- | --- |
| Transactions alone did not define revoke/write ordering | Shared account then subject advisory locks, authority row lock and membership share locks; own M2 transactions bypass old global lock; concurrent bootstrap/enrollment/recovery and revoke/operation audit order tested |
| Vault nonce, framing and AAD unspecified | Fresh 12-byte nonce, 16-byte tag, explicit HKDF labels, account/subject/recovery-version AAD; wrong secret/context/version and RFC vector tests |
| Valid signatures could be mistaken for write authorization | Relay checks current grant/action/resource; receiver checks current authenticated snapshot plus independent roots and owner-signed provenance; reader write denied on both sides |
| Reader descriptor could issue an owner certificate | Recursive historical issuer authority validation, immutable exact roles/resources; a forged owner row/certificate injected in the synthetic relay is rejected |
| Old certificate epoch prevented surviving devices after rotation | Separate immutable enrollment provenance and current grant epoch; actual issuer revocation followed by surviving owner's new-epoch authorization passes |
| Bootstrap/recovered owners had no reference receive path | Explicit pinned bootstrap and recovery roots, candidate plus recovery signatures; both authors verified in integration |
| Recovery-only device still needed lost bootstrap pins | Only active grants and necessary ancestry validated; test discards ALL old pins before recovery verification |
| Reader could not verify another active owner | Return permitted writer public certificates and required ancestry; verify using reader's own authenticated snapshot |
| Snapshot clock tick could reject a fresh response | issuedAt captured once; validUntil derived from it; wire schema and real snapshot loads pass |
| Historical root transcripts would redeliver old vault ciphertext | Root rows expose only an independently pinned, verified transcript digest and public descriptor; no historical recovery vault is retained in public trust lineage; actual reader snapshot asserts vault ciphertext absent |
| Health bearer header not masked by optional local file sink | Added specific redaction; actual red test reproduced plaintext, green test masks it; normal request logger logs no headers/body |

Behavioral red evidence retained locally: /tmp/yaohezi-m2-boundary-red.log, /tmp/yaohezi-m2-recovery-roots-red.log and /tmp/yaohezi-m2-log-red.log. Early migration/test-fixture failures are retained as failures, not acceptance results.

## Final local checks

- Full backend unit regression: 1710 tests, 1709 passed, zero failures, one existing PostgreSQL invitation-order test explicitly skipped because its separate environment was absent. /tmp/yaohezi-m2-final-unit.log. This skip is not a claimed M2 pass.
- Final focused security, product scope and log regression: 15 passed, zero skipped. /tmp/yaohezi-m2-final-focused.log.
- Real PostgreSQL/Redis/loopback HTTP: 18 tests/subtests passed, zero skipped. /tmp/yaohezi-m2-final-acceptance.log and .artifacts/yaohezi/yaohezi_local_1793438765965_f332ca0c/{result.json,postgres.log,redis.log}.
- Strict protocol/client-reference/PG TypeScript check: npm run typecheck:yaohezi-security.
- Canonical OpenAPI lint and generated-contract check: npm run lint:api-contracts; npm run check:api-contracts. Contracts remain isolated from runtime; generated schemas are committed.
- Source line gate: npm run check:line-count. Stateless Yaohezi repositories retain only a pool; the database facade does not keep redundant repository instances.
- Published Ed25519 and HPKE test vectors and application-level tamper/scope/AAD/rotation tests pass. Published vector private values are public test data, not deployment credentials.

Final targeted checks run after replacing the legacy global request transaction for M2; concurrent operations now exercise the subject locks directly. All acceptance data is synthetic. SMS is a capture transport with normal random-code verification, queue is an in-memory fixture. No production DB/Redis/configuration or external SMS/provider was used. Test HTTP and private Redis stop automatically, scratch databases remain for inspection.

## Uncompleted release gates

- Native iOS trusted-device UI, Keychain/private-key custody, sign-out orchestration and two real devices/OS interoperability. The Node client reference does not substitute for these.
- External cryptographic audit, malicious-relay history transparency/rollback handling, durable clinical revision ingestion/CAS, grant-aware sharing/lease/offline enforcement and account-deletion orchestration.
- Existing dependency audit has two HIGH findings (fast-uri and nodemailer), already present before the HPKE addition. These are NOT reported as a clean audit. M2 accepts only fixed generated schemas and bounded UUID/base64 metadata; it does not accept user-supplied URI schemas or use the email transport. Remediate/retest these shared dependencies before production health enablement; do not apply npm audit fix --force across other products as part of this local change. Full audit evidence: /tmp/yaohezi-m2-npm-audit-final.json.
- Product/health gates remain off by default; no merge to main, push or deployment has occurred. Base origin/main@0b28ef7 was fetched and merged into the existing isolated feature worktree. Another user's main worktree/unpublished commits and original FrogSleep worktree were not modified.
