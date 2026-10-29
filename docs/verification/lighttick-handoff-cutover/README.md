# C3 私有切换协调收尾验收

已验证实现固定提交：Grow `f4ec0b97518699da4c41af36adfdec57daecf5f0`；Zook `e0d9807abec161f7294c2ac723311703a729b286`（唯一合同也固定至此 Zook SHA）。后续文档提交仅记录这些标识，不改变已验证运行时代码。
2026-10-22；延续C3基础设施，不开放生产预检/接管/普通写入，不改原生端，不扩展P1/P2。基线 Zook `3af3048`、Grow `ec8ca3a`。

内部导入新增与 C2 相同的持久来源操作回执，与全图和接管回执同事务；拒绝来源回执编号冲突。未消费事件接管后延续 source-reconcile；真实分钟与完成事实保持各自口径。目标版本变化返回 REVISION_CONFLICT / HANDOFF_TARGET_VERSION_CHANGED。唯一合同 LightTickActionHandoffReceipt 严格区分 validated/imported_at 阶段；生成资产同步，source请求不能混入 target_version。

Grow 私有协调已补齐：来源共享锁/切换排他锁先于行动锁、摘要再核对、未完成来源日志阻断、不可变备份与冻结同事务、丢响应幂等恢复、回执校验后原子激活/C2 outbox。pending 来源在发布前暂停，目标版本重预检只更新同一备份的版本。测试fixture的 /fixture/handoff 要求localhost随机schema、测试token和Grow HMAC；生产没有这个入口，import-preflight仍422，公开import/claim/普通写入仍拒绝。

| 检查 | 最终结果 | 日志 |
| --- | --- | --- |
| npm test | 1508 pass / 0 fail / 0 skip | unit-full.log |
| C3/P0合同/门禁/生成 | 15 pass / 0 fail / 0 skip | contracts.log |
| 来源合同/运行时/门禁 | 4 pass | source-contract-runtime.log |
| 既有PG集成：BodyLog/成长/LightTick actions | 3 pass / 0 fail / 0 skip | postgres.log |
| 合同生成/check/lint | 通过；0 error、197条既有warning | contract-*.log |
| 行动领域strict | 通过；13源文件及传递依赖 | actions-types.log |
| 行数门禁 | 670文件通过；未改阈值/豁免 | line-count.log |
| admin typecheck/build | 通过 | admin-*.log |
| Grow C3真实HTTP切换故障恢复 | 18通过，文章/课程各9；Node和Python实际进程重启 | Grow acceptance/grow-cutover-recovery.log |
| Grow快照/路由 | 4通过 | Grow acceptance/grow-snapshot-and-routing.log |
| Grow本地完整回归与C2 | 140通过含8真实Chrome；C2另12通过；两组客户端通过 | Grow evidence/handoff-cutover |

机器汇总见 [results.json](results.json)。各行有重叠，不加总为独立用例数。Grow完整报告为其 `openspec/changes/action-plans-p0-clarity/handoff-cutover-verification.md`，保留并发/回滚/损坏回执/备份/目标版本/来源崩溃日志和截图，以及先失败后修复的混合阶段回执用例。

此前低空间环境的全量尝试中断且无有效成功汇总，7项单独诊断及最终完整1508均通过；不把前次中断算通过，也不声称全部失败根因已证明是磁盘。旧基础设施报告仍留历史状态，不再将C3协调/屏障列为未实施。

## 仍不能放行

- 原生C4/C5、真实双端、真实账号/设备通知/日历和生产迁移/部署未验；OpenSpec7.3仍未完成。
- 无生产预检/stage入口，connection_write_enabled=false；测试fixture不代表公开HTTP接管可用。
- 未完成来源日志、目标来源库存/请求key/图冲突需先恢复或核对，不能自动覆盖。
- 197条历史合同warning保留；只验证行动领域strict和后台类型检查，全后端统一strict未跑通。未重算旧709诊断。

## 复现

本仓运行表中npm检查；PG只运行上述三组测试，显式配置 `BODYLOG_TEST_DATABASE_URL=postgresql://hao@127.0.0.1/postgres` 与 `LIGHTTICK_ACTION_TEST_DATABASE_URL=postgresql://hao@127.0.0.1/postgres`，测试自己使用随机schema。跨仓切换使用Grow `run_action_handoff_acceptance.py`，显式 `TEST_ZOOK_WORKTREE`、localhost `TEST_LEGACY_PG_DSN`、`LIGHTTICK_ACTION_TEST_DATABASE_URL` 和Python路径；完整命令见Grow报告。不得将测试schema/driver复制成生产入口。
