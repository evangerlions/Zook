# LightTick App 闭环整合

本轮目标是把 App 操作与后端 AI、任务持久化、复盘与确认调整连接起来；本地 coaching skill 仅为方法探索素材，不是运行时依赖。

## 用户链路与实现边界

1. App 输入目标，选择直接规划；后端保存 draft goal，未知预算由 PlanningSession 澄清。注册/升级约束沿用原合同。
2. AI 返回可审阅计划：摘要、假设、排期、任务目的/材料/步骤/完成标准。生成不写执行任务。
3. 用户确认当前版本，服务端事务创建任务与步骤。App 返回 Today 并刷新；确认未来周期不隐藏今日任务。
4. 用户完成或跳过，记录执行事实。私人备注不隐式用于AI；复盘页可显式提供自述。
5. 按本地日、周或月读取当前目标事实。AI 区分执行与成果；数据不足不编造能力提升。
6. 复盘后选择调整：原任务 diff 通过 proposal 确认，或把复盘建议作为新周期草案审阅后确认。两者均不从聊天直接落地。
7. App 展示刷新后的实际状态。用户可自行结束阶段，但本轮没有新增自动成果评分器。

## 责任与范围

- Zook：合同、AI规则/校验、事务、数据、事实选择；无 request-scoped service 字段。
- 原生双端：首次规划、草案/Today指导、复盘周期与自述、明确确认及返回刷新。
- 复用 conversational-planning / improve-core-interaction-flow；日复盘枚举与手动入口是 review-cadence 的部分能力，不替代目标级节奏偏好或自动推送验收；成果评估仍归 evaluate-goal-outcomes。
- 完整阶段/月周层级编辑、跨目标共享预算、领域质量与长期效果不因本轮闭环而自动宣告通过。

## 验证

- `test/unit/lighttick-app-loop.api.test.ts` 经真实路由/队列/服务跑输入目标至调整后Today，LLM使用确定性测试替身；不伪称真实模型质量。
- `test/unit/lighttick-app-loop.test.ts` 验证步骤保留、确认边界、目标/时区隔离、未知时长、未来计划和目标收尾。
- `test/integration/lighttick-app-loop-postgres.test.ts` 验证真实本地PostgreSQL事务并发确认、重建仓储读取、迁移重跑、步骤和日复盘持久化。
- 合同生成/一致性/lint与双端单测/构建须在交付记录中引用实际结果。真实设备点击、真实provider质量和推送仍单独报告。

## 基线与交付

后端从2026-09-19 fetch的origin/main f31aa72建立feature/lighttick-app-loop，再整合对话规划候选7e63ecd。客户端从各自main隔离工作树后整合候选iOS d4b375f、Android 2dd65b3；客户端无origin远程，不能宣称已同步远端或已推送。原主目录未提交改动保持不动。

数据库迁移 064 保存任务执行说明；065 单独保存 YYYY-MM-DD 业务日期字符串，避免 TIMESTAMPTZ 和驱动时区转换丢失日期语义。已有时间戳安排保持原有语义。

## 本轮验证记录（2026-09-19）

后端全量单元测试 1136/1136 通过；真实本地 PostgreSQL 全部专项合计 23 项通过。新增闭环覆盖洛杉矶业务日期、重建仓储读取以及未指定时刻任务在计划末日可见。合同生成一致性通过；lint 无错误，保留 195 项既有警告。

真实 Provider 预检显示本机 dev 不可达且没有管理凭据，不能据此验证真实模型质量；HTTP 闭环使用确定性 LLM 替身。上线仍需配置环境后运行真实 Provider 案例与设备点击验收。
