# FrogSleep 2A 私人专注幂等验证记录

日期：2026-10-11。状态：**后端 OpenSpec 任务 2.6 完成本机实现和验证，整体 6/16；Sleep 客户端 13/22。未合并、推送或部署。**

## 源码与范围

本轮 fetch 后 `origin/main` 仍为 `4599ef52ff6e017b39d01ceb8d4ea6830be78bb7`，复用从该基线建立的 `feature/sleep-phase2a-readiness` 工作区。保留其他 worktree、原 `94602cc` 数据归属分支及已有规划和测试 WIP，不切换或修改被其他工作区占用的 main。

修改仅为私人 focus 上报构建器/服务、原子写数据库协议及两种适配器、021 迁移、相应 API/真实 PG 测试、canonical/generated 合同、README_API/能力矩阵和前后端规划状态。Sleep 本批无运行时代码改动，既有 stable session_id、固定 owner 凭据、同键内容修正与队列 payload 回执保护继续适用。

## 已实现语义

- key 为认证推导的 `(app_id, owner_user_id, client_session_id)`；请求体 owner/app 字段不改变归属。
- 可选 `session_id` / `sessionId` 接受包含非空白内容的 1–128 字符不透明字符串，大小写和空白保持原值；双别名必须相等，非法输入返回 `400 REQ_INVALID_BODY`。
- 相同归一化请求的重复/并发上报返回原 server ID、created_at 和首次默认时间，只有一条有效记录。
- 同键修正原位更新内容，保留 server ID 与创建时间，周/日统计按最新有效记录计一次；语义是数据库最后接受的写入，尚无客户端 revision 排序。
- 只在首次插入执行原首次里程碑/共享检测；重试与私人内容修正不重复创建派生项。请求分析事件仍用于计上报请求次数，唯一 session 统计来源为历史/统计接口。
- 省略两个客户端 ID 继续 legacy append-only；没有替旧客户端猜测 ID、归属或自动升级。

PG 用部分唯一表达式索引加单条 `INSERT ... ON CONFLICT DO UPDATE`，没有用进程内检查再插入代替数据库并发保护。这与 [PostgreSQL 的原子 UPSERT 保证](https://www.postgresql.org/docs/16/sql-insert.html#SQL-ON-CONFLICT)一致。新 Store 只保存查询依赖，单次请求数据全部位于局部参数中。

## 迁移 021

`021_frogsleep_focus_session_idempotency.sql` 在同一迁移事务中锁定专注表，整理有明确 app/owner 和有效字符串 client ID 的旧重复，安装唯一约束：保留最早实体 ID/created_at，内容取最新 updated_at 行，其他重复 soft-delete。共享时刻 payload 的 `session_id` / `buddy_session_id` 映射至保留实体。

旧重复实体保留审计痕迹；无有效 client ID、无 owner 及已有删除记录不自动绑定或复活。没有重算既有共享时刻数量或重写邀请/通知语义。迁移失败回滚整理和索引；成功后重跑保持历史和引用不变。

迁移锁表应在 dev 候选部署阶段验证时长和升级顺序，不能把本机通过当作已部署。版本、墓碑/全量恢复、多设备冲突规则仍属于后置 2B。

## 最终验证

| 检查 | 结果 | 日志 |
|---|---|---|
| 全仓 `npm test` | **1301/1301 passed** | `/tmp/sleep-phase2a-focus-idempotency-all-unit.log` |
| FrogSleep 专项（包含在全仓内） | **207/207 passed**，本批新增 10 项 API 测试 | `/tmp/sleep-phase2a-focus-idempotency-frogsleep-tests.log` |
| 新真实 PostgreSQL 幂等/迁移门禁 | **8/8 passed**，包含 7 个子场景及父测试 | `/tmp/sleep-phase2a-focus-idempotency-postgres.log` |
| 既有 PostgreSQL slot/并发/升级回归 | **7/7 passed** | `/tmp/sleep-phase2a-focus-buddy-postgres-regression.log` |
| canonical 生成与一致性 | generate/check 通过 | `npm run generate:public-contracts`、`npm run check:api-contracts` |
| OpenAPI lint | 无错误，194 条现有全产品警告保留 | `/tmp/sleep-phase2a-focus-contract-lint.log` |
| 四个前后端 2A/2B OpenSpec | strict validation 通过 | 各 change |
| Git diff 空白检查 | 两工作区通过 | `git diff --check` |
| 仓库 source 行数 gate | 未通过：仍为 9 个已有超限文件 | `/tmp/sleep-phase2a-focus-line-count.log` |

新 PG 测试使用两个独立连接池，直接持有未提交的唯一键并观察 `pg_stat_activity` 锁等待，验证数据库并发仲裁；还覆盖并发首次写入、混合内容修正、不同用户/不同 app 的相同 ID、绕过服务的约束拒绝、缺失 ID 兼容、旧重复迁移、事务回滚、引用修复和重复迁移。周统计的 session_count/completed_count、total_minutes、daily 数量与分钟均核验不重复。

API 测试覆盖重复、24 路并发、认证 owner 伪造、相同 ID 的 A/B 独立统计、修正保留 ID/创建时间、别名/等价时间、非法 ID 和错误码、无 ID 兼容、首次默认时间、大小写/空白精确保留、共享时刻不因重放新增。

最初全仓测试的唯一失败为 admin-web 测试加载时找不到已锁定的 TypeScript 依赖。使用 `npm ci --prefix apps/admin-web --ignore-scripts` 补齐隔离工作区依赖后，该文件 8 项通过，重新执行全仓后 1301 项通过；没有修改 admin 源码、测试断言或依赖锁文件来掩盖失败。

行数 gate 的 9 个既有超限文件保持单独记录。其中 ApplicationDatabase 从 733 到 735 行、PostgresDatabase 从 692 到 694 行，仅新增本任务所需 import/协议/委托；新构建器与 Store 分别 75、32 行，没有把业务逻辑塞入聚合数据库文件。其他 7 个超限文件未修改，本批没有扩大为全仓重构。

PG 临时数据库 `sleep_phase2a_focus_20261011` 由本轮创建，三组测试结束后已删除，并查询确认剩余数量为 0；没有使用预存业务库作为测试目标。

## 复现命令

```sh
npm test
node --experimental-transform-types --test test/unit/frogsleep-*.test.ts
npm run generate:public-contracts
npm run check:api-contracts
npm ci --prefix api-contracts --ignore-scripts
npm run lint:api-contracts
```

指定自行创建的可删除 PostgreSQL 数据库后执行：

```sh
FROGSLEEP_TEST_DATABASE_URL='postgresql://USER@localhost/DISPOSABLE_DATABASE' \
node --experimental-transform-types --test --test-concurrency=1 --test-force-exit \
  test/integration/frogsleep-focus-session-idempotency.postgres.test.ts
```

既有回归文件为 `test/integration/frogsleep-buddy-postgres-concurrency.test.ts` 和 `test/integration/frogsleep-buddy-postgres-migration-upgrade.test.ts`，同样顺序运行；结束后自行删除该临时数据库。

## OpenSpec 与后续边界

后端仅将 2.6 标完成；2.1–2.5 的其余关系/通知审计和全部当前 dev/发布门槛保持未完成。前端同步 tasks/design/specs 的后端依赖与合同状态，仍为 13/22；没有提前标记 4.4/5.3 双账号 dev 端到端验收。

两端 2B 仍未 apply。下一步应在已验证 main 候选上完成 dev 迁移与双/第三/可删除账号证据，并继续 1v1 邀请/方向授权/通知收口；本轮不自动合并或发布。
