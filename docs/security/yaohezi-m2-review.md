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


## 2026-11-01 main 基线集成复核

将 Yaohezi 已提交的前置模块集成到 origin/main@9cdf0fa；冲突保留 main 的 billing environment、结算服务及 LightTick 行为，并追加独立 Yaohezi 开关。共享鉴权只收紧当前自有双段 opaque bearer 的格式与 claims 校验；logout 的 refreshToken 合同与既有 app/web 服务行为对齐，不改变退出运行时。新数据库端口默认缺失时拒绝健康信任；provider 仅持有稳定 pool 依赖。另补 main 已使用但遗漏声明的 BILLING_ENVIRONMENT_FORBIDDEN 错误码，严格类型检查通过。

迁移以完整文件名记录和排序，081/082 与已有同数字前缀的其他产品迁移不冲突；均只创建 Yaohezi 专有表、约束和索引，不改写其他产品数据。应用重开会幂等重放。YAOHEZI_ENABLED、YAOHEZI_HEALTH_DEVICES_ENABLED 默认均为 false；仅开启前者注册账号产品，健康设备仍返回关闭。关闭开关不删除已持久化的健康会话/绑定。账号删除编排及原生正式验收仍是启用健康能力前的门禁。

当前共享依赖审计仍有 5 项（fast-uri/nodemailer/undici/urllib 为 high，qs 为 moderate），不是本次新增的 HPKE/类型检查 dev 依赖引入，未自动跨产品升级。该结论不表示生产健康能力已获放行。
## 2026-10-31 原生退出补充复核

创建号关闭方案补上“服务已创建、响应未到本机”的撤销缺口。PG 集成覆盖先关后建、先建后关、跨账号拒绝、已撤设备仅负向清理。原生新操作在网络前 Keychain CAS 驻留；退出先使账号与健康操作 generation 失效，排空在途请求、签名关闭全部本账号创建号，再撤公共 refresh；未知失败保留清理条目。独立只读复核发现并修正断开竞争、过期批准阻塞及批准返回后租约检查，不代表外部密码学审计或真机验证。


### 2026-11-01 未提交补丁独立复核

在保留原工作树的独立验证副本中补测同账号另一设备、另一账号、过期签名、重复创建 UUID、创建与关闭并发、已撤设备清理、精确重试及应用重连。创建和关闭共享账号→主体事务锁；关闭仅匹配当前账号不可变设备对应的创建号，撤销后仍不能重新申请健康会话。合同补充严格的关闭响应 schema。旧会话不回填不存在的创建号；仍由原单会话 logout 或 15 分钟有效期终止。此验证不改变默认关闭的产品/健康开关，也不替代上线前的原生与外部安全验收。
