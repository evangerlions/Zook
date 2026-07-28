# Admin API Spec

## 1. 文档目标

本文档只描述 Zook 项目内部使用的后台与运营接口。

适用对象：

1. Admin Web 前端开发
2. 后端维护者
3. 运营后台功能联调

不面向外部 App 接入方。对外接入请看：

- [README_API.md](../README_API.md)

## 2. 路径约定

后台接口统一挂在：

```text
/api/v1/admin/...
```

当前实现采用两类资源组织方式：

1. 全局后台能力：
   - `/api/v1/admin/auth/...`
   - `/api/v1/admin/bootstrap`
   - `/api/v1/admin/metrics/...`
   - `/api/v1/admin/sensitive-operations/...`
2. app 工作区能力：
   - `/api/v1/admin/apps/{appId}/...`
   - `common` 工作区固定写作 `/api/v1/admin/apps/common/...`

## 3. 当前已开放接口

### 3.1 Admin 会话与启动

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/auth/login` | 后台登录 |
| `POST` | `/api/v1/admin/auth/logout` | 后台登出 |
| `GET` | `/api/v1/admin/bootstrap` | 加载后台工作区、默认 app 与管理员上下文 |

### 3.2 敏感操作授权

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/sensitive-operations/request-code` | 创建当前会话的敏感操作校验上下文 |
| `POST` | `/api/v1/admin/sensitive-operations/verify` | 校验 6 位二级密码并授予 1 小时权限 |

说明：

1. 当前敏感操作不再发邮箱验证码
2. 当前实现使用固定 6 位二级密码
3. 前端复制密钥、密码值等敏感操作都复用这条链路

### 3.3 App 管理

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/apps` | 创建 app |
| `PUT` | `/api/v1/admin/apps/{appId}/names` | 更新多语言名称 |
| `DELETE` | `/api/v1/admin/apps/{appId}` | 删除 app |
| `POST` | `/api/v1/admin/apps/{appId}/log-secret/reveal` | 获取 app log secret 明文 |

说明：

1. `appId` 当前只允许小写字母、数字和下划线
2. `common` 是保留工作区，不能作为普通 app 删除

### 3.4 App 配置

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/config` | 获取当前配置 |
| `PUT` | `/api/v1/admin/apps/{appId}/config` | 更新配置 |
| `GET` | `/api/v1/admin/apps/{appId}/config/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/{appId}/config/revisions/{revision}/restore` | 恢复指定历史版本 |

当前 app 级配置键：

```text
admin.delivery_config
```

### 3.5 AINovel AI Routing

AINovel model routing 当前由 Zook 代码硬编码，不再从 admin 配置读取。客户端只提交 `scene_key`，用户档位由 Zook 在运行时判定，随后使用硬编码的 `scene_key + tier` 路由表选择 AINovel 业务 route key。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/ai-routing` | 获取硬编码路由表的只读 JSON 快照 |
| `PUT` | `/api/v1/admin/apps/{appId}/ai-routing` | 当前不支持，返回 `REQ_INVALID_BODY` |
| `GET` | `/api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}` | 当前无版本记录，返回 `REQ_INVALID_QUERY` |
| `POST` | `/api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}/restore` | 当前无版本记录，返回 `REQ_INVALID_QUERY` |

当前只支持：

```text
appId = ai_novel
configKey = ai_novel.model_routing
```

### 3.6 AINovel Feedback

AINovel App 内反馈由用户登录态提交，附件写入 Zook 的私有 `appRunData` 文件存储；Admin Web 只通过后台会话代理读取附件，不暴露公开静态 URL。

用户提交接口：

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/ai_novel/feedback` | 提交 AINovel 用户反馈，要求用户登录；`message` trim 后至少 30 字、最多 10,000 字；`attachments` 可选，最多 5 张压缩图片 |

提交限制：

1. 只允许 `image/jpeg`、`image/png`、`image/webp` 附件。
2. 单张附件最大 3 MB，总 payload 最大 10 MB。
3. 图片-only 反馈按空正文处理；少于 30 字的反馈返回 `REQ_INVALID_BODY`。
4. 防滥用限制包括：用户 5 次 / 小时、20 次 / 天，IP fallback 20 次 / 小时，用户每日图片字节上限，以及短时间重复正文检测。
5. 成功提交会记录 audit action `feedback.submit`。

Admin 查看接口：

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/ai_novel/feedback?limit={limit}&status={status}` | 查看 AINovel 反馈列表，默认 100 条，最大 500 条；`status` 可选为 `new`、`doing`、`done` |
| `PATCH` | `/api/v1/admin/apps/ai_novel/feedback/{feedbackId}/status` | 调整反馈处理状态，body 为 `{ "status": "new" \| "doing" \| "done" }` |
| `GET` | `/api/v1/admin/apps/ai_novel/feedback/{feedbackId}/attachments/{attachmentId}` | 通过 Admin 会话读取反馈附件内容，返回 base64 内容和元数据 |

说明：

1. 反馈记录按 `createdAt DESC` 返回。
2. 列表返回用户邮箱、消息原文、附件数量、平台、App 版本与状态；状态含义为 `new` 新反馈、`doing` 处理中、`done` 已完成。
3. 附件文件路径形如 `feedback/ai_novel/{yyyy-mm-dd}/{feedbackId}/{attachmentId}.{ext}`，实际落在 `/app/appRunData` 根下。

### 3.7 App 级 i18n 设置

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/i18n-settings` | 获取 i18n 设置 |
| `PUT` | `/api/v1/admin/apps/{appId}/i18n-settings` | 更新 i18n 设置 |
| `GET` | `/api/v1/admin/apps/{appId}/i18n-settings/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/{appId}/i18n-settings/revisions/{revision}/restore` | 恢复指定历史版本 |

### 3.8 Common 短信验证码观测

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/sms-verifications?appId={appId}` | 查看最近 7 天短信验证码记录，默认返回掩码元数据 |
| `POST` | `/api/v1/admin/apps/common/sms-verifications/{recordId}/reveal` | 通过敏感操作授权后查看验证码明文 |

说明：

1. 该页面属于 `common` 工作区分组下的固定能力。
2. 默认列表只返回掩码手机号、appid、场景、模式、状态、时间等元数据。
3. 验证码明文不会在列表中直接内联展示，只能通过 reveal 接口查看。
4. reveal 需要先走 `/api/v1/admin/sensitive-operations/request-code` + `/verify`。
5. 当前验证码明文只保留最近 7 天；worker 会在每天凌晨 4 点后执行一次硬删除清理。
6. 本期不支持 resend。

### 3.7 Common 邮件服务

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/email-service` | 获取邮件服务配置 |
| `PUT` | `/api/v1/admin/apps/common/email-service` | 更新邮件服务配置 |
| `POST` | `/api/v1/admin/apps/common/email-service/test-send` | 发送测试邮件 |
| `GET` | `/api/v1/admin/apps/common/email-service/events?event={event}&email={email}&limit={limit}` | 查看腾讯云 SES 邮件回调记录 |
| `GET` | `/api/v1/admin/apps/common/email-service/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/email-service/revisions/{revision}/restore` | 恢复指定历史版本 |

邮件服务还提供一个 provider callback 入口：

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/email/tencent/callback?token={token}` | 腾讯云 SES 邮件通知事件回调；无用户/Admin 鉴权，必须在公共密码服务中配置 `tencent.ses_callback_token` 且带匹配 token，合法事件会记录到邮件回调记录中 |

支持的腾讯云 SES 事件：`delivered`、`dropped`、`bounce`、`open`、`click`、`spamreport`、`unsubscribe`、`deferred`。未知事件返回 `REQ_INVALID_BODY`，不会写入回调记录。生产环境必须在 Admin 密码服务中配置 `tencent.ses_callback_token`，并在腾讯云控制台回调地址中使用同一个长随机 token。

### 3.8 Common Passwords

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/passwords` | 获取密码项列表（掩码） |
| `PUT` | `/api/v1/admin/apps/common/passwords` | 全量更新密码项 |
| `PUT` | `/api/v1/admin/apps/common/passwords/item` | 单项新增 / 更新 |
| `DELETE` | `/api/v1/admin/apps/common/passwords/{key}` | 删除密码项 |
| `POST` | `/api/v1/admin/apps/common/passwords/{key}/reveal` | 获取密码项明文 |

### 3.9 Common Auth 风控

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/auth-rate-limits` | 获取验证码相关公共风控阈值 |
| `PUT` | `/api/v1/admin/apps/common/auth-rate-limits` | 更新验证码相关公共风控阈值 |
| `GET` | `/api/v1/admin/apps/common/auth-rate-limits/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/auth-rate-limits/revisions/{revision}/restore` | 恢复指定历史版本 |

说明：
1. 这套配置同时作用于邮箱验证码和短信验证码的登录 / 注册 / 密码找回主链路。
2. `sendCodeWindow*` 控制发码接口的滑动窗口限流，维度为 `appId + account + IP`。
3. `verifyWindow*` 控制验证码提交接口的滑动窗口限流，维度同样为 `appId + account + IP`。
4. `accountDailyLimit` 和 `ipHourlyLimit` 暴露的是自然日 / 自然小时语义阈值；底层 48h / 2h TTL 只是清理策略，不需要前端配置。
5. `verifyWindowLimit` 不能小于 `maxFailedCodeAttempts`，否则单验证码错码阈值会被更外层窗口限流提前遮蔽。

### 3.10 Common GeYan 一键登录

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/getui-gy-service` | 获取 GeYan 一键登录配置（敏感字段脱敏） |
| `PUT` | `/api/v1/admin/apps/common/getui-gy-service` | 更新 GeYan 一键登录配置 |
| `GET` | `/api/v1/admin/apps/common/getui-gy-service/revisions/{revision}` | 获取指定历史版本（敏感字段脱敏） |
| `POST` | `/api/v1/admin/apps/common/getui-gy-service/revisions/{revision}/restore` | 恢复指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/getui-gy-service/apps/{appId}/{field}/reveal` | 二级密码验证后获取 `appKey` / `appSecret` / `masterSecret` 明文 |

### 3.11 Common LLM 服务

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/llm-service` | 获取 LLM 配置 |
| `PUT` | `/api/v1/admin/apps/common/llm-service` | 更新 LLM 配置 |
| `GET` | `/api/v1/admin/apps/common/llm-service/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/llm-service/revisions/{revision}/restore` | 恢复指定历史版本 |
| `GET` | `/api/v1/admin/apps/common/llm-service/metrics` | 获取 LLM 聚合指标 |
| `GET` | `/api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}` | 获取单模型指标 |
| `POST` | `/api/v1/admin/apps/common/llm-service/smoke-test` | 运行冒烟测试 |

说明：

- `GET /api/v1/admin/apps/common/llm-service/metrics` 的 `models` 只统计 common LLM model key，并按当前时间范围内的请求量降序返回，便于优先查看真实流量模型。
- AINovel 的 `ainovel-free-creative`、`ainovel-plus-reasoning`、`ainovel-embedding-default` 等值是业务 scene route key，不是 model key；LLM metrics 会过滤这些业务 key，并把 AINovel 调用归入实际 provider model key（如 `qwen3.6-plus`、`text-embedding-v4`）。

### 3.12 Admin 指标

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/metrics/overview` | 概览指标 |
| `GET` | `/api/v1/admin/metrics/pages` | 页面指标 |

### 3.13 FrogSleep 搭子邀请投递诊断

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/frogsleep/buddy-invitation-deliveries` | 只读查询统一搭子邀请邮件投递 |

需要 Admin 会话。可选 query：`invitation_id`、`status`、`limit`；`status` 仅接受 `queued`、`processing`、`provider_accepted`、`delivered`、`bounced`、`suppressed`、`retryable_failed`、`dead_letter`。响应只包含 `invitation_id`、`recipient_masked`、投递/尝试状态、provider correlation ID、稳定错误码和时间戳，不返回完整邮箱、邀请码、token 或模板参数。每次读取都会写入 admin audit。

## 4. 关联文档

- [admin-web-design.md](admin-web-design.md)
- [current-backend-implementation-overview.md](current-backend-implementation-overview.md)
