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

### 3.5 AINovel 模型选择

AINovel 所有文本场景共用同一组模型权重配置。客户端只提交 `scene_key` 来选择 Prompt/工具工作流，不提交模型键、Provider 或用户档位。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/ai_novel/model-selection` | 获取当前 AINovel 模型选择、可选文本模型和版本历史 |
| `PUT` | `/api/v1/admin/apps/ai_novel/model-selection` | 更新 AINovel 模型选择 |
| `GET` | `/api/v1/admin/apps/ai_novel/model-selection/revisions/{revision}` | 获取指定模型选择历史版本 |
| `POST` | `/api/v1/admin/apps/ai_novel/model-selection/revisions/{revision}/restore` | 恢复指定模型选择历史版本 |

模型选择使用通用版本化 App 配置存储：

```text
appId = ai_novel
configKey = ai_novel.model_selection
```

`PUT model-selection` 请求结构：

```json
{
  "config": {
    "schemaVersion": 1,
    "chat": {
      "default": [
        { "modelKey": "qwen3.6-plus", "weight": 50 },
        { "modelKey": "qwen3.5-flash", "weight": 50 }
      ]
    }
  },
  "desc": "调整 AINovel 默认模型权重"
}
```

`chat.default` 是唯一的 AINovel 文本模型路由。每个 `modelKey` 必须唯一，并引用 `common.llm_service.models` 中存在的 `chat` 模型；每项 `weight` 必须大于 0、最多两位小数，数组权重总和必须等于 100。Zook 复用通用 LLM routing affinity，以请求 `X-Did` 与认证 UID 计算 `[0,1)` routing unit，再按数组顺序累计权重选择模型；缺少合法 DID 或 UID 时沿用通用 affinity 的随机回退。当前不支持场景级覆盖。

整条配置缺失时使用代码默认路由 `[{ "modelKey": "qwen3.6-plus", "weight": 100 }]`；已保存配置损坏或引用无效模型时，运行时返回 `AI_UPSTREAM_CONFIG_INVALID`，不会静默回退。Provider、`providerModel`、密钥和 Provider 路由权重仍只在 `common.llm_service` 中维护。Embedding 不读取这份配置，继续走既有 `text-embedding-v4` 路由。

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

### 3.6.1 AINovel AI 输出举报

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/ai_novel/ai-output-reports?limit={limit}&status={status}&category={category}` | 举报列表；不返回举报原文 |
| `GET` | `/api/v1/admin/apps/ai_novel/ai-output-reports/{reportId}` | 受限读取举报详情并解密举报原文 |
| `PATCH` | `/api/v1/admin/apps/ai_novel/ai-output-reports/{reportId}/status` | 更新 `received/reviewing/resolved/rejected`，可附 resolution 字段 |

说明：

1. 列表、普通日志和 audit payload 不包含举报原文。
2. 详情读取与状态更新都会写入 audit log。
3. 举报原文使用 AINovel app secret 对应的 AES-256-GCM envelope 加密存储。

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
| `POST` | `/api/v1/admin/apps/common/llm-service/smoke-test` | 运行全量或指定路由的冒烟测试 |

说明：

- `GET /api/v1/admin/apps/common/llm-service/metrics` 的 `models` 按实际 Provider Model 和调用类型统计，并按当前范围 Token/调用量返回有界结果。
- metrics 默认范围为 `48h`；支持 `24h / 48h / 7d / 30d`，并可使用 `operation=chat|embedding`、`provider`、`providerModel` 组合筛选。短范围按小时、长范围按天返回一条筛选后的 timeline。
- `models` 按实际 `providerModel × operation` 汇总；`providerMetrics` 按 `provider × operation` 汇总；`crossMetrics` 按 Provider × Provider Model × operation 汇总矩阵；`routes` 按路由 Model × Provider × Provider Model × operation 汇总动态路由。
- Provider/Provider Model 筛选不会重算动态路由历史流量分母；routing shares 和配置 revision 检测使用未被下钻筛选缩小的时间 cohort。
- 响应包含 canonical total Token、Prompt、可见输出、Reasoning、未分类差额、Provider/估算/缺失 usage 数、上游调用成功率和 P50/P95。成功率为 `success / (success + failure + timeout)`，按每次上游调用计数，不代表一次用户请求的最终结果；客户端取消单独计数且不进入分母，没有可靠性样本时 `successRate` 省略。Chat 与 Embedding 不生成混合延迟百分位。
- `healthFailures` 返回当前筛选范围内 `health_impact = failure` 的 Top 100 错误组合，按发生次数排序。每项包含路由 Model、Provider、Provider Model、类型、错误码、可选脱敏错误信息、次数和最近发生时间；迁移前记录的 `errorMessage` 可能为空。客户端取消和健康中性事件不进入此列表。
- `runtime` 直接返回路由 selector 使用的基础权重、健康分、动态分、真实选择概率和选择原因；前端不得重新实现公式。`fixed` 为 100/0，`auto` 健康分全零时回退基础权重。实际请求的 DID 与 UID 清洗后都至少包含 3 个字母数字字符时，Provider 使用两者末尾 3 个 base36 字符之和对 1,000 取模，按配置基础权重保持粘性；此时健康分继续用于运营观察，但不移动该身份的 Provider 分桶。任一入参不足 3 位时，该项由路由方法内部随机值替代。
- 原始调用观察只保存脱敏维度、数值、稳定错误码及最多 300 字符的脱敏错误信息，不保存 prompt、response、userId、Authorization、Provider payload 或原始错误 body。
- `POST /api/v1/admin/apps/common/llm-service/smoke-test` 不传 body（或传 `{ "mode": "matrix" }`）只执行当前生效配置中 Provider 与 route 都启用的模型路由；未配置、Provider 已禁用或 route 已禁用的组合不会进入执行计划、不会请求上游，也不会出现在响应 `items` 中。响应的 `target` 为 `{ "mode": "matrix" }`。
- 指定路由时传 `{ "mode": "route", "modelKey": "<model>", "provider": "<provider>" }`。服务会验证模型、供应商及两者之间的 route 都存在；无效目标返回 `400 ADMIN_LLM_SERVICE_INVALID`，不会触发上游请求。
- 指定 route 若不存在、供应商已禁用或 route 已禁用，会直接返回 `400 ADMIN_LLM_SERVICE_INVALID`，不会发起上游请求。可执行 route 会实际调用上游；聊天冒烟请求使用 64 个输出 token，以便推理模型能在回复前完成必要推理。
- 无论全量还是指定路由，冒烟测试共用 10 秒全局冷却；响应中始终包含本次 `target`、`summary` 与 `items`。
- `config.openRouter.useTransparentProxy=true` 时，发往 `openrouter.ai` 的请求会在发送前动态读取 `common.passwords` 中由 `transparentProxyHmacSecretKey` 指定的 HMAC secret。只有 Key ID 和 secret 都存在时才改走 `transparentProxyBaseUrl`；Secret 缺失时保持直连，错误格式的非空 Secret 会拒绝请求而不会静默降级。
- OpenRouter API Key 仍由 provider `apiKey` 提供并作为 `Authorization: Bearer ...` 透传。透明代理凭据使用 `oa-hmac-v1` 的 `X-Proxy-*` headers，不替代也不保存 OpenRouter API Key。
- 阿里云百炼 Token Plan 使用独立 Provider key `bailian_token_plan` 和套餐专属 Base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，不得复用 `bailian_coding`。在 PASSWORDS 中配置 `bailian.token_plan_api_key` 后，启动配置迁移会幂等加入该 Chat Provider 及 `tokenplan-*` 文本模型；不会加入 Embedding，也不会修改 `defaultModelKey` 或既有模型流量权重。当前接入范围仅为 OpenAI Chat Completions 与应用自定义 Function Calling，不使用 Anthropic 端点，也不启用依赖 Responses API 的 Token Plan 内置 Harness 工具。
- B.AI 使用独立 Chat Provider key `bai` 和 Base URL `https://api.b.ai/v1`。在 PASSWORDS 中配置 `bai.api_key` 后，启动配置迁移会幂等加入 `bai-glm-5.3-flash`；密钥在 `common.llm_service` 中只以 `{{zook.ps.bai.api_key}}` 引用保存。该导入不会改变默认模型、AINovel 选模权重或 embedding 路由。GLM-5.3-Flash 默认使用 `reasoning_effort: "low"`，以为用户可见回复保留输出预算；显式指定的 reasoning effort 优先。B.AI 仅在 `HTTP[S]_PROXY` 或小写等价变量存在时使用该进程的代理配置，其他 provider 不受影响。

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
## LightTick operations

`GET /api/v1/admin/apps/lighttick/operations` requires an authenticated Admin session. It returns LightTick enablement, rollout flags, notification capabilities, AI scene versions/routes/budgets/fallbacks, and privacy-safe aggregate counters. It never returns user identities, task notes, Coach text, Prompt bodies, push Tokens, or provider credentials. The current page is read-only; any future mutation must use the existing RBAC, secondary-sensitive-operation, versioned configuration, and audit flow.
