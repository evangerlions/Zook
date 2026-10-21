# C3 内部快照与回执衔接验收

> 历史基础设施阶段报告；后续协调/来源屏障与 HTTP/双方进程恢复的最新验收见 [切换收尾报告](../lighttick-handoff-cutover/README.md)。下文未实施项保留当时状态。

2026-10-21，基线 `3db81b9`，实现提交 `e2ae870`；继续原 feature 工作树，不修改主干、原生客户端或生产配置。

## 已实现和验证

- 唯一 OpenAPI 的八类 snapshot v2（4 MiB、规范 JSON SHA-256），内部 ActionHandoffService 只读全图预检和原子导入，target_version 再确认。
- 混合 v1/v2 原始历史、nullable/运行会话、完成/撤销、历史复盘与总结、来源确认与消费、旧请求回执和提醒 claim 保留。事件 owner 从受信任来源映射当前绑定用户，handoff_source 记录原账号/key/hash。
- 多个 running、错误引用/身份/摘要、断裂有效完成指针、重复撤销/消费、容量和对象/key 冲突拒绝；目标已有其他来源事件或生成中总结也拒绝。
- 工作区与接管回执同事务，故障注入回执写入失败时整体回滚；真实 PostgreSQL 并发同包仅导入一次，新服务/仓储实例重放原回执；不同包拒绝覆盖。
- Grow 老 key 本地查询，新 key 在 active 下去 Zook；pending 未知结果及不合法远端结果返回 503，不能清除未知提交。字符串 __proto__/constructor 不再混入原型或误命中回执。
- 修复拒绝函数的 TypeScript 控制流识别和 ConfigRevisionMeta 的实际类型来源；新增 `npm run check:lighttick-actions-types`，12 个行动领域文件及其传递依赖严格检查通过。使用现有后台锁定 TypeScript 开发依赖，不新增生产运行时依赖。

## 最终检查

| 检查 | 结果/日志 |
| --- | --- |
| 全量 Node 回归 | **1506 pass / 0 fail / 0 skip**，full-regression.log |
| C3/公开门禁/合同/生成专项 | 13 pass / 0 fail，contracts.log（C3 为6个复合用例） |
| 行动领域全部相关单测专项 | 34 pass，actions.log |
| PostgreSQL 原集成：BodyLog、成长、actions | 3 复合测试通过、0跳过，postgres.log |
| 真实 Grow 导出→Zook PG、新回执路由与原 P0 重点用例 | 19项通过（其中新增C3四项），grow-c3-and-p0.log |
| Grow→Zook C2 故障恢复 | 12 pass，grow-source.log |
| 行动领域严格类型检查 | 通过，domain-types.log |
| 后台类型检查/构建 | 通过，admin-types.log / admin-build.log |
| 公共合同生成/check | 通过，contract-generate.log / contract-check.log |
| 全合同 lint | **0 error / 197 warning**，contract-lint.log；无新增警告 |
| 行数门禁 | **669文件通过**，line-count.log；阈值/豁免未改 |

Grow 完整140项回归（包括8项真实Chrome）、两组Node客户端及首次初始化竞态的修复前/后证据存放在 Grow 的 `openspec/changes/action-plans-p0-clarity/evidence/handoff-v2`。其中保存恢复用例明确等待实际POST 200再判断对话框关闭；不延长超时、不跳过失败用例。

## 未完成或未验证

- **完整 C3 切换协调和跨切换来源确认屏障未实施**。本轮仅保证 Grow 导出事务内的一致性及内部目标导入的原子性。导出之后源仍可能变化，不能直接拿导出包执行真实接管；尚须完成摘要再核对、冻结/封存、pending 来源确认暂停或可靠排队、回执确认/恢复的完整链路。
- **公开入口继续关闭**：grow-bridge 的 import/claim/普通行动写入仍拒绝 `CONTRACT_UPGRADE_REQUIRED / CONNECTION_WRITES_DISABLED`。未注册预检 HTTP 路由，也未增加绕过门禁开关；v2_import_enabled、connection_write_enabled 等公开能力不变。
- C4/C5 原生消费、真实账号/设备通知/日历副本、正式切换的跨进程恢复和生产迁移未验收；未改原生端、未扩展 P1/P2、未推送/合并/部署。
- 全合同197条历史警告保留；新的专项领域类型门禁通过不代表全后端类型检查通过。上一轮709诊断未在本轮全量重测，不能按专项修复数机械换算全仓剩余值。

本轮跨仓 C3 测试通过内部服务调用，不是正式 HTTP 接管端到端。PG 新建仓储/服务实例模拟重建；真正进程重启覆盖属于 C2 来源投递测试，二者分开陈述。

## 重跑

```sh
npm run check:lighttick-actions-types
node --experimental-transform-types --test test/unit/lighttick-action-handoff-v2.test.ts
npm run check:api-contracts
npm test
```

领域类型检查依赖现有后台锁定开发依赖；按项目约定安装后执行。跨仓 C3 用 Grow 的 `test_action_handoff`，显式配置 `TEST_ZOOK_WORKTREE`、localhost `TEST_LEGACY_PG_DSN` 与 `LIGHTTICK_ACTION_TEST_DATABASE_URL`；fixture 只创建和清理随机测试 schema。
