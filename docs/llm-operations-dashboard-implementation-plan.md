# LLM 运营看板实现蓝图

本文件是内部实现与评审蓝图；用户可见的最终效果以
`docs/llm-operations-dashboard-design.md` 为准。

## 1. 已确定的产品与兼容决策

1. 客户端提前取消记录为 `cancelled`，对 Provider 健康分为中性，不计成功也不计失败。
2. Admin 冒烟测试默认不进入生产调用统计，也不影响生产健康分。
3. 新观察数据上线后从零开始积累，并通过 `dataAvailableSince` 明确提示；不把旧 Redis 聚合伪装成可精确迁移的原始观测。
4. centralize 路由时保留当前 `fixed` 无启用 route 时首条 route 的兼容回退，但在 API/UI 中以 `compatibility_fallback` 明确暴露；本任务不静默改变生产路由行为。
5. Token/延迟运营排行使用实际 `providerModel`；动态路由评分按配置中的 `routingModelKey` 分组。二者分开存储和展示。
6. Chat 与 Embedding 只共享总体调用/Token 卡片；所有延迟对比按 `operation` 分 cohort。
7. 可靠性成功率为 `success / (success + failure + timeout)`；客户端取消单独展示且不进入可靠性或健康成功率分母。

## 2. Canonical 路由计算

新增纯函数模块 `src/services/llm-routing-score.ts`，输入配置 route、Provider 启用状态、运行时 adapter 可用状态和健康快照，输出：

```text
strategy
eligible
ineligibleReason
configuredWeight
healthScore
dynamicScore
effectiveProbability
selectionReason
```

规则保持与当前运行时一致：

- `selectionEligible = route.enabled && configuredProvider.enabled`。
- `runtimeAvailable` 是独立诊断字段，不改变当前打分资格；被选中后缺少 adapter 仍按当前行为返回 route unavailable。
- `auto` 使用 `weight × healthScore / 100`，全零时回退到基础权重。
- `fixed` 选择最高权重可用 route，概率为 100/0；没有启用 route 时保留首条兼容回退。
- `fixed` 兼容回退时首条 route 的概率为 100%，`selectionReason=compatibility_fallback`，即使它的 `selectionEligible=false`。
- 权重相同按配置顺序稳定选择。
- 加权随机选择使用严格区间边界，零分 route 不因随机数为 0 被误选。
- 最近成功率先按当前生产行为四舍五入到两位小数并作为 `healthScore`；路由使用这个已四舍五入的 `healthScore` 计算动态分。`dynamicScore` 和 `effectiveProbability` 内部不继续四舍五入，完成选择后 API 展示值才统一四舍五入到两位小数。

健康真值表：

| 条件 | health total / 最近窗口 | 健康分 |
| --- | --- | --- |
| `healthImpact=success` | 追加成功样本并累计 | 健康样本少于 10 时为 100，否则最近 100 个健康样本成功率先四舍五入两位，再作为实际路由 healthScore |
| `healthImpact=failure` | 追加失败样本并累计 | 同上 |
| `healthImpact=neutral` | 不追加、不累计、不推进 warm-up | 保持原值 |

最近窗口只包含最多 100 个 success/failure 健康样本。

`auto` 全零回退只在 eligible route 的配置权重和大于 0 时成立；如果动态分和 eligible 配置权重均无法形成正权重，终止并返回 `LLM_ROUTE_NOT_AVAILABLE`，不生成虚假概率。

`LlmRequestResolver`、`EmbeddingManager` 和 Admin runtime snapshot 全部调用该模块；删除三处重复的概率/选择实现。前端只展示后端结果，不复算。

## 3. Canonical 调用观察

新增 request-scoped `LlmCallObservationSession`，每次真实 Provider 调用创建一次并只允许 finalize 一次。字段：

```text
callId
occurredAt
routingModelKey
provider
providerModel
operation = chat | embedding
responseMode = stream | non_stream
outcome = success | failure | timeout | cancelled
healthImpact = success | failure | neutral
firstResponseLatencyMs?
totalLatencyMs
promptTokens?
completionTokens?
reasoningTokens?
totalTokens?
usageSource = provider | estimated | missing
errorCode?
routingConfigRevision?
```

不记录 prompt、response、userId、Authorization、Provider payload 或原始错误 body。

`LLMManager` 与 `EmbeddingManager` 只通过一个 recorder 写观察；删除双方各自的 `recordRouteResult`。流式路径用 `finally` 覆盖 success、Provider 失败、timeout 和调用方提前 return。只有真实收到流式 reasoning/content/tool 内容时才记录首响应延迟。

Recorder 内部吞掉并记录脱敏后的统计持久化错误，不能把成功的 LLM 结果变成业务失败。现有 AINovel `usageRecorder` 保留为独立、授权的用户统计投影，不把 userId 写进运营观察表。

## 4. 持久化替换

新增 migration `028_llm_call_observations.sql`：

- `zook_llm_call_observations`：以 `call_id` 为主键的脱敏调用观察。
- 范围/路由查询索引：`occurred_at`、`provider + occurred_at`、`provider_model + occurred_at`、route + time。

PostgreSQL observation 以 `call_id` 幂等写入。selector 健康查询通过 route + `occurred_at DESC, call_id DESC` 复合索引只读取最新 100 个健康影响样本，避免并发锁顺序改变真实时间顺序，也不在每次路由时扫描 35 天总量；历史总调用量由 dashboard aggregate 负责。

存储边界为：

- `src/infrastructure/database/llm-observability-store.ts`：`LlmObservabilityStore` contract。
- `src/infrastructure/database/postgres/postgres-llm-observability.ts`：SQL insert/health/query/cleanup owner。
- `src/testing/in-memory-llm-observability-store.ts`：确定性测试实现。
- `ApplicationDatabase` 只暴露一个 focused `llmObservabilityStore` 依赖，不把 SQL 或聚合逻辑塞入已经较大的 database class。

raw observations 保留 35 天，覆盖最长 30 天查询并留出延迟处理余量。worker 每天通过 focused retention service 删除 35 天前 observation。生产并发验证必须针对真实 PostgreSQL 执行；30 天代表性数据量使用 `EXPLAIN ANALYZE` 验证查询时间预算。

保留 `LlmMetricsService` 和 `LlmHealthService` 作为 canonical public owner，但改为使用 `ApplicationDatabase` 查询。上线切换后删除：

- `src/services/llm-metrics-buckets.ts`
- `llm-metrics:*` KV bucket/index 读写
- `llm-health-window` KV 读写
- Chat/Embedding 中重复的 health + metrics 写入

原 Redis 数据不双写、不长期并行读取。Admin 用 `dataAvailableSince` 解释冷启动数据窗口。

## 5. 查询与 Admin API

继续使用现有 canonical Admin metrics endpoints：

- `GET /api/v1/admin/apps/common/llm-service/metrics`
- `GET /api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}` 作为兼容入口，委托给同一个查询服务。

新增 query：

```text
range = 24h | 48h | 7d | 30d
operation = chat | embedding
provider
providerModel
```

默认 `48h`。只返回当前筛选范围的一条 timeline；Model、Provider、route 和 Provider × Model 返回 summary，避免为每一行返回完整时间序列。

`/metrics` 是 Admin 内部、与前端同版本发布的有意 response-shape 替换，不承诺旧 `models[].items` 结构；同一提交更新唯一调用方和测试。`/metrics/models/{modelKey}` 委托新查询服务并保留两个生产 release，随后在确认无调用点后删除。

summary 最大返回：Provider 50 行、Provider Model × operation 100 行、route/cross 500 行；每组返回 `totalCount` 和 `truncated`。Admin 图表只显示 Top 10，表格展示已返回的完整有界集合。API 增加 payload-bound/truncation 测试。

响应包括：

- `generatedAt`、`dataAvailableSince`、`timezone`、`granularity`、active filters。
- 总 summary 与当前筛选 timeline。
- Provider Model × operation summaries。
- Provider × operation summaries。
- Provider × Provider Model × operation route summaries。
- 独立的 Provider × Provider Model × operation cross summaries；不能用包含 routing Model 的 route 行拼接矩阵。
- current routing snapshot，含 config revision/updatedAt 和 canonical routing evaluation。
- nullable p50/p95 与 TTFT eligible sample count。
- provider/estimated/missing usage counts。
- outcome counts 和明确的可靠性成功率。
- `latencyByOperation`；调用类型为全部时不返回混合百分位，分别给出 Chat/Embedding percentile。
- `routingConfigChangedWithinRange`：由 `routingConfigRevision` observation 或配置 revision 时间线确定，用于抑制错误的期望/实际偏差告警。
- routing share 和 revision cohort 只受时间/operation 约束，不因 Provider/Provider Model 下钻而改变分母。
- PostgreSQL aggregate queries 在同一个 repeatable-read read-only snapshot 内顺序执行。

百分位由 PostgreSQL `percentile_disc` 基于 observation 查询得到。Token 使用 `totalTokens` 为 canonical 总量；展示 breakdown 时：

```text
visibleOutputTokens = max(completionTokens - reasoningTokens, 0)
unclassifiedTokens = max(totalTokens - promptTokens - visibleOutputTokens - reasoningTokens, 0)
```

缺失 usage 保持 nullable，并单独计数，不转为精确 0。

## 6. Admin 前端边界

不继续扩大已超过 400 行的 `apps/admin-web/app/routes/llm.tsx`。新增：

- `hooks/use-llm-operations-dashboard.ts`：筛选、60 秒刷新、AbortController/序列号防 stale response、保留旧数据、timer cleanup。
- `components/llm-monitor/overview-section.tsx`
- `components/llm-monitor/operations-tables.tsx`
- `components/llm-monitor/routing-section.tsx`
- `components/llm-monitor/cross-matrix-section.tsx`
- `components/llm-monitor/detail-section.tsx`
- `components/llm-monitor/llm-chart.tsx`：唯一 ECharts adapter，负责 init/update/ResizeObserver/reduced-motion/dispose。
- `components/llm-monitor/llm-monitor-view-model.ts`：纯 DTO → presentation mapping。

复用 Ant Design `Table`、`Select`、`Segmented`、`Skeleton`、`Alert`、`Empty`、`Tag` 和现有 `MetricCard`/surface/card tokens。图表仅新增 `echarts`，通过 `echarts/core` 注册需要的 line/bar/heatmap、tooltip、legend、grid、dataZoom 组件。

旧 `LlmMonitorTab` 改为薄组合层；删除原始手写监控 table 布局，不保留第二套 monitor。

## 7. 文档同步

同轮更新：

- `docs/admin-web-design.md`
- `docs/admin-api-spec.md`
- `docs/current-backend-implementation-overview.md`

Admin-only contract 不加入公开 OpenAPI。

## 8. 验证矩阵

### 后端

- 1000 个并发 observation 不丢计数，重复 `callId` 不重复累计。
- success/failure/timeout/cancelled/stream early return 均只 finalize 一次。
- 统计库失败不影响成功业务结果。
- p50/p95 覆盖 global、Provider、Provider Model、Provider × Model。
- TTFT 排除 non-stream、Embedding 和首内容前失败，覆盖率正确。
- Reasoning 不重复计入总量；provider/estimated/missing usage 可区分。
- `auto/fixed/disabled provider/warm-up/all-zero/compatibility fallback/zero random boundary` 的 API 值等于实际 selector 值。
- 使用 `10/11` 成功等非终止小数验证：successRate/healthScore 先四舍五入两位，selector 边界与 API evaluation 完全相同。
- 默认 48h、组合筛选、nullable 缺失值、Admin auth/audit 和 model 兼容 endpoint。
- neutral cancellation 不推进健康 warm-up；全部调用类型下不生成混合 Chat/Embedding percentile。
- 真 PostgreSQL 下的 CTE 幂等/1000 并发测试、35 天 retention cleanup 和代表性 30 天查询计划/时间预算。
- summary 行数、`totalCount/truncated` 和 response payload bound。
- 配置 revision 在所选范围中途变化时返回 `routingConfigChangedWithinRange=true`。

### 前端与视觉

- Admin typecheck、build、presentation/helper tests。
- 固定高密度样例覆盖长名称、10+ Model、多 route、缺失 usage、空数据、部分失败、fixed/auto。
- 真实浏览器检查宽屏、1280、1100、720 和窄屏。
- 无元素重叠、无整页横向滚动、无标题/图例/筛选遮挡、无过大字号/间距、表格仅内部滚动。
- 图表 resize、Skeleton 稳定、键盘 matrix 下钻、焦点、reduced-motion、空/错/旧数据状态。
