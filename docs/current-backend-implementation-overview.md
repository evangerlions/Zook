# 当前后端实现概览

## 1. 文档目的

本文档用于说明当前仓库中已经完成的后端工作，方便后续继续开发、接手维护和对照设计文档推进。

当前实现是一个基于 TypeScript 的 MVP 骨架，重点是把核心业务规则先落地并通过单元测试验证。
需要注意的是，当前仓库仍然使用轻量运行时骨架，HTTP、数据库和队列还没有切到正式框架；不过后台状态持久化已经统一收敛到 Redis-backed `KVManager`。

## 2. 当前已完成的主要功能

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
2. `common.llm_service` 的强类型配置、版本记录与恢复
3. LLM 按 `auto / fixed` 两种策略路由
4. LLM 健康窗口记录
5. LLM 小时级监控聚合
6. Admin Web 的 LLM 配置页与监控页

对应核心文件：

1. `src/services/common-email-config.service.ts`
2. `src/services/common-llm-config.service.ts`
3. `src/services/llm-manager.ts`
4. `src/services/llm-health.service.ts`
5. `src/services/llm-metrics.service.ts`
6. `apps/admin-web/app/routes/llm.tsx`
7. `docs/admin-web-design.md`

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

1. `GET /api/v1/{appId}/public/config`
2. 数据来源是后台维护的 `admin.delivery_config`
3. 返回值为当前 app 配置的 JSON 对象
4. 如果请求同时携带 `X-App-Id` 或 Bearer Token，则必须与 path 中的 `appId` 一致

### 2.13 AINovel 加密 AI 能力接口

当前 `ai_novel` 已经补齐一版正式 AI 能力接口：

1. `POST /api/v1/ai_novel/ai/chat-completions`
2. `POST /api/v1/ai_novel/ai/embeddings`
3. 两条接口都强制要求 Bearer 鉴权与 `app_id = ai_novel`
4. 请求与响应都支持 `AES-256-GCM` JSON envelope
5. 解密成功后的业务成功与业务错误都会加密返回
6. `taskType` 继续作为 scene-first 选模入口，不允许客户端直传底层模型字段

对应核心文件：

1. `src/modules/ai-novel/ai-novel-llm.service.ts`
2. `src/services/aes-gcm-payload-crypto.service.ts`
3. `src/app.module.ts`

### 2.14 AINovel 产品级 AI Routing 配置

当前已经补齐一版 `ai_novel` 专属的产品级模型路由配置：

1. 配置键为 `ai_novel.model_routing`
2. 通过 admin 接口读写、记录 revision、支持 restore
3. 当前运行时固定按 `free` 档位取路由
4. `plus / super_plus` 本期只落配置结构，不接会员权益判定
5. `fact_embed / episode_embed / summary_embed / query_memory_embed` 继续走独立 embedding 逻辑模型
6. `common.llm_service` 默认文档会预填 AINovel 所需逻辑模型骨架与占位 route，管理员补齐后再启用

对应核心文件：

1. `src/services/app-ai-routing-config.service.ts`
2. `src/services/common-llm-config.service.ts`
3. `src/modules/ai-novel/ai-novel-llm-scenes.ts`
4. `src/modules/ai-novel/ai-novel-llm.service.ts`
5. `src/app.module.ts`

## 3. 当前可用接口

当前已经接入到应用入口中的接口包括：

1. `GET /api/health`
2. `POST /api/v1/auth/login`
3. `POST /api/v1/auth/refresh`
4. `POST /api/v1/auth/logout`
5. `POST /api/v1/auth/login/sms-code`
6. `POST /api/v1/auth/login/sms`
7. `POST /api/v1/auth/register/sms-code`
8. `POST /api/v1/auth/register/sms`
9. `POST /api/v1/auth/password/sms-code`
10. `POST /api/v1/auth/password/reset-by-sms`
11. `POST /api/v1/analytics/events/batch`
12. `GET /api/v1/admin/metrics/overview`
13. `GET /api/v1/admin/metrics/pages`
14. `POST /api/v1/files/presign`
15. `POST /api/v1/files/confirm`
16. `POST /api/v1/notifications/send`
17. `GET /api/v1/admin/apps/common/email-service`
18. `PUT /api/v1/admin/apps/common/email-service`
19. `GET /api/v1/admin/apps/common/llm-service`
20. `PUT /api/v1/admin/apps/common/llm-service`
21. `GET /api/v1/admin/apps/common/llm-service/metrics`
22. `GET /api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}`
23. `GET /api/v1/admin/apps/{appId}/i18n-settings`
24. `PUT /api/v1/admin/apps/{appId}/i18n-settings`
25. `GET /api/v1/admin/apps/{appId}/remote-log-pull`
26. `PUT /api/v1/admin/apps/{appId}/remote-log-pull`
27. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks`
28. `POST /api/v1/admin/apps/{appId}/remote-log-pull/tasks`
29. `POST /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}/cancel`
30. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}`
31. `GET /api/v1/admin/apps/{appId}/remote-log-pull/tasks/{taskId}/file`
32. `GET /api/v1/admin/apps/{appId}/ai-routing`
33. `PUT /api/v1/admin/apps/{appId}/ai-routing`
34. `GET /api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}`
35. `POST /api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}/restore`
36. `POST /api/v1/admin/sensitive-operations/request-code`
37. `POST /api/v1/admin/sensitive-operations/verify`
38. `POST /api/v1/admin/apps/{appId}/log-secret/reveal`
39. `GET /api/v1/logs/policy`
40. `GET /api/v1/logs/pull-task`
41. `POST /api/v1/logs/tasks/{taskId}/ack`
42. `POST /api/v1/logs/tasks/{taskId}/fail`
43. `POST /api/v1/logs/upload`
44. `GET /api/v1/{appId}/public/config`
45. `POST /api/v1/ai_novel/ai/chat-completions`
46. `POST /api/v1/ai_novel/ai/embeddings`

这些接口统一在 `src/app.module.ts` 中完成装配和分发。
客户端日志回捞的后端实现说明已经单独整理到 [client-log-remote-pull-backend.md](client-log-remote-pull-backend.md)，这里仅保留目录级摘要。最新实现已经改成“日志文件直接落本地 `.ndjson`，admin 前端本地解析浏览”，不再把日志逐行写入数据库。

补充说明：

- 目前仓库里已经预置了腾讯云短信验证码发送能力和腾讯云图形验证码校验能力，分别位于：
  - `src/services/tencent-sms-verification.service.ts`
  - `src/services/tencent-captcha-verification.service.ts`
- 目前腾讯云短信验证码发送能力已经接入对外 auth 主链路，用于短信登录 / 注册 / 密码重置。
- 后台现已补充一块 `common` 工作区下的短信验证码观测能力，可按 appId 查看最近 7 天短信记录，并通过受控 reveal 查看验证码明文。
- 短信发码接口支持一个仅用于联调和自动化测试的 `test` 布尔字段；当为 `true` 时，服务端会继续生成并缓存验证码，但不会真正调用短信发送服务。
- 腾讯云图形验证码校验能力仍保留在后端，但当前短信主业务默认不启用验证码风控。
- 运行时默认复用 common password 工作区里的：
  - `tencent.secret_id`
  - `tencent.secret_key`
  作为腾讯云主凭证，不再单独维护短信专用的另一套密钥命名。

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
