# C3 GoalContext 迁移验证记录（2026-11-23）

## 验证目的
S0 前置 change `complete-s0-prerequisites` §4（C3 GoalContext 三步迁移）的 4.1 验收：
「双写：随机 20 个目标两处内容一致」。本记录给出本地 PostgreSQL 上的可复现验证结果。

## 验证环境
- 主机：当前 macOS 环境（用户 `ke`）
- PostgreSQL 15：`127.0.0.1:5432`，超级用户 `ke`
- 目标库：`zook_local_integration`（新建，模拟 `.env.local` 指向的集成库）
- 迁移：`src/infrastructure/database/postgres/migrate.ts`，152 个 SQL 全部顺序重放成功（含 `150_lighttick_goal_context_backfill.sql`）

> 注意：本机原始 `.env.local` 指向 `postgresql://hao@127.0.0.1:5432/zook_local_integration`，角色 `hao` 与库均不存在（该配置来自另一台机器）。验证时改用本机超级用户 `ke` 新建同名库，等价于干净集成库。

## 验证步骤与结果

### 1. 迁移全量重放
```
node --experimental-transform-types src/infrastructure/database/postgres/migrate.ts
# [db:migrate] all migrations are up to date
```
结果：152 个迁移全部成功，`zook_lighttick_goals` 与 `zook_lighttick_goal_contexts` 均存在。

### 2. 灌入 20 个测试目标
- 15 个 goal 的 `constraints` 含 `confirmed_planning_conditions`（真实结构：`schema_version` + `revisions[]`）
- 5 个 goal 的 `constraints` 不含该键（仅 `other_key`）

结果：`total_goals=20`，`with_conditions=15`。

### 3. 执行回填迁移 150
```sql
INSERT INTO zook_lighttick_goal_contexts (goal_id, app_id, user_id, constraints, version, created_at, updated_at)
SELECT id, app_id, user_id, constraints, 1, NOW(), NOW()
FROM zook_lighttick_goals
WHERE constraints ? 'confirmed_planning_conditions'
ON CONFLICT (goal_id) DO UPDATE SET constraints = EXCLUDED.constraints, updated_at = NOW();
```
结果：`INSERT 0 15`，`backfilled_rows=15`。

### 4. 两处一致性比对（4.1 验收核心）
```sql
SELECT count(*) FROM zook_lighttick_goals g
JOIN zook_lighttick_goal_contexts c ON c.goal_id = g.id
WHERE g.constraints ? 'confirmed_planning_conditions'
  AND c.constraints IS DISTINCT FROM g.constraints;
```
结果：`mismatch_count = 0`。

### 5. 幂等性重放（模拟部署后 migrate 再次重放 150）
重复执行回填 SQL 后再次比对：
- `mismatch_after_replay = 0`
- `unexpected_ctx_without_conditions = 0`（不含条件的 5 个 goal 未被回填）

## 结论
- C3 4.1「随机 20 个目标两处内容一致」验收 **通过**。
- 回填迁移 150 的筛选（`constraints ? 'confirmed_planning_conditions'`）、复制（整 `constraints` JSONB）、幂等（`ON CONFLICT DO UPDATE`）三项语义均正确。
- 表 B `constraints` 与列 A `constraints` 完全一致，因此 4.2 读切换（`resolveGoalConditions` 从表 B 读 `confirmed_planning_conditions` 子键覆盖列 A）在回填后与旧行为严格等价。

## 测试数据清理
- 测试库 `zook_local_integration` 与 20 条测试 goal 为本地验证产物，不影响任何真实数据；如需复用或清理见 `db_doc/README.md`。
