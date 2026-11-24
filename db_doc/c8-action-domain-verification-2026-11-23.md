# C8 行动域迁移动线记录（2026-11-23）

## 背景
S0 前置 change `complete-s0-prerequisites` §5（C8 行动域三步迁移）。裁决已落文
（`s0-authority-decisions-2026-11-23.md`）：
- A（SQL `zook_lighttick_tasks`）为规划与执行事实唯一权威；
- B（`zook_lighttick_action_workspaces`）不是遗留系统，是「知行成长」↔Zook 现行生产集成面，
  降级为内容接入层（保留 `content_events` / `content_sources` / `action_links` / `tickets`）。

## 5.1 只读桥（S0 范围内，已验证）

**目标**：让 A 侧能读取 B 产生的 `content_events`，只读、不写，避免双写。

**现状核实**：
- `LightTickRepository extends NativeLearningRepository, ActionRepository, ...`
  （`src/modules/lighttick/lighttick.repository.ts:28`），因此 A 侧代码已经可以经
  `repository.getActionWorkspace(owner)` 读到 B 的 `payload.content_events`。
- `PostgresActionStore.getActionWorkspace` 只执行
  `SELECT payload,version FROM zook_lighttick_action_workspaces WHERE app_id=$1 AND user_id=$2`
  （`src/infrastructure/database/postgres/postgres-lighttick-action-store.ts`），是纯读查询。

**本地 PostgreSQL 验证**：
1. 在 `zook_local_integration` 插入一条带 1 个 `content_events` 的 action workspace
   （`event_id=native-test1`，`normalized_target={kind:"plan",plan_id:"route_1",lesson_no:1}`）。
2. 用与 `getActionWorkspace` 相同的 SQL 读取：
   - 读到 `content_events` 数量 = 1
   - `event_id = native-test1`
   - `normalized_target = {"kind":"plan","plan_id":"route_1","lesson_no":1}`
   - 读取前后 `version` 均为 1（无写入，无双写）

**结论**：5.1「A 侧能读到 B 产生的内容事件，且不产生双写」验证 **通过**。
S0 不新增 helper 接口：该能力已由 `ActionRepository` 继承提供，避免为尚未到位的 5.2 预埋死代码。

## 5.2 改投影（跨 S1，依赖 M8）

**目标**：`onLessonCompleted` 产生内容事件后，由 A 按 `learning_target` 找当天 task 显式完成
（`src/modules/lighttick/learning/learning-action-projection.ts` 当前是在 B 的 `plans[]` 里
`reconcileContent`）。

**关键依赖**：A 的 task 当前**没有** `learning_target` 字段
（`zook_lighttick_tasks` 见 `029_lighttick_core.sql`，`LightTickTaskRow` 见
`lighttick.types.ts:72`）。统一方向文档 §235 已明确：A1 的第一件事是"定义课程课次与 task 的
关联合同"，把 `normalized_target={kind:"plan",plan_id:routeId,lesson_no}` 提升为 task 上的
`learning_target`，这是 M8 的产物。

**范围结论**：统一方向文档 §622 明确——"如果 C8/D6 的裁决需要动 A 的 task 模型，那么 M1 的
仓储读写要与 M8 并行……在 S1 内按'同域任务合并提交'处理，不拆成两个阶段"。因此 5.2 的实现
（task 加 `learning_target` + 投影改写）属于 **S1**，不在 S0 强推。

## 5.3 停 B `plans[]`（跨 S1 之后）

**目标**：B 不再承载计划，只保留内容接入与对账。依赖 5.2 完成、A 完全接管"学习完成→计划完成"
链路后才能停用；否则会断「知行成长」现行生产集成面（统一方向文档 §475）。

## 结论
- S0 的 C8 交付：5.1 只读桥（能力已存在 + 本地 DB 验证通过），以及 5.2/5.3 的依赖与阶段归属明确。
- 5.2/5.3 转入 S1（与 M8 `learning_target` 同域实施），避免在 S0 提前动 A 的 task 模型造成返工。
