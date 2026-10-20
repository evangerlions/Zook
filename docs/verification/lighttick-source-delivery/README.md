# LightTick P0 C2 来源投递验证

日期：2026-10-21。基线 `71bb271`（C0/C1），沿用 `feature/lighttick-p0-v2-contract-runtime`；Grow 基线 `fc19fa0`、本轮提交 `110d36d`，工作树 `/Users/hao/.codex/worktrees/action-plans-p0/grow`。未合并、推送、部署或配对真实账号。

## 交付与信任边界

- 唯一 OpenAPI 与 generated contracts 增加 source-context/confirmation/receipt/reconcile 和三个稳定错误码。
- 只有既有 active 绑定、已通过原 HMAC 签名验证的 Grow 账号和 active LightTick 会员可以发送。source_proof 由来源成功事务生成；owner 从绑定映射，不接受 browser owner/read 位/笔记作为完成证明。
- Zook 签发七日确认窗口的 origin context，保存原计划日期/时区；延迟投递仍按原发生时间。无 origin 只匹配当日同源事项；未来/未安排、暂停/祖先阻断、running 保持待核对。
- owner 锁与事务覆盖 inbox、登记、消费、事实、revision、操作回执；同 ID 同 hash 重放，异 payload 409 SOURCE_EVENT_CONFLICT。回执读取纯读，核对可更新已有回执。
- Grow publication journal 原子持久来源结果、事件、outbox；租约/退避、后台扫描和手动核对不使用本地行动写入。源事件不含正文、标题、私人评论/笔记或 AI 设置。
- `rejectConnectionWrite` 及公共 capabilities 原样关闭。私有来源通道不允许创建/编辑/改期/计时结束、新配对或 v2 导入。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| Zook 全量单元回归 | 1500 pass、0 fail、0 skip | full-regression.log |
| C2 合同/运行时/写屏障 | 4 pass、0 fail、0 skip | Grow C2 runner 中 zook-source-contract-runtime.log |
| 原 owner 事务/并发/重启/租户 PostgreSQL 回归 | 1 复合测试 pass | postgres-regression.log |
| Grow→Zook 真实 HTTP + 双 PostgreSQL | 文章/课程各 3 复合用例 pass | Grow C2 runner 中 grow-source-recovery.log |
| generate/check 公共合同 | pass | 同提交 generated 文件；可复现命令见下 |
| 独立 OpenAPI lint | 0 error、212 warning | contract-lint.log |
| source 行数门禁 | **未通过：8 个既有文件**，全部与主干基线逐字节一致 | line-count.log、line-count-baseline.json |

真实 HTTP 验收包含接收提交后断开响应、Zook 真实进程重启、全新 Grow 进程执行实际 worker sweep、次日重试仍一条完成、来源数据库失败回滚、Zook receipt 保存失败整体回滚、running 后保存 12 分钟再核对、缓存上下文离线确认、同 ID 异 payload、外账号/错绑定/伪造上下文/停用会员。GitHub 来源仓库使用 HTTP 合成 transport，不是对真实 GitHub/生产环境的验证。

Grow 原 P0、浏览器和客户端回归的最终结果见 Grow `openspec/changes/action-plans-p0-clarity/source-delivery-verification.md`。本轮修复了首次创建行动表时嵌套连接等待自己的 DDL 锁，并修复了浏览器验收未等待文章确认 POST 的竞态：测试不能凭按钮已有文本认定回执已提交。

## 复现

```sh
npm run generate:public-contracts
npm run check:api-contracts
npm run lint:api-contracts
node --experimental-transform-types --test test/unit/lighttick-action-source*.test.ts test/unit/lighttick-action-p0-gates.api.test.ts
LIGHTTICK_ACTION_TEST_DATABASE_URL='postgresql://hao@127.0.0.1/postgres' node --experimental-transform-types --test test/integration/lighttick-actions-postgres.test.ts
npm test
npm run check:line-count
```

跨端故障恢复从上述 Grow 工作树运行 `知行成长/server/tests/run_action_source_acceptance.py`，显式设置 TEST_ZOOK_WORKTREE、TEST_LEGACY_PG_DSN 和 PYTHONPATH，具体命令见 Grow source-delivery-design.md。隔离 fixture 只监听 localhost，并有随机测试令牌；不可将它作为产品服务启动。

## 剩余阻塞与未验证

1. C3 全图快照接管、事件/消费关系/回执归属迁移、接管前后 key 路由及恢复尚未实施。真实账号不能用 fixture 的内部播种控制绕过它。
2. iOS/Android 共享行动 DTO/API/队列/界面及双端验收未实施，未修改原生仓库。
3. 公共消费者能力仍关闭；未验证真实 GitHub 网络故障、真实账号全链路、设备通知/日历、生产迁移、部署或发布。没有独立根 TypeScript typecheck 脚本，本报告的运行证据来自 Node transform-types 的执行测试。
4. 行数门禁既有失败仍阻止声称全部仓库检查通过；本轮未扩展去重构无关 BodyLog/admin/工厂文件。OpenAPI lint 的 212 警告也保留在原始日志中。
5. 无有效缓存的离线 origin 确认会保留来源并 blocked/ORIGIN_CONTEXT_REQUIRED，必须恢复连接后重新明确确认；不能事后制造发生时的上下文。收件容量沿用 P0 上限 10000，事件不被静默裁剪。

因此本轮可交付的是 C2 的实现与隔离验收；不能将此报告视为连接写入/原生/生产发布放行。
