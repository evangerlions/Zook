# 当前后端实现概览

## FrogSleep 搭子 PostgreSQL 并发门禁

搭子领域 slot、relationship 与原子接受的真实并发验证使用独立命令：
`FROGSLEEP_TEST_DATABASE_URL=postgresql://... npm run test:postgres:buddy`。该 URL 必须指向可丢弃的
PostgreSQL 数据库；测试会执行仓库真实 migrations，并使用两个独立连接池。普通 `npm test` 不读取此变量，
也不会连接数据库。

## 1. 文档目的

本文档用于说明当前仓库中已经完成的后端工作，方便后续继续开发、接手维护和对照设计文档推进。

当前实现是一个基于 TypeScript 的 MVP 骨架，重点是把核心业务规则先落地并通过单元测试验证。
FrogSleep 搭子闭环已覆盖统一邀请、授权、通知、成长主页、共同目标、里程碑与隐私周报；P3 通过 `012_frogsleep_buddy_governance.sql`、`buddy-governance.ts`、运营 runbook 和专项安全审查补齐数据保留、漏斗、护栏熔断与事故响应。
需要注意的是，当前仓库仍然使用轻量运行时骨架，HTTP、数据库和队列还没有切到正式框架；不过后台状态持久化已经统一收敛到 Redis-backed `KVManager`。

### API 合同所有权与运行时边界

公共 OpenAPI 的唯一来源是 `api-contracts/openapi/**`。该目录只参与维护期生成和 lint，不属于根 npm workspace，也不会复制进生产 Docker 镜像。运行时代码只依赖提交后的 `src/generated/openapi/public-contracts.generated.ts`，不得直接读取 `api-contracts/`。旧 API 仓库、submodule 和同步脚本已停用，完整流程见 `docs/api-contracts.md`。

LightTick 已在独立 feature worktree 中实现统一后端：唯一产品 key 为 `lighttick`，
外部接口合同位于 `api-contracts/openapi/lighttick/api.yaml`，Zook 运行时类型由
`npm run generate:public-contracts` 固化到 `src/generated/openapi/`。产品域已包含目标、
计划、Today、任务命令、复盘、提案、同步、设备、通知、AI run，以及 additive 的
action-first 渐进启动闭环。渐进启动提供确定性 starter fallback、首次行动事实反馈、
三日预览、周承诺门槛、同 lineage 任务变体和暂停/恢复模式；原 plan-first onboarding
继续兼容。受限游客身份可通过设备绑定证明事务升级到正式 LightTick membership，迁移保持
资源 ID、版本、执行事件、幂等结果和同步序列，并以独立升级操作记录支持丢失响应重放。
刷新令牌使用原子消费标记保证并发轮换只有一个成功；登出保留产品数据，LightTick 删除则要求
5 分钟有效的一次性密码重新认证证明，并只清理 LightTick membership、数据和会话。
LightTick 独立公开配置在产品关闭时仍可读取，并以固定白名单响应环境、双端最低版本、
游客有效期、功能开关与 HTTPS 法律/支持入口；管理配置中的密钥和内部字段不会透传。
LightTick 通知已复用公共 APNs/FCM 适配器，但使用产品自有安全载荷、APNs topic 和可选独立
Firebase 项目；调度按业务日期幂等，遵守 profile timezone、安静时段、分类偏好和暂停目标，
不可恢复 token 只失活匹配的 LightTick device，日志不记录 token 或 provider 凭据。
能力仍受 `LIGHTTICK_ENABLED` 控制，完成 main 同步、真实 PostgreSQL 升级
测试和 dev rollout 前不得视为线上开放。旧 Go 后端和 Flutter 客户端仅用于行为核对，
不再拥有生产数据、合同或运行时。

## 2. 当前已完成的主要功能

### 2.0 BodyLog app-scoped 产品能力

BodyLog 复用共享邮箱验证码认证，并提供固定产品作用域 `bodylog` 的公开 API：

1. `GET /api/v1/bodylog/profile` 获取或初始化昵称、预设头像和完成状态。
2. `PUT /api/v1/bodylog/profile` 校验 2–20 字符昵称、头像白名单，并复用 Common 内容安全能力。
3. PostgreSQL 通过 `021_bodylog_profiles.sql` 保存资料；内存数据库提供一致的测试实现。
4. 删除 BodyLog app 账号会清理 BodyLog 服务端资料，保留共享 Zook 用户与其他 app 数据。
5. 好友申请、拉黑和举报由 `022_bodylog_social.sql` 持久化，拉黑会隔离共享社交状态。
6. 排行榜只接收冻结的目标快照和完成聚合，服务端负责计分与公开资格判定。
7. 邀请归因包含同设备、自邀请和重复归因防护；挑战仅允许邀请未拉黑好友。
8. 完整外部契约位于 `api-contracts/openapi/bodylog/api.yaml`。

对应核心文件：

1. `src/modules/bodylog/bodylog-profile.service.ts`
2. `src/app/bodylog-v1-routes.ts`
3. `src/infrastructure/database/postgres/migrations/021_bodylog_profiles.sql`
4. `test/unit/bodylog-profile.api.test.ts`
5. `src/modules/bodylog/bodylog-social.service.ts`
6. `src/modules/bodylog/bodylog-leaderboard.service.ts`
7. `src/modules/bodylog/bodylog-invitation.service.ts`
8. `src/modules/bodylog/bodylog-challenge.service.ts`

### 2.1 API / Worker / Admin Web 三入口

当前项目已经具备三个入口：

1. `src/main.ts`
   用于启动 API 服务，对外提供 HTTP 接口。
2. `src/worker.ts`
   用于启动 Worker，负责异步任务处理和失败事件重投。
3. `apps/admin-web/server.ts`
   用于启动后台管理前端服务，对浏览器提供控制台页面，并把 `/api/*` 请求代理到 API 服务。

### 2.2 认证与鉴权

已实现以下认证与鉴权能力：

1. Bearer 单轨认证。
2. Access Token 签发与校验。
3. Refresh Token 轮换与撤销。
4. Web / App 两类客户端返回数据差异。
5. 登录失败次数限制与临时锁定。
6. `appId` 作用域校验。
7. `X-App-Id` 与 Token 中 `app_id` 的一致性校验。
8. 本地开发环境支持指定邮箱的 email-code 登录旁路，便于本机联调。

对应核心文件：

1. `src/modules/auth/auth.service.ts`
2. `src/modules/auth/token.service.ts`
3. `src/core/guards/auth.guard.ts`
4. `src/core/guards/app-access.guard.ts`
5. `src/core/context/app-context.resolver.ts`

### 2.3 App 成员关系与默认入组策略

已实现以下 app 级别规则：

1. `AUTO` 模式下首登自动加入 app。
2. `INVITE_ONLY` 模式下拒绝未受邀用户首登。
3. 自动为新成员绑定默认角色。
4. 校验 app 状态与 app 内成员状态。

对应核心文件：

1. `src/modules/app-registry/app-registry.service.ts`
2. `src/services/versioned-app-config.service.ts`

### 2.4 RBAC 权限模型

已实现 app 作用域下的权限判断：

1. 用户通过角色获得权限。
2. 权限基于 `roles -> role_permissions -> permissions` 关系计算。
3. 可对接口执行权限断言。

对应核心文件：

1. `src/modules/iam/rbac.service.ts`
2. `src/core/guards/rbac.guard.ts`

### 2.5 Analytics 事件与指标聚合

已实现以下统计能力：

1. 批量写入行为事件。
2. 支持 `page_view`、`page_leave`、`page_heartbeat`。
3. 按 app 维度统计 DAU。
4. 按 app 维度统计新用户数。
5. 按 `pageKey + platform` 聚合页面停留时长。
6. 按 `Asia/Shanghai` 自然日口径聚合。

对应核心文件：

1. `src/modules/analytics/analytics.service.ts`

### 2.5.1 OrangeWrite GA4 / Sentry 透明网关

OrangeWrite telemetry 使用独立的 raw-body 网关，不进入 JSON 业务路由，也不
复用 Zook Analytics 事件模型：

1. `POST /telemetry/ga4` 原样转发官方 GA4 Measurement Protocol JSON；
   Zook 只从环境变量注入 measurement ID 与 API secret。
2. `POST /telemetry/sentry/api/{projectId}/envelope/` 原样转发 Sentry
   Envelope；project、public key 与 HTTPS ingest origin 必须匹配服务端白名单。
3. 两条 lane 都限制 method、content type、body size、每 IP 速率与三秒上游
   timeout；不重试、不持久化 payload。
4. 网关日志只记录 request ID、lane、path、status、latency、byte count 与
   bounded failure code，不记录 body 或 provider credentials。
5. Sentry 成功响应的 event ID body、content type 与 rate-limit headers 会在
   64 KiB 上限内原样返回；`X-Forwarded-For` 只信任 loopback 或
   `ZOOK_TRUSTED_PROXY_IPS` 明确配置的反向代理。
6. `POST /api/v1/analytics/events/batch` 保持原实现，OrangeWrite 新 telemetry
   不调用该接口。

对应核心文件：

1. `src/modules/telemetry/telemetry-gateway.ts`
2. `src/modules/telemetry/telemetry-rate-limiter.ts`
3. `src/application-telemetry-runtime.ts`
4. `test/unit/telemetry-gateway.test.ts`

### 2.6 文件上传流程骨架

已实现以下文件流程：

1. 生成上传预签名信息。
2. 确认上传后写入文件记录。
3. 下载前按 `app_id + owner_user_id` 做访问校验。

对应核心文件：

1. `src/infrastructure/files/storage.service.ts`

### 2.7 通知与失败事件补偿

已实现以下异步机制：

1. 通知任务入队。
2. 入队失败写入 `failed_events`。
3. Worker 可扫描并重投到队列。
4. 队列支持重试和死信队列模拟。

对应核心文件：

1. `src/services/notification.service.ts`
2. `src/services/failed-event-retry.service.ts`
3. `src/infrastructure/queue/bullmq/in-memory-queue.ts`

### 2.8 审计、日志、异常与校验

当前横切能力也已经补齐：

1. 审计日志写入。
2. 请求日志输出。
3. 统一异常转换。
4. 基础请求参数校验。

对应核心文件：

1. `src/core/interceptors/audit.interceptor.ts`
2. `src/core/interceptors/request-logging.interceptor.ts`
3. `src/core/filters/http-exception.filter.ts`
4. `src/core/pipes/validation.pipe.ts`
5. `src/infrastructure/logging/pino-logger.module.ts`

### 2.9 Common 配置与 LLM 路由监控

当前已经补齐两类 Common 级能力：

1. `common.email_service_regions` 的强类型配置、版本记录与恢复
2. `common.llm_service` 的强类型配置、版本记录与恢复，以及可选的 OpenRouter `oa-hmac-v1` 透明代理路由；代理开关和 Key ID 存配置，HMAC secret 从 `common.passwords` 动态读取；内置禁用的 OpenRouter `openrouter/free` 测试模型不会改变 AINovel 默认路由
3. 阿里云百炼 Token Plan 作为独立 Chat Provider `bailian_token_plan` 接入其套餐专属 OpenAI-compatible Base URL，与 `bailian_coding` 完全分离；`common.passwords` 中存在 `bailian.token_plan_api_key` 时，启动配置迁移会幂等加入 Token Plan Provider 和其支持的文本模型，不改变现有默认模型或既有模型路由；当前不使用 Anthropic 端点或依赖 Responses API 的内置 Harness
4. LLM 按 `auto / fixed` 两种策略路由；公共方法 `resolveLlmRoutingUnit(did, uid)` 直接接收两个可空字符串，各取清洗后的末尾 3 个 base36 字符，使用两者之和对 1,000 取模形成稳定 Provider 分桶；任一入参清洗后不足 3 位时，该项由方法内部 `Math.random()` 生成的 0–999 值替代
5. PostgreSQL 脱敏 LLM call observation；每 route 健康窗口按 observation 时间顺序派生最近 100 个健康影响样本，客户端取消和内容业务拒绝不污染健康分
6. canonical 路由 scorer 统一 Chat、Embedding 和 Admin runtime 的 `weight × healthScore`、全零回退与 fixed 选择；健康加权概率用于缺省身份请求，完整 DID+UID 请求按基础权重保持稳定 Provider 分桶
7. 默认 48h 的 Admin LLM 运营看板：调用/Token/可靠性、P50/P95、Provider Model 和 Provider 汇总、动态路由分、独立 Provider × Model cross aggregate 矩阵与筛选下钻；一次响应的历史 aggregates 来自同一 repeatable-read snapshot
8. LLM metrics 将路由 Model 与实际 Provider Model 分开：前者解释动态选择，后者用于 Token/延迟运营排行
9. 调用观察不保存 prompt、response、userId、Authorization 或 Provider 原始 payload，并由 worker 清理 35 天前数据

对应核心文件：

1. `src/services/common-email-config.service.ts`
2. `src/services/common-llm-config.service.ts`
3. `src/services/llm-manager.ts`
4. `src/services/llm-routing-score.ts`
5. `src/services/llm-call-observation.ts`
6. `src/services/llm-health.service.ts`
7. `src/services/llm-metrics.service.ts`
8. `src/infrastructure/database/postgres/postgres-llm-observability.ts`
9. `apps/admin-web/app/components/llm-monitor/`
10. `docs/admin-web-design.md`

### 2.10 App 级 i18n 设置与本地化工具

当前已经补齐一版服务端多语言文本底座：

1. `i18n.settings` 的 app 级强类型配置、版本记录与恢复
2. 请求 locale 的统一解析与 normalize
3. 文本 locale fallback 统一工具
4. `*_i18n` 字段的批量本地化工具
5. Admin API 的 i18n 设置读写与回滚

对应核心文件：

1. `src/services/app-i18n-config.service.ts`
2. `src/services/request-locale.service.ts`
3. `src/services/i18n.service.ts`
4. `src/shared/i18n.ts`

### 2.11 客户端日志任务拉取与加密上传

当前已经补齐一版客户端日志上报底座：

1. 客户端日志上传任务拉取
2. `AES-256-GCM` 密文上传
3. `gzip + NDJSON` 解压与解析
4. 窗口、条数、大小限制校验
5. 日志上传记录与已接收日志行入库

对应核心文件：

1. `src/services/client-log-upload.service.ts`
2. `src/app.module.ts`

### 2.12 产品公开配置接口

当前已经提供一条通用产品公开配置接口：

1. `GET /api/v1/{productKey}/public/config`
2. 数据来源是后台维护的 `admin.delivery_config`
3. 返回值为当前 app 配置的 JSON 对象
4. 如果请求同时携带 `X-App-Id` 或 Bearer Token，则必须与 path 中的 `productKey` 对应 app 一致
5. 这里的 `productKey` 是 URL namespace；运行时数据与鉴权仍使用 `appId`
6. LightTick 使用独立的 `/api/v1/lighttick/public/config` 合同，不返回通用接口的原始
   `config` 对象；它在业务关闭时仍提供安全启动元数据，且只有运行时与后台开关同时开启时
   才会把公开能力标记为启用

### 2.13 AINovel 加密 AI 能力接口

当前 `ai_novel` 已经补齐一版正式 AI 能力接口：

1. `POST /api/v1/ai_novel/ai/chat-completions`
2. `POST /api/v1/ai_novel/ai/embeddings`
3. 两条接口都强制要求 Bearer 鉴权与 `app_id = ai_novel`
4. 请求与响应都支持 `AES-256-GCM` JSON envelope
5. 解密成功后的业务成功与业务错误都会加密返回
6. `scene_key` / `sceneKey` 只选择 AINovel 的 Prompt、工具和响应工作流；客户端不允许直传底层 `model`、`modelKey`、`providerModel` 或 routing tier 字段。所有文本场景共用服务端 `ai_novel.model_selection.chat.default` 选出的模型
7. 所有 Agent scene 都采用单轮 tool-calling HTTP/SSE 输出：Zook 注入唯一 system prompt，并按解密后 context 的 `suppliedTools` 过滤工具；AINovel 的 Pi Agent 负责工具执行、error tool result、interactive tool 暂停和下一轮回写。解密 inner body 的顶层 `agentProtocol = pi-v1` 启用按需上下文：Zook 不再把 raw context 拼入 system 或 user message，当前状态由客户端 Agent 的真实 read tool 返回；缺失该字段的旧客户端保持原有 context 组装。Zook 不修复 tool name 大小写，也不规范化或重写客户端工具 payload
8. assistant 历史消息可携带 `reasoningContent`，Zook 在百炼/OpenAI-compatible provider 请求中转成 `reasoning_content`，保证深度思考模型的多轮 context/cache 连贯；该字段只用于 provider context replay，不作为普通用户可见内容展示
9. AINovel 通过 AES-GCM 的 `agent-skills/query` / `agent-skills/fetch` 在每个 app 生命周期首次懒加载 Skill manifest 与仅有变更的 package，并固定本地 snapshot。只有 `agentProtocol = pi-v1` 的 interactive Write Agent，且 `suppliedTools` 声明 `read` 并提供非空批准 catalog 时才可使用虚拟 `read(path)`。Pi 客户端在每次 Agent run 开始时将 catalog 作为独立 bootstrap system-reminder 放入正常 transcript；Zook 仅用加密 context 过滤 schema，不向模型串行化 raw catalog。完整内容和 references 由 AINovel 的本地 allowlist snapshot 作为 normal tool result 返回，运行中不访问网络。旧客户端、其他 Agent scene 与 Generation Job scene 不提供 Skill
10. local/debug 环境额外提供 `POST /api/v1/ai_novel/debug/audit-file`，仅用于 AINovel Flutter Web 上传 generation audit HTML；生产或非本机 host 返回 404，服务端只按固定文件名覆盖写本地文件，不解析 audit 内容，并返回 local-only `viewUrl` 供浏览器新标签页打开报告
11. `POST /api/v1/ai_novel/ai-output-reports` 与 `POST /api/v1/ai_novel/ai-output-reactions` 提供独立的 AI 输出举报/点赞协议；举报正文加密落库，支持客户端幂等键、账号小时限流、Admin list/detail/status 与审计记录

对应核心文件：

1. `src/modules/ai-novel/ai-novel-llm.service.ts`
2. `src/services/aes-gcm-payload-crypto.service.ts`
3. `src/app.module.ts`

### 2.14 AINovel 产品级模型选择

当前 `ai_novel` 使用单一默认模型权重路由：

1. `ai_novel.model_selection` 使用通用版本化 App 配置存储，结构为 `schemaVersion + chat.default[]`，不支持会员档位或场景级模型覆盖
2. `chat.default` 的每一项为 `modelKey + weight`，模型键不可重复，每项权重大于 0 且最多两位小数，总和必须等于 100
3. 文本请求复用通用 `llm-routing-affinity`，以 `X-Did + auth UID` 得到同一个 routing unit，再按数组顺序累计权重选择最终 common LLM model key；所有文本场景使用同一结果
4. 整条配置不存在时使用代码默认 `qwen3.6-plus: 100`；配置损坏或引用失效模型时明确返回 `AI_UPSTREAM_CONFIG_INVALID`
5. Provider、上游 `providerModel`、密钥、Provider 路由权重和健康路由仍由 `common.llm_service` 负责
6. Embedding 使用代码中固定的 `text-embedding-v4` common model key，其 Provider 路由仍归 `common.llm_service`

对应核心文件：

1. `src/modules/ai-novel/ai-novel-model-selection-config.service.ts`
2. `src/modules/ai-novel/ai-novel-model-weight-selection.ts`
3. `src/services/common-llm-config.service.ts`
4. `src/modules/ai-novel/ai-novel-llm.service.ts`
5. `src/app.module.ts`

### 2.15 FrogSleep 多 App 兼容后端

当前 `frogsleep` 已作为 Zook app-scoped 产品接入，固定 app id 为 `frogsleep`。Zook 是当前多 app 注册、登录、session、refresh、app membership 与 FrogSleep 兼容层的后端所有者；FlutterDemo/AINovel 风格客户端继续走 `/api/v1/auth/*` 平台契约，FrogSleep 业务接口统一走 `/api/v1/frogsleep/*` 产品作用域契约，OpenAPI 来源为 `api-contracts/openapi/frogsleep/api.yaml`。所有 product-scoped 路由统一要求 token app scope 匹配、access token active、app 存在且当前用户 app membership active，避免已删除/封禁 membership 继续访问 ai_novel 或 FrogSleep 业务接口。FrogSleep 已作为 dev / online 部署槽的线上联调产品开放：`DEPLOY_SLOT=dev` 或 `DEPLOY_SLOT=online` 时默认 seed `frogsleep` app 并分发 FrogSleep 路由；`FROGSLEEP_ENABLED=true` / `FROGSLEEP_ENABLED=false` 可显式覆盖该默认值；测试仍可通过选项 `frogsleepEnabled` 控制。

FrogSleep `/api/v1/frogsleep/*` 成功响应采用迁移期双兼容格式：保留 Zook 标准 `code + message + data + requestId` 响应包，同时把对象型 `data` 字段复制到响应根部，让 Sleep 客户端可以读取 Go 后端风格的 raw JSON 字段。对象型业务详情还会同时提供根对象和嵌套对象，例如根部 `session_id`、`relationship_id` 与 `summary` / `relationship` 容器并存；列表接口保持容器字段，例如 `sessions`、`moments`、`pending_invites`、`sleep_reports`。业务 payload 避免占用顶层 `data` 字段，以免覆盖 Zook envelope。`/v1/*` 不属于 FrogSleep 外部 API；客户端必须使用 `/api/v1/frogsleep/*`。通用 `/api/v1/auth/*` 仍保持 Zook 平台响应契约。当前 iOS 项目使用的额外兼容字段也已纳入后端能力，包括 shared session 的 `shared_session_id`、`initiator_user_id`、`date_anchor`、`initiator_state`、`partner_state`，summary/recap 的 iOS 可见字段，preferences 更新后的 `relationship` 容器，以及 focus invite/message/achievement 的 iOS 读取别名。

已实现能力：

1. 在 dev / online 槽或显式启用时，在 seed/bootstrap 中注册 `frogsleep` app、默认角色和 `admin.delivery_config.inviteLinks`；默认关闭时 admin app 列表不出现 FrogSleep。
2. `/api/v1/frogsleep/auth/*` 兼容邮箱验证码、无验证码注册发码、密码注册、密码登录、密码重置、密码修改、token refresh、logout，并支持 `identifier`、`email_code`、`verification_id` 等兼容字段别名；邮箱 bind/change 使用独立 `email-change` 验证码 purpose，由 `/api/v1/frogsleep/auth/email/change-code` 发码，email-login 验证码不能修改共享账号 email。
3. `/api/v1/frogsleep/me`、当前 FrogSleep app 账号删除 `DELETE /api/v1/frogsleep/me/account`、邮箱 bind/change、`/api/v1/frogsleep/devices` app-scoped 设备注册与删除；FrogSleep 不提供删除共享 Zook 用户或其他 app membership 的接口，`DELETE /api/v1/frogsleep/me/account` 不要求 `confirmation`，会将当前用户的 FrogSleep membership 标记为 deleted、撤销 FrogSleep app session，并清理 FrogSleep app-scoped runtime data，包括睡眠报告快照、进度快照和权益记录。`/api/v1/frogsleep/auth/password/change` 修改共享 Zook 账号密码，会影响同一账号在其他 app 的密码登录；FrogSleep 专注匹配 `display_name` 等 profile 字段保存在 FrogSleep app-scoped entity payload，不写入共享 user。
4. 睡眠搭子邀请、pending 查询、登录后 preview 恢复、code/token/id 接受、拒绝、取消、当前关系、暂停、恢复、解除、守护偏好、共同守护 session、事件、暂停今晚、最新 summary/recap；睡眠关系状态机显式限制 `revoked` 为终态，`shared-sessions` 按 `relationship_id + date_anchor` 幂等，事件只接受 `interrupted`、`returned`、`paused_tonight`、`morning_completed`，守护偏好只接受文档化字段。summary/recap 已从最小占位升级为基于共同守护 session 和事件派生的 `artifact_version`、`visible_state`、`had_recovery`、`combined_result_type`、`supporting_line`、`recommended_next_step` 等字段，但仍不声称提供睡眠阶段或医疗级评分。守护偏好响应带回 `relationship`，共同守护 session 响应带 iOS 可解的发起人、双方状态和日期锚点 alias。邀请接受会记录 `source_invite_id`、`accept_source`、`accepted_at`、`accepted_by_user_id`，用于邀请转化分析；无指定目标的公开/纸条邀请不能被任意登录用户 decline，只能由发起人 cancel。
5. 专注搭子 session 上报、历史查询、周统计、成就、匹配资料、受控匹配搜索、候选邀请、直接邀请、登录后 preview 恢复、code/token 接受、关系动作、消息、presence、对比、共同专注时刻；session 上报校验 ISO 时间和非负有限时长，sessions / achievements / messages / shared 列表返回兼容容器字段并附加 `pagination` 元数据。presence 现在由 focus session、消息和共同专注时刻推导 `focusing`、`recently_active`、`idle`、`stale`，comparison 支持 `week_start`，messages 支持 `receiver_user_id` / `since`，shared 支持 `room_id` / `from` / `to` 并校验非法时间窗。匹配搜索会过滤未授权公开匹配、条件不兼容、已有关系、已被当前用户 dismiss/report 的候选人，并返回 `recommendation_type`、`privacy_note_key`、`why_recommended`、`invite_prompt_key` 等受控推荐解释字段；当前用户有未过期 outgoing pending 邀请时返回 `pending_invites` 空态，关联邀请过期时会先刷新 invite/relationship 状态再恢复搜索；dismiss/report 排除数据批量读取。专注关系动作仅允许 `accept`、`decline`、`revoke`，`revoked` 为终态且不能继续用于消息、presence、共同专注时刻；专注邀请、消息和成就响应同时提供 iOS 当前客户端读取的 alias。
6. FrogSleep 云端产品数据：支持 app-scoped 睡眠报告快照、进度快照和当前权益查询。报告内容通过 `snapshot_data` 返回，避免和 Zook envelope 的 `data` 冲突；进度 namespace 采用 allowlist；权益无记录时返回 unknown/free。logout 只撤销 FrogSleep app 登录态；`DELETE /api/v1/frogsleep/me/account` 会清理当前用户的 FrogSleep app-scoped 产品数据，但保留共享账号和其他 app 数据。
7. FrogSleep push payload 类型、通知入队、worker 设备分发、无设备成功收敛、provider 失败写入 failed event；APNs/FCM 对不可恢复无效 token 会仅清理当前 app/user/token 对应的 FrogSleep device，可重试 provider 错误继续走 failed event / retry 行为。
8. 睡眠搭子和专注搭子邀请 HTTP 中转端点，302 跳转到 deep link；中转会尽力记录 `first_opened_at`、`last_opened_at`、`open_count` 等打开统计，统计失败不影响 302。
9. PostgreSQL migration `006_frogsleep_app.sql` 新增 `zook_frogsleep_*` 表；内存数据库同步实现对应测试存储。
10. 搭子成长 P2 已增加共同目标持久化与 API 基础：支持四类中性模板、双边同意、IANA timezone 周窗口、版本/幂等动作、暂停/完成状态和可验证来源事件进度；`011_frogsleep_buddy_goals_reports.sql` 同时预备了里程碑与按查看者过滤的周报表及去重索引。
11. P2 worker 已接入首次有意义互动、首次共同行动和每周两次成长行为里程碑，以及按设备时区/查看者生成的周报。里程碑、周报和对应 notification outbox 在同一事务中写入；重复 worker tick 不重复物化，晚到验证事件只在内容变化时增加周报版本，撤权后读时再次删除对方统计。

对应核心文件：

1. `src/app/frogsleep-v1-routes.ts`
2. `src/modules/frogsleep/frogsleep-app.ts`
3. `src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts`
4. `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
5. `src/modules/frogsleep/sleep-buddy/sleep-buddy-invites.ts`
6. `src/modules/frogsleep/focus-buddy/focus-buddy-invites.ts`
7. `src/modules/frogsleep/frogsleep-validation.ts`
8. `src/modules/frogsleep/frogsleep-notifications.ts`
9. `src/services/apns-push-dispatcher.ts`
10. `src/infrastructure/database/postgres/postgres-frogsleep.ts`
11. `src/infrastructure/database/postgres/migrations/006_frogsleep_app.sql`
12. `docs/public-frogsleep-invites.md`

## 3. 当前可用接口

当前已经接入到应用入口中的接口包括：

1. `GET /api/health`
2. `POST /api/v1/auth/login`
3. `POST /api/v1/auth/refresh`
4. `POST /api/v1/auth/logout`
5. `POST /api/v1/auth/login/sms-code`
6. `POST /api/v1/auth/login/sms`
7. `POST /api/v1/auth/login/one-click`
8. `POST /api/v1/auth/register/sms-code`
9. `POST /api/v1/auth/register/sms`
10. `POST /api/v1/auth/password/sms-code`
11. `POST /api/v1/auth/password/reset-by-sms`
12. `GET /api/v1/users/me`
13. `POST /api/v1/users/me/delete`
14. `POST /api/v1/analytics/events/batch`
15. `GET /api/v1/admin/metrics/overview`
16. `GET /api/v1/admin/metrics/pages`
17. `POST /api/v1/files/presign`
18. `POST /api/v1/files/confirm`
19. `POST /api/v1/notifications/send`
20. `GET /api/v1/admin/apps/common/auth-rate-limits`
21. `PUT /api/v1/admin/apps/common/auth-rate-limits`
22. `GET /api/v1/admin/apps/common/email-service`
23. `PUT /api/v1/admin/apps/common/email-service`
24. `GET /api/v1/admin/apps/common/llm-service`
25. `PUT /api/v1/admin/apps/common/llm-service`
26. `GET /api/v1/admin/apps/common/llm-service/metrics`

27. `GET /api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}`
28. `GET /api/v1/admin/apps/{appId}/i18n-settings`
29. `PUT /api/v1/admin/apps/{appId}/i18n-settings`
30. `GET /api/v1/admin/apps/{appId}/remote-log-pull`
31. `PUT /api/v1/admin/apps/{appId}/remote-log-pull`
32. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks`
33. `POST /api/v1/admin/apps/{appId}/remote-log-pull/tasks`
34. `POST /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}/cancel`
35. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}`
36. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}/file`
37. `GET /api/v1/admin/apps/{appId}/ai-routing`
38. `PUT /api/v1/admin/apps/{appId}/ai-routing`
39. `GET /api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}`
40. `POST /api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}/restore`
41. `POST /api/v1/admin/sensitive-operations/request-code`
42. `POST /api/v1/admin/sensitive-operations/verify`
43. `POST /api/v1/admin/apps/{appId}/log-secret/reveal`
44. `GET /api/v1/logs/policy`
45. `GET /api/v1/logs/pull-task`
46. `POST /api/v1/logs/tasks/{taskId}/ack`
47. `POST /api/v1/logs/tasks/{taskId}/fail`
48. `POST /api/v1/logs/upload`
49. `GET /api/v1/{productKey}/public/config`
50. `POST /api/v1/ai_novel/ai/chat-completions`
51. `POST /api/v1/ai_novel/ai/embeddings`
52. `POST /api/v1/ai_novel/debug/audit-file`（local/debug only）
53. `POST /telemetry/ga4`
54. `POST /telemetry/sentry/api/{projectId}/envelope/`

账号删除当前按 app-scoped 语义实现：`users/me/delete` 会将当前 app membership 标记为 `DELETED`，撤销该 app 下用户 session，清理 app 侧 analytics、files metadata、client logs、notification jobs、user roles，并保留全局 `zook_users` 与 audit logs。

FrogSleep 产品接口已经接入应用入口，代表性接口包括：

1. `POST /api/v1/frogsleep/auth/email/send-code`
2. `POST /api/v1/frogsleep/auth/email/change-code`
3. `POST /api/v1/frogsleep/auth/email/login`
4. `POST /api/v1/frogsleep/auth/password/register`
5. `POST /api/v1/frogsleep/auth/password/login`
6. `POST /api/v1/frogsleep/auth/password/reset/request`
7. `POST /api/v1/frogsleep/auth/password/reset/confirm`
8. `POST /api/v1/frogsleep/auth/password/change`
9. `POST /api/v1/frogsleep/auth/token/refresh`
10. `POST /api/v1/frogsleep/auth/logout`
11. `GET /api/v1/frogsleep/me`
12. `DELETE /api/v1/frogsleep/me/account`（删除当前 FrogSleep app 账号）
13. `POST /api/v1/frogsleep/devices`
14. `DELETE /api/v1/frogsleep/devices/{deviceId}`
15. `POST /api/v1/frogsleep/sleep-buddy/invites`
16. `GET /api/v1/frogsleep/sleep-buddy/invites/preview`
17. `GET /api/v1/frogsleep/sleep-buddy/invites/pending`
18. `POST /api/v1/frogsleep/sleep-buddy/invites/accept-code`
19. `POST /api/v1/frogsleep/sleep-buddy/invites/accept-token`
20. `POST /api/v1/frogsleep/sleep-buddy/invites/{inviteId}/accept`
21. `POST /api/v1/frogsleep/sleep-buddy/invites/{inviteId}/decline`
22. `POST /api/v1/frogsleep/sleep-buddy/invites/{inviteId}/cancel`
23. `GET /api/v1/frogsleep/sleep-buddy/relationships/current`
24. `POST /api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/pause`
25. `POST /api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/resume`
26. `POST /api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/revoke`
27. `PATCH /api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/preferences`
28. `GET /api/v1/frogsleep/sleep-buddy/guardianship/status`
29. `POST /api/v1/frogsleep/sleep-buddy/shared-sessions`
30. `GET /api/v1/frogsleep/sleep-buddy/shared-sessions/active`
31. `POST /api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/accept`
32. `POST /api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/events`
33. `POST /api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/pause-tonight`
34. `GET /api/v1/frogsleep/sleep-buddy/shared-summaries/latest`
35. `GET /api/v1/frogsleep/sleep-buddy/shared-recaps/latest`
36. `POST /api/v1/frogsleep/focus-buddy/sessions`
37. `GET /api/v1/frogsleep/focus-buddy/sessions`
38. `GET /api/v1/frogsleep/focus-buddy/stats/week`
39. `GET /api/v1/frogsleep/focus-buddy/achievements`
40. `POST /api/v1/frogsleep/focus-buddy/achievements/notify`
41. `POST /api/v1/frogsleep/focus-buddy/match-profile`
42. `GET /api/v1/frogsleep/focus-buddy/match-profile/me`
43. `DELETE /api/v1/frogsleep/focus-buddy/match-profile`
44. `POST /api/v1/frogsleep/focus-buddy/matches/search`
45. `POST /api/v1/frogsleep/focus-buddy/matches/{userId}/invite`
46. `POST /api/v1/frogsleep/focus-buddy/matches/{userId}/dismiss`
47. `POST /api/v1/frogsleep/focus-buddy/matches/{userId}/report`
48. `POST /api/v1/frogsleep/focus-buddy/invites`
49. `GET /api/v1/frogsleep/focus-buddy/invites/preview`
50. `POST /api/v1/frogsleep/focus-buddy/invites/accept-code`
51. `POST /api/v1/frogsleep/focus-buddy/invites/accept-token`
52. `GET /api/v1/frogsleep/focus-buddy/relationships/current`
53. `POST /api/v1/frogsleep/focus-buddy/relationships/{relationshipId}/accept`
54. `POST /api/v1/frogsleep/focus-buddy/relationships/{relationshipId}/decline`
55. `POST /api/v1/frogsleep/focus-buddy/relationships/{relationshipId}/revoke`
56. `POST /api/v1/frogsleep/focus-buddy/messages`
57. `GET /api/v1/frogsleep/focus-buddy/messages`
58. `GET /api/v1/frogsleep/focus-buddy/presence`
59. `GET /api/v1/frogsleep/focus-buddy/comparison`
60. `GET /api/v1/frogsleep/focus-buddy/shared`
61. `POST /api/v1/frogsleep/product-data/sleep-reports`
62. `GET /api/v1/frogsleep/product-data/sleep-reports`
63. `PUT/PATCH /api/v1/frogsleep/product-data/progress/{namespace}`
64. `GET /api/v1/frogsleep/product-data/progress/{namespace}`
65. `GET /api/v1/frogsleep/product-data/entitlements/current`
66. `GET /frogsleep/sleep-buddy-invite`
67. `GET /frogsleep/focus-invite`

搭子增长 P0 另提供统一邀请与定向授权资源：`GET /api/v1/frogsleep/buddy/invitations`、邀请预览及显式 accept/decline/cancel，以及 `GET /api/v1/frogsleep/buddy/relationships/{relationshipId}/grants` 和 `PATCH /api/v1/frogsleep/buddy/relationships/{relationshipId}/grants/{grantId}`。接受邀请时按睡眠/专注领域分别创建双方的方向性分享授权；后续只有授权人本人能按版本修改自己的授权。方向授权已接入 Focus presence/周趋势对比/共享时刻/结构化互动，以及 Sleep 每日总结/联合回顾/共同睡眠活动。Migration 009 为旧关系幂等回填双向授权，应用层也在首次访问时补全未迁移数据；暂停、撤销、拉黑或单项授权撤销会立即终止对应读取与互动。

搭子通知支持 `GET/PATCH /api/v1/frogsleep/buddy/notifications/preferences`。Worker 将分类禁用和五分钟内同目标同事件合并为整体抑制；安静时段、同类冷却和每日预算仅抑制 Push，仍保留站内 feed。每次抑制都在 outbox 或 delivery 中记录稳定原因码，重试投递不会重复生成站内通知。

搭子增长 P1 通过 `/api/v1/frogsleep/buddy/hub`、`activity`、`shares`、`interactions` 和 `joint-activities` 提供。Hub 按对方身份合并同一人的睡眠/专注领域，不同对方保持分离；状态、每日总结、活动和夜间共同活动均在读取时重新校验方向授权。结构化分享仅保留白名单数值并最长 30 天过期；受限互动不接受自由文本；分享、互动和共同活动创建/响应使用幂等 key 并与通知 outbox 在同一排他会话中写入。

搭子增长 P2 已挂出 `FROGSLEEP_BUDDY_GROUP_ENABLED` 灰度后的 2-5 人群组搭子接口：`/api/v1/frogsleep/buddy/groups` 支持创建/列表/详情/更新，子资源支持群组主页、邀请、邀请 accept/decline/cancel、成员移除、角色调整、leave/pause/resume/dissolve 和共享基线授权视图。PostgreSQL 通过 `019_frogsleep_buddy_group_lifecycle.sql` 增加 canonical group aggregate、成员版本、邀请版本和 abandoned forming group 过期函数；应用层以 group 表为 source of truth，成员和邀请操作使用版本比较更新。

worker 会消费搭子 notification outbox，幂等生成站内 feed，并把只含 opaque notification ID 与安全路由的 Push 放入现有通知队列。站内 feed 支持分页、未读数、单条/全部已读和鉴权目标解析；物化与 APNs 入队分别记录 delivery attempt。

这些接口统一在 `src/app.module.ts` 中完成装配和分发。
客户端日志回捞的后端实现说明已经单独整理到 [client-log-remote-pull-backend.md](client-log-remote-pull-backend.md)，这里仅保留目录级摘要。最新实现已经改成“日志文件直接落本地 `.ndjson`，admin 前端本地解析浏览”，不再把日志逐行写入数据库。

补充说明：

- 目前仓库里已经预置了腾讯云短信验证码发送能力和腾讯云图形验证码校验能力，分别位于：
  - `src/services/tencent-sms-verification.service.ts`
  - `src/services/tencent-captcha-verification.service.ts`
- 目前腾讯云短信验证码发送能力已经接入对外 auth 主链路，用于短信登录 / 注册 / 密码重置。
- 后台现已补充一块 `common` 工作区下的短信验证码观测能力，可按 appId 查看最近 7 天短信记录，并通过受控 reveal 查看验证码明文。
- 后台现已补充一块 `common` 工作区下的认证风控配置页，用来统一调整验证码 TTL、发码冷却、发码 / 提交窗口限流、账号自然日配额、IP 自然小时配额，以及单验证码错码上限。
- 这些短信验证码记录会由 worker 在每天凌晨 4 点后执行一次硬删除清理，避免过期敏感数据继续保留。
- 短信发码接口支持一个仅用于联调和自动化测试的 `test` 布尔字段；当为 `true` 时，服务端会继续生成并缓存验证码，但不会真正调用短信发送服务。
- 当前验证码在有效期内最多允许输错 10 次；超过上限后，验证码立即失效并要求重新发码。
- 腾讯云图形验证码校验能力仍保留在后端，但当前短信主业务默认不启用验证码风控。
- 运行时默认复用 common password 工作区里的：
  - `tencent.secret_id`
  - `tencent.secret_key`
    作为腾讯云主凭证，不再单独维护短信专用的另一套密钥命名。
- 个验一键登录服务通过 `common.getui_gy_service` 启用，每个 Zook AppID 独立映射一套直接保存的个验凭据：
  - `apps[appId].appId`
  - `apps[appId].appKey`
  - `apps[appId].appSecret`
  - `apps[appId].masterSecret`
- 后台读取配置时会对 `appKey`、`appSecret`、`masterSecret` 脱敏；需要输入二级密码后才能查看明文。

## 4. 当前目录结构

### 4.1 顶层目录

```text
.
├── apps/
├── docs/
├── src/
├── test/
├── buid_readme.md
├── package.json
└── package-lock.json
```

### 4.2 src 目录说明

```text
src/
├── main.ts
├── worker.ts
├── app.module.ts
├── core/
│   ├── context/
│   ├── filters/
│   ├── guards/
│   ├── interceptors/
│   └── pipes/
├── infrastructure/
│   ├── cache/
│   ├── database/
│   ├── files/
│   ├── kv/
│   ├── logging/
│   ├── queue/
│   └── runtime/
├── modules/
│   ├── analytics/
│   ├── app-registry/
│   ├── auth/
│   ├── frogsleep/
│   ├── iam/
│   └── user/
├── services/
└── shared/
```

### 4.3 目录职责

1. `src/main.ts`
   API 进程入口，启动 HTTP 服务。
2. `src/worker.ts`
   Worker 进程入口，处理后台任务。
3. `apps/admin-web/server.ts`
   Admin Web 进程入口，负责控制台页面静态分发和 API 代理。
4. `src/app.module.ts`
   项目运行时装配中心，负责把各模块和路由串起来。
5. `src/core/`
   放守卫、拦截器、过滤器、上下文解析和基础校验。
6. `src/modules/`
   放核心业务能力模块。
7. `src/services/`
   放跨模块服务，例如配置服务、通知服务、失败事件重投服务。
8. `src/infrastructure/`
   放基础设施适配层，例如内存数据库、缓存、Redis KV、队列、日志、文件服务和运行时依赖探测。
9. `src/shared/`
   放共享类型、错误定义和公共工具函数。

### 4.4 test 目录说明

```text
test/
└── unit/
    ├── admin-web.server.test.ts
    ├── analytics.service.test.ts
    ├── app-access.guard.test.ts
    ├── auth.service.test.ts
    └── rbac.service.test.ts
```

当前测试覆盖：

1. 认证链路核心规则。
2. app 作用域拦截规则。
3. RBAC 权限判断。
4. analytics 指标计算规则。

## 5. 当前运行方式

常用命令如下：

```bash
npm run dev
npm run admin
npm run worker
npm test
```

默认 API 端口当前为 `3100`，也可以通过环境变量 `PORT` 覆盖。
Admin Web 默认端口当前为 `3110`。

## 6. 当前实现边界

当前实现已经可以用于验证设计规则，但还存在以下边界：

1. 还没有真正接入 NestJS 和 Fastify。
2. 还没有接入真实数据库和 ORM。
3. 还没有接入真实 BullMQ，也还没有把主业务数据迁移到正式数据库。
4. 密码哈希当前采用开发期适配实现，生产环境应替换为文档要求的 `argon2id`。
5. 当前更适合作为“业务规则原型”和“后续正式工程化改造”的基础。

## 7. 后续建议

建议下一步按以下顺序继续推进：

1. 把内存数据库替换为 Prisma + Postgres。
2. 把内存缓存和队列替换为 Redis + BullMQ。
3. 用 NestJS + Fastify 重构 HTTP 入口。
4. 补 integration / e2e 测试。
5. 增加 `compose.yaml`、环境变量模板和部署脚本。

## 8. FrogSleep 统一搭子邀请能力（2026-07）

当前实现已具备 canonical `/api/v1/frogsleep/buddy/invitations` 创建、收发箱、ID/code/token/notification locator 预览、accept/decline/cancel、按领域结果、邮件投递状态和 HTTPS handoff。目标支持 user ID 与未注册邮箱；邮箱注册后通过 verified email 原子认领，不向调用方暴露账号是否存在。

PostgreSQL migration 017 增加 app-scoped code/token 唯一约束、recipient binding、邮件 delivery/attempt outbox，并非破坏性投影仍存活的 sleep/focus 旧邀请。邮件 worker 使用公共腾讯云 SES 配置，支持 provider correlation、指数退避、最多五次、永久配置错误直接死信及 callback 状态回写。Admin 只读诊断接口只返回掩码邮箱和投递元数据。

能力开关依赖 `FROGSLEEP_BUDDY_INBOX_ENABLED`、`FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED` 和 `FROGSLEEP_BUDDY_EMAIL_ENABLED`；handoff base URL 使用 `FROGSLEEP_BUDDY_HANDOFF_BASE_URL` 或 app delivery config。生产可用仍以 migration、API/worker 同版本、SES sender/template/callback、真实邮箱与两账号验收全部通过为前提。
