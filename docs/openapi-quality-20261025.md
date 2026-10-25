# Zook 源码行数与 OpenAPI 质量闭环（2026-10-25）

基线提交：`7653fb10f4465c04730a774bc6074f75779f43b4`。本轮仅整理仍存在的行数问题、公开合同告警及对应回归，不新增产品功能，不推送、不发布。之前的后端审计报告继续保持未提交。

## 行数复查

| 文件 | 本轮开始 | 本轮结束 | 处理 |
| --- | ---: | ---: | --- |
| `src/modules/bodylog/bodylog-group.service.ts` | 583 | 583 | 已在既有基线修复，本轮不修改 |
| `src/infrastructure/database/postgres/postgres-bodylog-admin.ts` | 537 | 537 | 已在既有基线修复，本轮不修改 |
| `src/infrastructure/database/application-database.ts` | 567 | 567 | 已在既有基线修复，本轮不修改 |
| `src/infrastructure/database/postgres/postgres-database.ts` | 675 | 558 | 提取身份与角色权限存储；移除该文件 674 行历史豁免 |
| `apps/admin-web/app/lib/admin-api.ts` | 591 | 591 | 已在既有基线修复，本轮不修改 |
| `src/application-factory.ts` | 589 | 589 | 已在既有基线修复，本轮不修改 |
| `src/infrastructure/database/postgres/postgres-bodylog-checkin.ts` | 512 | 512 | 已在既有基线修复，本轮不修改 |
| `src/app/lighttick-v1-routes.ts` | 574 | 574 | 已在既有基线修复，本轮不修改 |

`PostgresAuthorizationStore`（82 行）与 `PostgresUserStore`（71 行）接收调用方的 query 闭包，SQL、排序、幂等插入、参数与返回值保持一致；继续通过 `sessionContext` 获取活动事务连接。没有新建连接池，没有把请求状态挂到存储实例，也没有改变账号或权限策略。原先八个目标文件现在均不超过统一 599 行限制；其余既有 allowlist 保持原样。

## OpenAPI 复查与处理

全仓 19 份 OpenAPI 合同最初有 **197 条 warning、0 error**，其中 FrogSleep 为 134 条。规则分类：147 条缺少 4xx 响应、37 条未引用组件、5 条 tag 描述缺失、4 条路径模板歧义、3 条缺少 2xx、1 条条件必填字段未定义。

本轮修复 **181 条真实缺项**：

- 为已有接口补齐实际存在的鉴权或参数错误响应，补充 FrogSleep tag 描述。
- 日志、文件、通知、公开配置与 LightTick 资源响应引用对应数据模型；保留响应 envelope。
- FrogSleep 私有同步状态、权益、邀请预览/投递和周报接入对应 schema；请求中的 goal 类型仍保留原有约束。
- 通知类型保持可扩展字符串，既有 `invitation_created`、`invitation_declined` 以及未来类型仍可解析。投递 `not_queued` 不要求不存在的 attempt_count。
- Coach chat 的条件必填 message 在条件分支内使用同一个字段定义；仍拒绝缺失或空字符串 message，其他 scene 不强制 message。
- 按唯一来源重新生成公开运行时合同，未新增依赖或修改生产接口行为。

### 16 条精确语义例外

Redocly recommended 规则继续启用；没有全局关闭或降级规则。`api-contracts/.redocly.lint-ignore.yaml` 只列出下述已核实节点，原因逐条存放于 `api-contracts/lint-exceptions.json`。这 16 条是有依据的精确例外，不能描述为 197 条全部通过修改合同消除。

| 数量 | 场景 | 保留依据 |
| ---: | --- | --- |
| 5 | AINovel 加密内层模型未作为外层 wire schema 引用 | 外层保持 AES-GCM envelope；用 `x-decrypted-*` 指向真实内层模型，不伪造明文响应字段 |
| 1 | 旧 BodyLog 单任务完成接口没有 2xx | 明确返回 409 `BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED`，禁止手动完成绕过证据 |
| 1 | BodyLog 兼容命名 Mission response 未被路由使用 | 保留命名合同供既有消费者追溯；实际任务读取使用 MissionList |
| 1 | 无参数、无鉴权 health 缺少 4xx | 实际 liveness 路由直接返回 200，没有接口自身的参数拒绝分支 |
| 4 | 两个邀请落地链接各缺少 2xx 与 4xx | 无论是否有 locator 均返回 302 预览 deep link；埋点错误为 best effort，不伪造 200 或错误载荷 |
| 1 | FrogSleep 群邀请动作与成员移除模板 | 群 ID 为服务端生成的 buddy_group_*，不使用保留段 invitations，实际路由保持兼容 |
| 3 | LightTick 请求收据与行动接口模板 | 收据是 GET /requests/{key}，变更是 POST；calendar GET 和变更限定 action-* ID，运行时按方法和 ID 命名空间区分 |

`openapi-quality.test.ts` 检查规则未关闭、例外与理由一一对应、指针确实存在且不使用通配忽略、加密内层引用存在，并校验实际健康/跳转状态与 FrogSleep 响应。既有 BodyLog evidence、群组和 LightTick actions 测试继续覆盖相关运行时分派。未来新增告警必须调查原因，禁止直接重新生成 ignore 文件。

## 回归与证据

- 行数门禁通过：694 个源码文件按现有规则检查，原先八个目标文件均在 599 行内；没有新增行数豁免。
- 独立副本 OpenAPI 全仓 lint：0 error、0 未处置 warning、16 条精确语义例外。
- 独立副本合同生成一致性与 LightTick actions 类型检查通过。
- 工作区全量单元测试：1618 通过、0 失败、1 条条件跳过。
- 独立副本全量单元测试同样为 1618 通过、0 失败、1 条条件跳过，证据 `independent-unit.log`。
- 条件跳过的邀请时序文件另配独立 PostgreSQL 数据库执行：7 项全部通过、0 跳过；与全量单元部分重叠，不简单累加。
- 独立副本全部 15 个 FrogSleep PostgreSQL 文件及新增权限/身份测试：16 文件、97 项全部通过、0 失败、0 跳过。
- 工作区扩大回归：BodyLog 与 LightTick 共 11 个 PostgreSQL 文件、31 项全部通过。
- 新增合同专项 4 项通过，覆盖真实状态/权益/邀请响应、302 落地行为、条件 message 验证及通知类型兼容；新增权限/身份集成测试 4 项通过，覆盖 app 隔离、幂等、账户查找规范化及事务回滚。

另发现一个**与本轮无关的既有回归问题**：`test/integration/postgres-llm-observability-concurrency.test.ts` 只执行 028/035/036 migrations，遗漏 `067_llm_observation_call_purpose.sql`，随后存储插入 `call_purpose` 列失败。该失败已在原始 `7653fb1` 独立副本复现（`baseline-llm.log`）。相关测试和实现保持原样，不将它计为通过；因此不能宣称全仓所有 PostgreSQL 集成测试全绿。

所有日志位于 `/Volumes/肖豪/project/Zook/.artifacts/code-quality-20261025/`。

并行探索回归中的 account-data/backend-loop/first-completion 三个 PostgreSQL 文件触发测试框架 90 秒超时，该轮不计为通过；保留 `initial-timeout-*.log`。最终独立副本使用各自的新本地数据库串行复跑，框架预算 240 秒，未修改运行时超时或测试断言。

独立候选副本仅来自 Git 基线与所选文件，位于证据目录下 `Zook/`。复用本地已安装依赖，不读取其他未提交源码。`baseline.json`、`selected.json`、`tree.txt` 与 `preservation.json` 用于核对范围、提交内容和无关文件保留情况。

本轮不验证生产推送/邮件送达、真实购买、线上部署或实际留存改善；源码和合同门禁通过不等于这些外部链路已经验收。
