# Admin API Spec

LightTick 原生 Web 地址复用既有版本化 `admin.delivery_config.settings.growWebUrl`，通过原管理配置写入/历史/回滚路径维护，不新增 env 或密钥字段。值为现有 Zook Web 进程的 `/grow/` 绝对基础地址；online 只允许 HTTPS，local/dev 可使用 loopback HTTP，禁止账号密码、query、fragment 和其他挂载路径。未配置/非法或 App 关闭时公开配置省略可选字段 `grow_web_url`（客户端将缺失/null 视为不可用），原生权威不得从旧来源进度回退取得地址。设置前必须核对目标静态产物 SHA/digest、同源 API 会话和实际部署 namespace；本轮只在 localhost fixture 配置，未配置或发布真实地址。

Grow静态承载（2026-11-03本地候选）：既有Web进程在`GROW_WEB_ENABLED=1`时加载`GROW_WEB_ROOT`（默认static/grow）的固定manifest和白名单资源，仅在/grow命名空间分发页面/资源，运行配置仅含公开产品/版本。关闭时/grow返回503且无产物依赖；开启缺包/摘要不符在监听前失败。它不使用Admin会话，不代理到Python；用户业务沿用LightTick公共API。页面深链新增 `/grow/planning`（AI 规划）和 `/grow/goals`（目标续排），同样分发固定静态包。详见首批和 U2 验证报告。
## AINovel Apple sandbox admission

Server → SMS → Test Account is the sole admission source. Its existing
`GET/POST/PUT/DELETE /api/v1/admin/apps/common/test-accounts[/id]` operations and
versioned `common.test_accounts` configuration are reused. An enabled `ai_novel`
test account authorizes the active Zook user whose stored normalized phone matches
that record. Client-supplied phones/IDs cannot authorize access, and another app's
test records do not qualify. Adding, editing, disabling and deleting records takes
effect on the next request; no copied user-ID list or code reveal is necessary.

RevenueCat Sandbox Testing Access can remain Anybody; Zook checks the SMS registry
before allowing any sandbox membership/credits use. A verified active Apple
entitlement is still required. Legacy `billing.revenueCat.sandboxAppUserIds` is
obsolete, ignored by admission and removed by delivery-config normalization.
Online ios/macos requests automatically select
the isolated sandbox records for allowed accounts unless active production
membership exists. Web/other platforms and ordinary accounts keep production.
Explicit online sandbox headers remain forbidden; sandbox financial history remains isolated.
Google/Alipay sandbox and unknown deployments receive no new permission.


LLM monitoring aggregates (overview and model details) exclude upstream calls
explicitly marked with internal `callPurpose: "content_safety"`. This applies to
totals, rates, timelines and grouped denominators; normal calls to the same model
remain included. Raw observations and route-health evaluation are unchanged.
Migration 067 adds nullable `call_purpose`; deploy it with the backend. Historical
unmarked records remain included because their purpose cannot be inferred safely.

## Content Safety: Jev selection and Redis counters

Existing content-safety endpoints keep their Admin session and
`content_safety.sensitive_words.manage` verification requirements.

- `PUT /api/v1/admin/apps/common/content-safety`: optional boolean
  `llm.useJev` defaults to false. True selects `typesafe/jev-1.13` via
  OpenRouter Decisions API; false preserves the original `llm.modelKey` path.
  Credentials and transparent proxy are resolved from the existing LLM service
  OpenRouter configuration. Provider failures remain fail-open; no automatic retry.
- `GET /api/v1/admin/apps/common/content-safety/stats`: only `dateFrom` and
  `dateTo` (real YYYY-MM-DD dates) are supported. Removed dimension filters
  (`appId`, `source`, `method`, `taskType`) return 400. Dates are clamped to
  the latest 30 Asia/Shanghai days. The response contains `storage: "redis"`,
  `timezone`, `summary`, `daily`, `byCategory`, and `byModel`. Old latency,
  source, app, task and length distributions are removed.
- Summary counts: `total` = nonempty input checks started; `successful` =
  pass + block decisions; `passed`, `blocked`, `failedOpen` are completed
  outcomes. `blockRate` and `failedOpenRate` are fractions of total. Disabled
  checks count as passes. In-flight checks may not yet have a completed outcome.
- Daily rows contain date and counts. Category rows contain key and blocked count;
  model/engine rows contain key, count and outcome counts. Model key is Jev/Qwen,
  another configured logical model, or keyword/aliyun/disabled for non-model checks.
- Each Redis hash expires in 35 days. This is operational counting, not a billing
  ledger: Redis outages can lose increments but cannot alter moderation decisions.
  Writes are bounded to 150ms; reads to 1.5s. Counter write warnings are throttled
  to once per minute per process. Read failures return errors, not fake zero counts.
- No historical backfill or PostgreSQL scan. Only blocked input records are
  persisted; the existing block-record endpoint remains separate. Retention
  deletion runs in the worker, bounded to 1,000 records per tick.

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

Admin Web 的 `/_admin/runtime-config.js` 仅在显式 `APP_ENV=local` 且
`NODE_ENV` 非 production 时提供 `localLoginDefaults`，从本地
`ADMIN_BASIC_AUTH_USERNAME` / `ADMIN_BASIC_AUTH_PASSWORD` 读取，供表单预填，
不自动登录。其他环境或配置不完整时省略该字段，前端账密留空；
不得把本地测试账密硬编码进前端资产。此行为不改变下列认证接口。

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

`ai_novel` 的支付宝价格使用此配置中的 `billing.alipay.prices`，在现有“配置管理”
JSON 编辑器维护。六个必填商品为 `plus_monthly`、`plus_quarterly`、`plus_yearly`、
`pro_monthly`、`pro_quarterly`、`pro_yearly`，值为 1 至 999999999999 的整数，单位为人民币分，与结算金额格式一致。
保存与历史恢复均校验完整目录；非法价格返回 `400 ADMIN_CONFIG_INVALID_JSON`，不创建新版本。
保存或恢复后，同一部署的正式与沙箱商品目录及新订单读取同一份最新价格，无需重启或重新部署。
local/dev/online 的后台配置独立，不跨部署同步价格。
删除 `billing.alipay` 停止新销售；旧订单、幂等重放和支付确认仍使用冻结金额。
这些低敏价格随公开配置返回，App Store/Google Play 的价格仍由商店决定。

### 3.4.1 全局应用升级目录

升级目录位于 `common` 工作区，使用版本化配置键 `common.release_updates`。它可以
同时维护多个产品、平台和商店的最新产物；公开读取时 Zook 只投影请求产品自己的
启用 target。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/release-updates` | 获取全局升级目录与版本历史 |
| `PUT` | `/api/v1/admin/apps/common/release-updates` | 校验并保存全局升级目录 |
| `GET` | `/api/v1/admin/apps/common/release-updates/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/release-updates/revisions/{revision}/restore` | 恢复指定历史版本 |

配置骨架：

```json
{
  "schemaVersion": 1,
  "products": {
    "ai_novel": {
      "targets": [
        {
          "id": "android-direct",
          "platform": "android",
          "channel": "direct",
          "delivery": "download",
          "enabled": true,
          "mandatory": false,
          "latest": {
            "version": "1.5.0",
            "buildNumber": 1040101,
            "fileName": "OrangeWrite-1.5.0+1040101-cn.apk",
            "downloadUrl": "https://cdn.example.com/OrangeWrite.apk",
            "sha256": "<64 hex characters>",
            "messageI18n": {
              "zh-CN": "本次更新优化了章节编辑体验。",
              "en-US": "This update improves the chapter editing experience."
            }
          },
          "minimumSupported": { "version": "1.4.0", "buildNumber": 1040000 },
          "reminder": { "maxCount": 3, "intervalSeconds": 86400 },
          "experiments": []
        },
        {
          "id": "ios-app-store",
          "platform": "ios",
          "channel": "app-store",
          "delivery": "store",
          "enabled": true,
          "mandatory": false,
          "latest": {
            "version": "1.5.0",
            "buildNumber": 1040101,
            "storeUrl": "https://apps.apple.com/app/id123456789"
          },
          "experiments": []
        }
      ]
    }
  }
}
```

`platform + channel` 在同一产品内必须唯一。`download` target 必须有 HTTPS/HTTP
下载地址，`store` target 必须有商店地址；版本号使用 `x.y.z`，build number 为正整数。
`reminder.maxCount` 为同一已安装 build 的可选升级最多提醒次数，`0` 表示不限次数；
`reminder.intervalSeconds` 为两次提醒的最小间隔。客户端可按本机平台 / 渠道选择 target，
再按当前 build number 与 `mandatory` / `minimumSupported` 决定升级提示方式。强制升级仍
必须阻止继续使用，提醒次数不能绕过强制策略。
`latest.messageI18n`（实验包则填写在对应 `artifact.messageI18n`）为可选的更新提示文案，
客户端只在存在当前语言文案时显示；未配置时不显示固定客户端替代文案。

### 3.5 AINovel 模型选择

AINovel 空间 → AI Model 的“Auto 限时免费”表单复用本节配置、保存确认、审计及版本恢复路径。
`config.autoFree` 可选，格式为 `{ "enabled": true, "startsAt": "2026-10-21T00:00:00Z", "endsAt": "2026-11-01T00:00:00Z" }`。
缺省关闭；`enabled` 必须为布尔值，起止时间必须带时区，开始包含、结束不包含，结束必须晚于开始。
两个时间均可留空（立即生效、无限期，直到手动关闭），不内置四周或任何固定截止日期。
日期选择器按浏览器本地时区展示、保存为 UTC。关停后新请求恢复原额度流程；已开始的请求不追溯扣费。
仅 Auto 聊天（包括旧客户端未传 modelSelection）免额度准入和扣减；手动模型和 embedding 不豁免。
客户端从现有模型目录读取同源配置，无需独立促销接口。保存或恢复后下一个请求读取最新配置，无需重启。

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

可选 `catalog` 数组配置模型选择页展示，每项以逻辑 `modelKey` 标识：`label`、`description`、`badge`、`localIcon`、`onlineIcon`、`sortOrder`（整数，升序）、`enabled`（默认 true）。目录显示开关不修改 Auto 的 `chat.default` 权重池；隐藏后也不能通过手动选择绕过。未设置条目时兼容原目录：使用 common 模型名称、本地品牌图标，无在线图标、介绍或标签；费率仍由 `ai_novel.model_point_pricing` 管理，运行上下文预算仍由服务端固定策略决定。

本地图标选择器：`generic / deepseek / kimi / qwen / doubao / minimax / gemini / claude / grok / zai / openai`，不是任意文件路径。在线图标必须是无 URL 用户名/密码的公共 HTTPS 光栅图片地址，空字符串表示不用在线图片。后台「配置 JSON」可编辑完整目录，权重表单修改和版本恢复会保留它。

```json
"catalog": [
  {
    "modelKey": "qwen3.6-plus",
    "label": "Qwen 3.6 Plus",
    "description": "模型介绍",
    "localIcon": "qwen",
    "onlineIcon": "",
    "enabled": true,
    "sortOrder": 10
  }
]
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

### 3.5.1 AINovel 模型点数单价

模型点数单价属于 AINovel 产品配置，不放在 `common.llm_service`。后者继续只负责模型、Provider、上游模型和路由；AINovel 的点数单价单独存放并按逻辑 `modelKey` 版本管理。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/ai_novel/model-point-pricing` | 获取 AINovel 模型点数单价、当前模型目录和版本历史 |
| `PUT` | `/api/v1/admin/apps/ai_novel/model-point-pricing` | 更新 AINovel 模型点数单价 |
| `GET` | `/api/v1/admin/apps/ai_novel/model-point-pricing/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/ai_novel/model-point-pricing/revisions/{revision}/restore` | 恢复指定历史版本 |

版本化配置键：

```text
appId = ai_novel
configKey = ai_novel.model_point_pricing
```

结构为 `schemaVersion + models[]`，每项按逻辑模型键配置缓存输入、未缓存输入、输出的每百万 tokens 点价。Admin 展示倍率（存储点价除以 100），1× 对应 1 点/10,000 tokens。例如：

```json
{
  "config": {
    "schemaVersion": 1,
    "models": [
      {
        "modelKey": "qwen3.8-flash",
        "cachedInputPointsPerMillionTokens": 10,
        "inputPointsPerMillionTokens": 50,
        "outputPointsPerMillionTokens": 150
      }
    ]
  },
  "desc": "按参考价格更新费率"
}
```

默认费率采用产品确认的三倍率表，参考 OpenRouter 精确型号价格与厂商信息，不代表厂商实际账单。`availableModels[].reference` 标明参考来源和可用性。基础输入/输出同时配置或留空；缓存为空按普通输入费率计，显式 0 表示免费。`contextTiers` 保存长上下文阶梯，Admin 可展开编辑且保存不丢失。

Zook 按可信 provider usage（缺失时复用本地估算）及此配置计算精确整数微点并保存价格快照。该配置仅作用于 ai_novel；Admin 与账户结算消费同一结果。余额见 Writing Credits API；每次成功 provider 调用由 Zook 立即结算；额度准入和扣费始终生效；Auto 对话免扣由 Auto 免费活动配置控制。

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
5. 成功提交会记录 audit action `feedback.submit`；如进程配置了 `EMAIL_USERNAME`、`EMAIL_PASSWORD`、`EMAIL_TO_ADDRESS`，系统会直接通过小流量 SMTP 内部提醒发送反馈正文。同一用户按 Asia/Shanghai 自然日最多提醒一次；邮件发送失败不会影响反馈提交响应。

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

### 3.6.2 AINovel 对话记录

后台现在有两个互不复用的 AINovel 入口：`/conversation-records` 是仅 local/dev 开放的 Trace Console，展示 Sessions → Turns → Detail；`/conversation-history` 是历史聊天 item，调用下列历史摘要接口查询已结束 Turn。Trace 数据接口不复用历史摘要接口，线上环境不发起 Trace 请求。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/ai_novel/conversation-records?uid={uid}&page={page}` | 按 UID 查看已结束的 AINovel 对话 Turn（成功或失败） |
| `GET` | `/api/v1/admin/apps/ai_novel/conversation-records?did={did}&page={page}` | 按请求 `X-DID` 查看已结束的 AINovel 对话 Turn（成功或失败） |
| `GET` | `/api/v1/admin/apps/ai_novel/conversation-records?page={page}` | 查看全部用户最新结束的 AINovel 对话 Turn |

规则：

1. `uid` 和 `did` 均为可选，但不能同时携带；`page` 从 `0` 开始。两者都不传时按全部用户查询。
2. 每页最多返回 100 条 API 请求记录；默认页是最新记录，后续页按时间向前翻阅。
3. 每条请求记录保存最后一条用户正文、AI 结果状态和最终 AI 正文；失败结果会保存原始 `errorCode` / `errorMessage`（`errorMessage` 最多 300 字符），并记录 `serverCompacted` 表示本次请求是否使用服务端上下文压缩。记录同时保存 `promptTokens`、`completionTokens`、`totalTokens`、`reasoningTokens` 和 `usageSource`；Provider 未返回权威 usage 时各 token 字段为 `-1`，真实的 0 保持为 0。不会保存 Reasoning 正文、Tool 调用参数或 Provider 原始 payload；local/dev 调试请求会额外保存服务端最终组装的 `systemPrompt` 与可用 `tools` 定义（名称、说明、输入 schema）。如果客户端提供 `messageId`、`sessionId`、`turnId`，响应会原样返回这些关联 ID。
4. `messageId`、`sessionId`、`turnId` 均为可选字段。旧客户端没有这些字段时，服务端返回空缺字段，不会拒绝请求或抛出异常。
5. 同一用户记录达到第 121 条请求记录时，在写入事务中批量裁剪为最新 100 条请求记录；没有时间到期清理。用户注销时删除其对话记录。
6. 读取需要 Admin 认证并写入 `admin.ai_novel_conversation.read` 审计；审计只记录查询类型和页码，不记录 UID、DID 或正文。
7. 只有 `kickoff_turn`、`kickoff_turn_imported_book`、`write_turn`、`history_chapter_qa` 这四类用户可见对话 scene 会写入；compaction、import、chapter summary、snapshot 和 next-chapter brief 等内部 scene 不写入。

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

LLM 与 AINovel 反馈的内部小流量告警不依赖 `common.email_service_regions`。进程同时配置 `EMAIL_USERNAME`、`EMAIL_PASSWORD`、`EMAIL_TO_ADDRESS` 时，告警直接使用与 CI/CD 相同的 `smtp.163.com:465` SMTP 契约发送到 `EMAIL_TO_ADDRESS`；缺少任意一项时告警保持禁用，不影响 API 或 worker 主流程。worker 会对上一个完整自然小时的上游调用做检查：调用数大于 20 且成功率低于 90% 时发送一次邮件；任一 Chat route 进入正式 `open` 熔断时也发送一次。每个小时窗口和每次 route 熔断状态分别去重。

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
| `POST` | `/api/v1/admin/apps/common/llm-service/circuits/reset` | 解除一个 Chat route 的确认或熔断状态 |
| `POST` | `/api/v1/admin/apps/common/llm-service/smoke-test` | 运行全量或指定路由的冒烟测试 |

说明：

- `GET /api/v1/admin/apps/common/llm-service/metrics` 的 `models` 按实际 Provider Model 和调用类型统计，并按当前范围 Token/调用量返回有界结果。
- metrics 默认范围为 `48h`；支持 `24h / 48h / 7d / 30d`，并可使用 `operation=chat|embedding`、`provider`、`providerModel` 组合筛选。短范围按小时、长范围按天返回一条筛选后的 timeline。
- `models` 按实际 `providerModel × operation` 汇总；`providerMetrics` 按 `provider × operation` 汇总；`crossMetrics` 按 Provider × Provider Model × operation 汇总矩阵；`routes` 按路由 Model × Provider × Provider Model × operation 汇总动态路由。
- Provider/Provider Model 筛选不会重算动态路由历史流量分母；routing shares 和配置 revision 检测使用未被下钻筛选缩小的时间 cohort。
- 响应包含 canonical total Token、Prompt、可见输出、Reasoning、未分类差额、Provider/估算/缺失 usage 数、上游调用成功率和 P50/P95。成功率为 `success / (success + failure + timeout)`，按每次上游调用计数，不代表一次用户请求的最终结果；客户端取消单独计数且不进入分母，没有可靠性样本时 `successRate` 省略。Chat 与 Embedding 不生成混合延迟百分位。
- `healthFailures` 返回当前筛选范围内 `health_impact = failure` 的 Top 100 错误组合，按发生次数排序。每项包含路由 Model、Provider、Provider Model、类型、错误码、可选脱敏错误信息、次数和最近发生时间；迁移前记录的 `errorMessage` 可能为空。客户端取消和健康中性事件不进入此列表。
- `runtime` 直接返回路由 selector 使用的基础权重、健康分、动态分、真实选择概率和选择原因；前端不得重新实现公式。`fixed` 为 100/0，`auto` 健康分全零时回退基础权重。实际请求的 DID 与 UID 清洗后都至少包含 3 个字母数字字符时，Provider 使用两者末尾 3 个 base36 字符之和对 1,000 取模，按配置基础权重保持粘性；此时健康分继续用于运营观察，但不移动该身份的 Provider 分桶。任一入参不足 3 位时，该项由路由方法内部随机值替代。
- `config.routeCircuitBreaker.enabled` 默认 `false`。开启后，仅 Chat 流式请求在首个有效 chunk（非空内容、非空 reasoning 或完整 tool call）前失败时才会计数；同一 `routingModelKey × provider × providerModel` 在滚动 24 小时内累计 4 次失败时先进入 `confirming`，不要求不同用户数，同一用户的重复失败也计入。恰好满 24 小时的旧失败不计入；未熔断计数的 Redis TTL 为 24 小时加 1 分钟，并在每次计数写入时刷新，避免稀疏失败提前丢失。确认期间该 route 继续参与 selector，后续同类失败不会重复启动确认；任意一次首个有效 chunk 会清除未正式熔断的失败窗口（不等待完整响应结束）。用户取消、非流式调用、缺少 usageOwner.userId 和首个有效 chunk 后的失败仍不计入。distinctUserCount 仅用于诊断展示，不再作为阈值。既有确认探测、正式熔断和恢复机制不变；不对部署前已过期的失败计数进行回填。
- `config.emailAlerts.llmEnabled` 与 `config.emailAlerts.aiNovelFeedbackEnabled` 默认均为 `true`，分别控制 LLM 运营告警邮件和 AINovel 反馈邮件；关闭只停止邮件，不影响指标、熔断、反馈保存或后台列表。SMTP 凭据仍由运行环境中的 `EMAIL_USERNAME`、`EMAIL_PASSWORD`、`EMAIL_TO_ADDRESS` 提供。
- 进入 `confirming` 后，当前 API 进程立即用与管理台相同的 64-token Chat 冒烟请求对同一 provider/model 进行最多两次后台探测；任一次成功即清除失败计数，只有两次都失败才转为正式 `open` 熔断。正式熔断初始持续 5 分钟。worker 到期后仍用同一冒烟请求探测；连续 2 次成功才恢复。探测失败的下一次间隔依次为 10、20、60、120 分钟，之后保持 120 分钟。关闭配置会立即清除既有熔断状态。`runtime.models[].routes[].circuit` 返回开关、`closed/confirming/open` 状态、失败/用户数、下次探测时间和连续探测成功数，供管理台直接展示。
- `POST /api/v1/admin/apps/common/llm-service/circuits/reset` 使用管理台认证，body 必须为 `{ "modelKey", "provider", "providerModel" }`，且必须匹配当前配置中的 Chat route。它会清除对应 route 的 `confirming` 或 `open` 运行时状态，取消中的后台确认任务会安全退出；响应 `{ "cleared", "route" }`。不匹配当前 Chat route 时返回 `400 ADMIN_LLM_SERVICE_INVALID`。操作会记录审计日志。
- 余额不足采用独立的两次门槛：同一路由滚动 24 小时内累计至少 2 次白名单余额错误进入 confirming，不在首次用户失败时熔断。BAI 精确识别结构化 `insufficient_user_quota`。OpenRouter 只认 HTTP/error.code 402 且 `error.metadata.limit_source = openrouter_credits`，同时要求未携带 reason；`weight_exceeds_budget`、其他未知/异常 reason、裸 402、Key 上限及临时并发预算均走普通失败流程，不按错误文案猜测。credits 来源也可能涉及单次请求超预算，因此这是用户选择的保守白名单，不声称证明账户余额为零，参见 https://github.com/OpenRouterTeam/docs/blob/main/api_reference/limits.mdx 。适配器只保留白名单来源及有界 reason 判别值，不保存原始 metadata。确认探测只要一次返回白名单余额错误，立即转 open，不再用第二次成功抵消。首个有效 chunk 清空两种计数，正式熔断后沿用自动恢复和手动解除。仅隔离当前 route，不暂停整个 Provider，不回填历史错误。日志沿用现有限频和 lease 去重。
- 原始调用观察只保存脱敏维度、数值、稳定错误码及最多 300 字符的脱敏错误信息，不保存 prompt、response、userId、Authorization、Provider payload 或原始错误 body。
- `POST /api/v1/admin/apps/common/llm-service/smoke-test` 不传 body（或传 `{ "mode": "matrix" }`）只执行当前生效配置中 Provider 与 route 都启用的模型路由；未配置、Provider 已禁用或 route 已禁用的组合不会进入执行计划、不会请求上游，也不会出现在响应 `items` 中。响应的 `target` 为 `{ "mode": "matrix" }`。
- 指定路由时传 `{ "mode": "route", "modelKey": "<model>", "provider": "<provider>" }`。服务会验证模型、供应商及两者之间的 route 都存在；无效目标返回 `400 ADMIN_LLM_SERVICE_INVALID`，不会触发上游请求。
- 指定 route 若不存在、供应商已禁用或 route 已禁用，会直接返回 `400 ADMIN_LLM_SERVICE_INVALID`，不会发起上游请求。可执行 route 会实际调用上游；聊天冒烟、熔断确认及恢复探测使用同一份约 15k 输入 token 的上下文，请求输出约 1,000 个字符，最大输出设为 32,768 个 token。输入 token 根据 B.AI 实测估算，实际数量由上游模型的 tokenizer 决定。
- 无论全量还是指定路由，冒烟测试共用 10 秒全局冷却；响应中始终包含本次 `target`、`summary` 与 `items`。
- `config.openRouter.useTransparentProxy=true` 时，发往 `openrouter.ai` 的请求会在发送前动态读取 `common.passwords` 中由 `transparentProxyHmacSecretKey` 指定的 HMAC secret。只有 Key ID 和 secret 都存在时才改走 `transparentProxyBaseUrl`；Secret 缺失时保持直连，错误格式的非空 Secret 会拒绝请求而不会静默降级。
- OpenRouter API Key 仍由 provider `apiKey` 提供并作为 `Authorization: Bearer ...` 透传。透明代理凭据使用 `oa-hmac-v1` 的 `X-Proxy-*` headers，不替代也不保存 OpenRouter API Key。
- Chat route 可选 `openRouter: { provider: { order?, allow_fallbacks?, only?, ignore?, sort?, max_price? } }`，仅允许 `provider="openrouter"` 的 route 使用；其他供应商填写时返回 `ADMIN_LLM_SERVICE_INVALID`。字段使用 OpenRouter 原生名称；供应商列表必须为无重复的合法 slug 数组，`allow_fallbacks` 必须为 boolean，`sort` 为 price/throughput/latency，`max_price.prompt/completion` 为非负 USD / 百万 tokens。未知字段或错误类型拒绝保存。配置通过既有版本保存与运行时读取生效，普通、流式、冒烟和熔断探测均透传；保存的 route 配置优先于调用方 `providerOptions.provider`。未配置时不注入任何默认策略，`{ "provider": {} }` 显式使用 OpenRouter 默认路由；不存在写死的供应商名单，也不改变 Zook 各平台路由权重。管理台仅在 OpenRouter route 显示专属 JSON 输入，RAW JSON 与表单往返保留该字段；切换到其他供应商时清除该专属设置。
- 阿里云百炼 Token Plan 使用独立 Provider key `bailian_token_plan` 和套餐专属 Base URL `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，不得复用 `bailian_coding`。在 PASSWORDS 中配置 `bailian.token_plan_api_key` 后，启动配置迁移会幂等加入该 Chat Provider 及 `tokenplan-*` 文本模型；不会加入 Embedding，也不会修改 `defaultModelKey` 或既有模型流量权重。当前接入范围仅为 OpenAI Chat Completions 与应用自定义 Function Calling，不使用 Anthropic 端点，也不启用依赖 Responses API 的 Token Plan 内置 Harness 工具。
- 火山方舟按量 API 使用独立 Chat Provider key `volcengine`，默认 Base URL 为 `https://ark.cn-beijing.volces.com/api/v3`，不可与 `volcengine_agent_plan` 的 `/api/plan/v3` 套餐通道混用。在 PASSWORDS 保存 `vol.api_key`，Provider 的 `apiKey` 填 `{{zook.ps.vol.api_key}}`；逻辑模型的 `routes[].providerModel` 填已开通的 `ep-*` 接入点，不能把接入点作为逻辑模型 key。支持普通/流式 Chat、应用自定义工具调用、usage 统计及现有取消链路，不注册为 Embedding Provider。通用 `enable_thinking` 自动转换成方舟 `thinking.type`，显式 `thinking` 优先。添加 Password 本身不会自动开通模型或修改路由、默认模型及 AINovel 计价配置，需通过现有模型配置保存流程配置。
- B.AI 使用独立 Chat Provider key `bai` 和 Base URL `https://api.b.ai/v1`。在 PASSWORDS 中配置 `bai.api_key` 后，启动配置迁移会幂等加入 `bai-glm-5.3-flash`；密钥在 `common.llm_service` 中只以 `{{zook.ps.bai.api_key}}` 引用保存。该导入不会改变默认模型、AINovel 选模权重或 embedding 路由。GLM-5.3-Flash 默认使用 `reasoning_effort: "low"`，以为用户可见回复保留输出预算；显式指定的 reasoning effort 优先。`config.bai` 的透明代理使用与 OpenRouter 相同的 `oa-hmac-v1` 和 `X-Proxy-*` 签名信封，但有独立开关、Base URL、Key ID 与 `common.passwords` HMAC key；启用后请求只会发往该受控代理，Secret 缺失时保持直连。

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

### 3.14 Server 会员与支付（只读）

订单列表可传 `environment=PRODUCTION|SANDBOX`，按环境筛选后分页，未知环境不匹配。省略参数保持全环境查询兼容性。后台顶部环境选择同时用于收入概览和订单列表；订单表不重复显示环境列，详情保留环境，会员列表同样按所选环境在服务端分页前过滤，省略 environment 默认 PRODUCTION。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/billing/apps` | 应用注册表与 `integrated` 标记 |
| `GET` | `/api/v1/admin/billing/overview` | 按 UTC 日期、币种和所选维度统计购买数、购买金额和退款金额 |
| `GET` | `/api/v1/admin/billing/memberships` | 按精确用户 ID 查询当前会员快照，包括没有订单的会员 |
| `GET` | `/api/v1/admin/billing/orders` | 按用户、支付记录 ID、服务商交易号、支付服务商、运行平台、分发类型、状态和时间范围分页查询订单 |
| `GET` | `/api/v1/admin/billing/orders/{paymentId}` | 查看订单、当前会员投影、RevenueCat 交易与已持久化 webhook 时间线；必须指定 `appId` |

页面入口为 Server `/billing`，不再提供旧的 AINovel 订单页面或旧管理 API。查询接口可选 `appId`，省略或 `all` 表示全部已接入应用。首期仅接入 AINovel 的读取适配器；其他注册应用返回 `409 ADMIN_BILLING_NOT_INTEGRATED`，未知应用返回 `400`。未来产品必须接入独立适配器才会纳入列表与统计，会员身份仍是 `(appId, userId)`，不共享权益。

收入概览默认正式环境 `PRODUCTION`、本月 UTC，允许显式 `SANDBOX`。可选 `from`（包含）与 `to`（不包含），最多 366 天。`groupBy` 为逗号分隔的不重复维度，支持 `appId,productKey,source,market`，默认 `appId`。`source` 称为支付来源（`app_store/play_store/alipay`）；渠道 `market` 指小米/vivo/App Store/Google Play 等分发市场，market作为独立字段和分组维度，不以source替代。RevenueCat属于支付服务商provider。groupBy=market现在表示真实市场，与source分开。至少选择一个维度，空值、重复或未知维度返回 400。按所选维度服务端聚合；返回 `groupBy`，每行包含 `productKey/market`，未选择维度对应的 `appId/productKey/source/market` 为 null。每行 `date` 为 `YYYY-MM-DD` UTC 日期，日期和币种始终保留，按日期倒序后维度/币种排序；无记录日期不补零行。金额单位是各币种的最小单位；购买按 `purchasedAt`，退款按 `refundedAt` 分别归入发生当天。不同币种不相加，不做汇率转换，不代表商店税费扣除后的到账收入。未知金额、币种、环境或发生时间不计入相应统计，软删除用户财务记录仍参与。同步过的交易按主键去重；不推测尚未保存的退款。

会员列表每页默认 50、最多 100，`cursor` 为上页最后的 `userId`，翻页时保持应用和查询条件一致。可传 `expiry=expired`（到期时间不晚于查询时间）或 `expiry=not_expired`（到期时间晚于查询时间），数据库筛选后再分页；无到期时间的记录仅在未指定此筛选时返回。账号删除不改变到期时间筛选结果。它是所选支付环境的当前快照，会员表按 environment 区分，同一用户可在不同环境拥有不同权益。过期或软删除账号的会员 `active=false`。只读查询不刷新供应商状态、修改会员或发起退款。

Billing 管理接口读取 Zook 持久化 RevenueCat / Alipay 共享订单与验证事件，不读取 Docker stdout；当前要求已登录的 Admin session。现有 Admin session 尚未实现 endpoint 级 `billing:read` RBAC，因此此接口不宣称该权限已生效。每次读取写入 admin audit。订单列表每页最多 100 条，事件时间线也分页。RC 金额来自交易/验证事件证据；不足时返回 `null`，不从商品目录推算。Alipay 在创建时即记录 pending 报价，failed/closed/pending 均可查询，但报价不是收入。Alipay checkoutId/canonical providerTransactionId 是稳定商户订单 ID，providerOrderId 是验证后的支付宝 trade_no；providerTransactionId 搜索兼容两者。createdAt 是不可变创建时间，updatedAt 是最新观察时间；Alipay active/expired 筛选按实际已应用权益到期时间。删除后保留财务行并标记 deletedAt。详情 grant 台账仍返回空数组，不提供编辑/退款/赠送能力。已付款 Alipay 不主动轮询外部退款；后续验证 TRADE_CLOSED 保留在事件历史，但不自动撤销金额/权益。

支付深度排查使用 API / Worker 的 Docker 结构化日志，通过 `appId`、`userId`、`paymentId`、`providerEventId` 和 `requestId` 串联完整流程；日志不作为订单事实来源。
## 橘子写作付费与用量

`GET /api/v1/admin/apps/ai_novel/usage`：必须有 Admin session；Basic Auth 不替代会话；每次读取审计，响应 `Cache-Control: no-store`。只读，不刷新余额或调用支付/模型供应商。

参数：`days=7|30|90`（默认30）；`tier=all|free|plus|pro`（默认all，按消耗时/商品档位）；`environment=production|sandbox`（默认production，仅筛选支付）；可选精确 `userId`。UTC左闭右开，包括今日；窗口还须截至查询时已结束。错误：400非法查询，503不支持报告存储，413超过每类50,000条读取上限（缩短区间或指定用户）；不静默截断全局统计。

返回 `filter`/`reportingSince`/`summary`/`money`/`daily`/`tiers`/`models`/`users`/`simulation`；精确用户查询另附最多100条 `detailEvents` 与 `detailPayments`。金额为分币种整数最小货币单位，points是微点证据换算的展示值（不用于重新扣费）；事件原始两池/平台承担为十进制字符串微点。`users` 是区间扣点前200位样本，不是全体用户分页；页面明确样本范围。余额只代表最后存储快照，含观察时间/刷新边界。消耗目前不按商店Sandbox分离，不计算利润/ROI，厂商金额成本不可统计。

迁移075在现有余额/receipt事务里同时保存不可变扣减/赠送/拦截事件和窗口快照；失败或取消不生成新扣费，成功调用已扣点不回退。完整覆盖、档位稳定、已结束且活跃的七天窗口才参加分布、P50/P95、用尽率和重放。迁移前历史不回填；首个部分窗口、升级/到期变化窗口不伪装成完整数据。重放独立选择档位，只继承时间/用户过滤，使用已观察两池消耗，不预测未满足需求，无应用写接口。
### 3.15 BodyLog 管理接口

所有接口都需要已认证的 Admin 会话。路径固定使用 BodyLog app workspace：`/api/v1/admin/apps/bodylog/...`。读取操作写入 Admin read audit；更改操作需要 Admin session 并写入操作审计。

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/bodylog/operations/summary` | 运营概览 |
| `GET` | `/api/v1/admin/apps/bodylog/operations/metrics?period=7d\|30d\|90d` | 周期指标 |
| `GET` | `/api/v1/admin/apps/bodylog/users?page=&pageSize=&search=` | 用户分页与搜索 |
| `GET` | `/api/v1/admin/apps/bodylog/users/{userId}` | 用户详情 |
| `PUT` | `/api/v1/admin/apps/bodylog/users/{userId}/status` | 设置用户状态，body `{ "status": "active\|banned\|suspended" }` |
| `DELETE` | `/api/v1/admin/apps/bodylog/users/{userId}/data` | 删除部分 BodyLog 用户资料与关联数据 |
| `GET` | `/api/v1/admin/apps/bodylog/reports?page=&pageSize=` | 举报列表 |
| `POST` | `/api/v1/admin/apps/bodylog/reports/{reportId}/resolve` | 处理举报，body `{ "resolution": "..." }` |
| `GET` | `/api/v1/admin/apps/bodylog/blocks?page=&pageSize=` | 屏蔽关系列表 |
| `DELETE` | `/api/v1/admin/apps/bodylog/blocks/{blockerUserId}/{blockedUserId}` | 移除屏蔽关系 |
| `GET` | `/api/v1/admin/apps/bodylog/leaderboards/seasons?page=&pageSize=` | 赛季列表 |
| `GET` | `/api/v1/admin/apps/bodylog/leaderboards/seasons/{seasonLabel}/rankings?page=&pageSize=` | 赛季排名 |
| `DELETE` | `/api/v1/admin/apps/bodylog/leaderboards/seasons/{seasonLabel}/entries/{userId}` | 移除赛季排名条目 |
| `GET` | `/api/v1/admin/apps/bodylog/challenges?page=&pageSize=` | 挑战列表 |
| `GET` | `/api/v1/admin/apps/bodylog/challenges/{challengeId}` | 挑战详情 |
| `GET` | `/api/v1/admin/apps/bodylog/challenges/statistics` | 挑战统计 |
| `GET` | `/api/v1/admin/apps/bodylog/rewards?page=&pageSize=` | 奖励列表 |
| `GET` | `/api/v1/admin/apps/bodylog/rewards/statistics` | 奖励统计 |
| `POST` | `/api/v1/admin/apps/bodylog/rewards/manual-issue` | 为指定成长计划用户发放奖励 |
| `GET` | `/api/v1/admin/apps/bodylog/feature-flags` | 功能开关列表 |
| `PUT` | `/api/v1/admin/apps/bodylog/feature-flags/{key}` | 设置开关，body `{ "enabled": true }` |
| `GET` | `/api/v1/admin/apps/bodylog/feature-flags/analytics` | 功能使用汇总 |
| `GET` | `/api/v1/admin/apps/bodylog/growth/plans?page=&pageSize=` | 成长计划列表 |
| `GET` | `/api/v1/admin/apps/bodylog/growth/plans/{planId}` | 成长计划详情 |
| `GET` | `/api/v1/admin/apps/bodylog/growth/statistics` | 成长计划统计 |
| `GET` | `/api/v1/admin/apps/bodylog/config/notifications` | 获取通知配置 |
| `PUT` | `/api/v1/admin/apps/bodylog/config/notifications` | 更新通知配置 |
| `GET` | `/api/v1/admin/apps/bodylog/config/scoring` | 获取计分配置 |
| `PUT` | `/api/v1/admin/apps/bodylog/config/scoring` | 更新计分配置 |
| `GET` | `/api/v1/admin/apps/bodylog/config/seasons` | 获取赛季配置 |
| `PUT` | `/api/v1/admin/apps/bodylog/config/seasons` | 更新赛季配置 |

分页参数默认为 `page=1`、`pageSize=20`，页大小最大为 100。`period` 只接受 `7d`、`30d`、`90d`。`DELETE users/{userId}/data` 当前清除 BodyLog profile、搭子配对、群组成员、成长计划及其级联任务/奖励、排行榜条目和订阅；它不等同于删除用户账号或清除所有历史社交记录。用户状态目前保存在 BodyLog profile 上；状态本身不替代认证或请求拦截。通知、计分和赛季配置保存在 `zook_config`，当前尚未接入运行时行为。手动关闭赛季暂不提供接口。

## 4. 关联文档

- [admin-web-design.md](admin-web-design.md)
- [current-backend-implementation-overview.md](current-backend-implementation-overview.md)
## LightTick operations

`GET /api/v1/admin/apps/lighttick/operations` requires an authenticated Admin session. It returns LightTick enablement, rollout flags, notification capabilities, AI scene versions/routes/budgets/fallbacks, and privacy-safe aggregate counters. It never returns user identities, task notes, Coach text, Prompt bodies, push Tokens, or provider credentials. The current page is read-only; any future mutation must use the existing RBAC, secondary-sensitive-operation, versioned configuration, and audit flow.

### LightTick 对话规划配置（2026-09-13）
新增场景 planning_clarify（lighttick.planning_clarify.v1），沿用现有场景路由解析与逻辑模型配置，无新增管理接口。模板包版本 1.3.0；week_plan 可用于会话草案。入口由服务器环境变量 LIGHTTICK_CONVERSATIONAL_PLANNING_ENABLED=1 启用，默认关闭，关闭入口保留数据库记录和已排队任务。场景 tiers 仍为路由元数据，不能将其当作新增订阅计费校验。

## BodyLog check-in operations

BodyLog check-in administration uses the shared Admin session cookie. Aggregate endpoints write read audits; user-level endpoints additionally require a sensitive-operation grant.

| Method | Path | Grant | Description |
| --- | --- | --- | --- |
| `GET` | `/api/v1/admin/apps/bodylog/checkin/dashboard` | none | DAU, trend, completion rate, streak buckets, and habit distribution |
| `GET` | `/api/v1/admin/apps/bodylog/checkin/records` | `bodylog.checkin-records.read` | Paginated user-level records; supports `query`, `user_id`, `group_id`, `from`, `to`, `page`, `limit` |
| `GET` | `/api/v1/admin/apps/bodylog/checkin/records/export` | `bodylog.checkin-records.export` | Bounded CSV export of user-level records |
| `GET` | `/api/v1/admin/apps/bodylog/groups` | none | Group health and aggregate activity |
| `GET` | `/api/v1/admin/apps/bodylog/groups/{groupId}/members` | `bodylog.checkin-records.read` | Member contribution ranking |
| `GET` | `/api/v1/admin/apps/bodylog/habit-templates` | none | List active and archived templates |
| `POST` | `/api/v1/admin/apps/bodylog/habit-templates` | `bodylog.habit-templates.write` | Create a multilingual template |
| `PUT` | `/api/v1/admin/apps/bodylog/habit-templates/{id}` | `bodylog.habit-templates.write` | Update a template |
| `DELETE` | `/api/v1/admin/apps/bodylog/habit-templates/{id}` | `bodylog.habit-templates.write` | Soft-archive a template |
| `GET` | `/api/v1/admin/apps/bodylog/habit-templates/usage` | none | Habit usage aggregate |

The Dashboard is backed by `zook_bodylog_group_daily_records` and `zook_bodylog_group_activities`; user IDs are expanded from the daily record JSONB array. Daily, weekly, and monthly completion rates are weighted by each group's recorded member count (completed members divided by eligible group-member slots). Member contribution rows include the BodyLog profile nickname and avatar when a profile exists. The template catalog is stored in `zook_bodylog_habit_templates`. CSV export is capped at 50,000 rows and all user-level access is auditable.

## FrogSleep / Sleep 运营管理（2026-10-11）

Admin Web：选择 FrogSleep 项目空间 →「Sleep 运营」(`/frogsleep`)。复用现有 Ant Design、管理员 Cookie 会话与敏感操作授权；切换项目清理用户记录和待执行操作，丢弃旧响应。

| 方法与路径（前缀 `/api/v1/admin/apps/frogsleep`） | 授权 | 数据/操作 |
|---|---|---|
| `GET /operations` | 管理员 session | 全状态总记录数（非活跃人数）、当前 Buddy/私人同步能力开关；聚合读取审计 |
| `GET /records/{resource}` | session + `frogsleep.records.read` | 用户级元数据，`page` 正整数、`limit`1..100（默认25）、可选 `user_id/status` 精确筛选；数据库分页，读取审计 |
| `POST /notifications/{id}/retry` | session + `frogsleep.notifications.retry` | body `{reason:string}` 必填且≤500字符；只重排原 Push job，不重置预算或设备回执，执行前写入审计 |

resource 白名单：accounts、invitations、relationships、grants、sleep_sessions、focus_sessions、reports、devices、notifications、email_deliveries。每行仅 id/status/user_id/partner_user_id/domain/version/attempts/outcome/updated_at；不返回私人正文、邀请token/code、邮箱或设备pushToken。报告读取来自个人同步当前版本，含删除状态；相同逻辑 ID 的不同账号以 user_id+id 区分。

未登录返回401，仅 Basic Auth 不能调用这些新增会话接口；缺二次授权返回403。非法资源或分页返回400；跨 App/不存在的 job 返回404 `FROGSLEEP_JOB_NOT_FOUND`。重试仅 FAILED/ENQUEUE_FAILED 且retryCount<5；SENT/预算耗尽、设备 processing/outcome_unknown 返回409 `FROGSLEEP_RETRY_NOT_ALLOWED`。已QUEUED重复请求返回当前排队事实、不再次入队。队列失败返回200 `{queued:false,notificationJobId}`，前端提示失败且保留恢复记录；成功后 worker 重新检查静默、撤权、关系、设备归属和能力开关。

邮件provider_accepted不是delivered；未知邮件结果不提供重投入口。现有邀请邮件诊断接口保留原认证/掩码合同，不被新管理路由拦截。页面只读用户关系/方向授权，不替用户授权、解除或拉黑。

## BodyLog campaign review and retention metrics (2026-10-28)

All paths use `/api/v1/admin/apps/bodylog`, require a validated admin Session cookie, and write an audit record. Product Bearer tokens, synthetic user/device headers and Basic-auth credentials alone do not authorize these operations.

- `POST /campaigns/{campaignId}/participations/{userId}/review`, body `{approved:boolean}`: only a `manual_review` participation can transition to `verified`/`rejected`. Stores `session.username` as the reviewer; audit action `bodylog.campaign.review` records the actor, target and decision. Review mutation and audit share the exclusive PostgreSQL transaction. Clients cannot supply this decision via submission/claim. Public participation responses omit the internal reviewer identity.
- `GET /retention/metrics`: aggregate experiment cohorts and unique-user invitation funnel; audit action `bodylog.retention.metrics`. D1/D7 denominator includes only users exposed to the completed-plan continuation screen whose target UTC action day has ended. Experiments remain separate; user identifiers and health details are not returned. Default disabled experiments do not produce treatment cohorts.

Campaign config `bodylog.campaigns` is a JSON array. Each definition needs a unique opaque `id`, `status`, `title`, `subtitle`, ISO `startsAt`/`endsAt`, `rules:string[]`, `reward:{type:"premium",durationDays:1..31,displayText}`, and `platformPolicy:{allowedPlatforms:string[],freeFormAllowed:boolean,oauthPlatforms:[],manualReviewPlatforms:string[]}`. All allowed platforms must be handled by manual review. Empty/unconfigured means no campaign entry. Use the existing authenticated app-config revision workflow; no default campaign is enabled by this change.

Experiment config `bodylog.retention-experiment` defaults off. Example reviewable configuration: `{ "id":"continuation-v1", "enabled":false, "treatmentPercent":10 }`. Named release and analysis owners, opt-in funnel checks, sample size and mature D7 observation must be recorded before enabling or claiming an effect. The treatment emphasizes an existing local habit after the completed plan; the control retains the existing continuation hint and executable habit list.

### BodyLog retention operations additions (2026-10-29)

The existing session-only `GET /api/v1/admin/apps/bodylog/retention/metrics` now also returns:
- `invitationBusiness:{attributed,pending,qualified,rewardedInvitees,rewardedInviters}` from stored attribution facts. Qualified includes rewarded accounts. Reading never reconciles qualification or issues grants.
- `rewards:[{source,type,state,count}]` from the persisted grant ledger. Premium state is active/queued/expired; non-Premium awards use issued. Only aggregate counts leave the server; no user/installation/token identifiers are returned.
- `experiment:{id,enabled,valid,errors,requiredPerVariant,design}` with disabled-by-default validated readiness. Incomplete/invalid configuration returns disabled assignment. Invalid designs are not rendered as a valid plan.

The Admin page `/bodylog/retention` distinguishes optional observed invitation events from authoritative qualification/reward counts, preserves null immature rates, and reads cumulative UTC cohorts. Exposure and action must share both experiment and variant; maturity begins exactly at the following UTC midnight.

`bodylog.retention-experiment` requires the design fields in [the pre-registration plan](bodylog-retention-experiment-plan.md) to enable assignment. No new write/toggle UI is introduced. The example remains disabled and lacks a real owner. Fixed alpha/power sample planning uses a normal approximation and is not an inference result or an automated operational stop monitor.

Late events that predate the currently published experiment revision remain consented observation facts but are not relabeled into the new cohort. Report owners must keep the experiment ID/design stable through follow-up and the late-arrival window; this conservative exclusion cannot recover an overwritten historical assignment.

## AINovel 支付按钮副标题配置

复用现有应用配置及版本记录：AINovel (`ai_novel`) 的
`ai_novel.billing_benefits` 根对象可选增加 `purchaseSubtitle`，值为 locale→文案对象，
例如 `{"purchaseSubtitle":{"zh-CN":"测试副标题 from server","en-US":"Test subtitle from server"}}`。
合并更新时保留已有 plus/pro 权益数组；未配置、null、空对象或全空白时不显示副标题。
文案通过公开套餐接口下发，复用现有 locale 选择和 fallback。默认无副标题，不将测试文案写为生产默认值。

同一根对象可选 `purchaseTitle` locale→文案对象，用于主按钮完整文案。
未配置、null 或解析后为空时，客户端使用当前语言的「立即开通」默认文案；
非空时直接显示服务端值，客户端不拼接价格或分隔符。登录/渠道不可用状态不会被覆盖。主副标题相互独立。

同一配置支持可选展示字段，均沿用现有 locale→文案与语言回退（不新增接口）：

```json
{
  "display": {
    "title": {"zh-CN":"会员","en-US":"Membership"},
    "agreement": {"zh-CN":"已阅读并同意付费服务协议、扣款授权协议"},
    "plusLabel": {"en-US":"Plus"},
    "proLabel": {"en-US":"Pro"}
  },
  "products": {
    "plus_monthly": {
      "displayName": {"zh-CN":"Plus 月度会员","en-US":"Plus monthly membership"},
      "periodLabel": {"zh-CN":"月度","en-US":"Monthly"},
      "badgeText": {"zh-CN":"推荐","en-US":"Recommended"}
    }
  },
  "checkoutDisplay": {
    "title": {"zh-CN":"支付宝扫码付款"},
    "hint": {"zh-CN":"打开支付宝扫一扫"},
    "waiting": {"zh-CN":"等待支付完成"}
  }
}
```

以上仅为配置结构示例，不默认启用推荐标签。只支持已有六个商品的展示覆盖，不改变档位、渠道、权益或价格；更新时保留其他根字段及 plus/pro 权益数组。必要字段删除/null/空白回退客户端翻译；可选副标题和 badgeText 则隐藏。完整商品名直接下发，客户端不拼接。二维码 amountText 不能配置，由订单真实金额生成。配置清空会在下一次目录刷新生效。

创建/幂等重试订单时仅尽力读取二维码文案，不校验无关的 display 页面字段；错误 JSON 或无效二维码文案字段不阻断支付，回退客户端默认值，有效字段继续下发。不要依赖此容错放宽公开目录配置格式。副标题展示为单行，超出省略，运营配置应保持简短。

### Membership environment

Membership projections and credit usage default to production. Admin membership browsing selects environment through `environment=PRODUCTION|SANDBOX`, defaulting to production; this read-only query does not change product entitlement access. Product requests cannot select sandbox online. Financial order lists retain their explicit sandbox/production evidence
filter. Order-detail membership comparison uses that transaction's environment.

会员接口 `GET /api/v1/admin/billing/memberships` 接受 `environment=PRODUCTION|SANDBOX`（默认正式），在到期筛选和分页前选择会员快照；空值或非法值返回400。每条会员返回 `environment: production|sandbox`。顶部环境切换同时切换收入、会员与订单，重置会员筛选和游标，提示当前只显示正式或沙箱会员。不存在将沙箱会员合并进正式列表的行为。

后台“支付记录与事件”默认选中已支付（`status=provider_paid`），首次加载、刷新、切换应用/环境及清空筛选后均默认查询已支付。可取消状态选择查询全部，或选择待付款、已关闭等其他状态。接口省略status的全状态查询语义保持不变。

支付后台术语与取值展示统一：`provider` 为支付服务商，`source/purchaseSource` 为支付来源，`platform` 为运行平台，`distribution` 为分发类型，`environment` 为支付环境。筛选请求保留接口原始枚举，所有tab的表格和详情共用展示映射（App Store / Google Play / 支付宝 / RevenueCat / iOS等）。例如source=play_store和distribution=google_play都显示Google Play，但字段语义不合并。未知值显示未知并保留原值，不默认归类；未采集market时不推断小米/vivo。

Market取值为app_store/google_play/xiaomi/vivo/oppo/huawei/honor/direct；未知为null。勾选市场后null作为“未知渠道”组保留收入，不丢弃金额。App Store/Google Play由确切交易商店证据识别；Alipay由订单构建market归因保留，通用china_android_store或alipay不能推断小米/vivo。迁移077只回填明确的商店或官方直发记录。订单列表和详情返回market并复用统一显示字典。


### 后台 Web server 的公开邀请转发

`apps/admin-web/server.ts` 的三个精确 GET handoff 路径转发到已配置同槽位 API：`/frogsleep/buddy-invitation`、`/frogsleep/sleep-buddy-invite`、`/frogsleep/focus-invite`。这些是公开预览接力，不授予管理权限、不会自动接受邀请；其他方法405。保留 query、手动302跳转，强制 no-store/no-referrer，公开错误隐藏上游和令牌。请求的 absolute-form URL 不得替换 ADMIN_API_PROXY_TARGET 的 origin。现有 `/api/*` 流式代理保持原行为。外层 Nginx 的日志与 Universal/App Links 仍独立验收。


## LightTick learning migration control (2026-11-03 local candidate)

`POST /api/v1/admin/apps/lighttick/learning-migrations/{ownerId}/{preflight|freeze|import|verify|activate|abort}` uses the existing adminSession. Product bearer/Basic alone is insufficient. Target must be an ACTIVE registered member. Preflight is read-only with metadata audit; every mutation requires the existing sensitive-operation grant `lighttick.learning.migrate`, checked again inside the owner transaction, including replay. Bodies: bundle, expected_digest; mutations also base_revision and immutable Idempotency-Key. No private bodies, notes or credentials enter audit payloads.

Manifest format 1/module learning contains explicit verified source instance/account→target user mapping, sealed frozen_at and library/private watermarks, independent original reading/private consent, original collection/lesson identities and all immutable publications, private states/history with draft anchors, original receipt keys/hashes/bodies. Pending receipts require original bodies and become applied or conflict before activation. Missing proof, stale watermarks, nonempty target, digest/relationship/count differences fail without overwrite. The current bounded tool accepts at most 6 MiB/200 lessons/2000 private states/10000 history entries/1000 receipts; larger migrations must wait for a reviewed chunk protocol, never truncate.

Format 1 also accepts optional `routes` (omitted preserves the original format). Each route retains id/revision/published_version/status, the current unpublished brief/document, consecutive immutable versions (version/brief/document/created_at), and lesson_links (number/lesson_id/route_version/first_content_version). Unknown historical publication time is null. Limits: 100 routes and 1000 route versions within the same 6 MiB/200-lesson bundle. Published routes must match the preserved collection and every published lesson mapping; later history cannot rewrite a frozen lesson blueprint. Verification includes route/version/link counts and digests, plus zero native worker jobs in staging. Abort clears these staging relations before lessons. Worker jobs are not imported as executable historical background tasks. Source receipts and pending private commands retain the original migration protocol. See the synthetic fixture `test/support/learning-route-migration-fixture.ts` and PostgreSQL route migration test; these do not authorize actual historical imports.

State: legacy → frozen → imported → verified → zook. Freeze and activate/abort increase epoch; every transition uses authority CAS. Existing old bridge writes recheck this gate inside the owner transaction. **The source frozen flag is an operator attestation, not remote control of the historical service**: operators must actually stop the old writer and seal/reconcile its final export before freeze/activation. Native activation never enables dual write. Abort is supported before activation, removes only staging/imported receipts and preserves old mirrors; after activation (including any new write) return 409 and use reviewed export/compensation, never restore an old database over new writes.

Tool (no DB access, no secret env additions):

```
node --experimental-transform-types scripts/lighttick-learning-migration.ts --bundle /absolute/path/reviewed-synthetic.json
```

Default is offline dry-run: validates the manifest and prints digest/counts, without checking server watermarks. Add `--endpoint https://reviewed-origin --cookie-file /private/admin.cookie` for remote read-only preflight. Cookie file must have mode 600 and contain only adminSession=value. Use the existing admin sensitive verification flow beforehand; the CLI does not bypass it. To execute a reviewed transition, add `--apply --action freeze --expected-digest <reviewed SHA256> --base-revision <current revision> --request-id <original command ID>`. Reuse the exact manifest/base/request ID on lost-response retry. Repeat import/verify/activate with their own reviewed current revision and command identity. No script auto-activates or publishes.

Local synthetic tests: `test/unit/lighttick-learning-migration*.test.ts` and `test/integration/lighttick-native-learning-postgres.test.ts`; the PG test requires a disposable localhost grow_web_u1_* database through LIGHTTICK_TEST_DATABASE_URL. Real historical data, production sessions, deployment and actual source shutdown were not exercised.


### LightTick 学习场景补充

现有 lighttick.ai_routing 增加 learning_route / learning_lesson；仍使用平台逻辑 modelAlias 与 routes，不新增 Provider 密钥或 env。旧版本化文档缺少这两个新增键时使用代码中的场景默认值，管理端明确保存后才写入版本化配置。运行时再将输入、输出和超时收紧到学习场景硬上限；既有 daily_review 的重复声明已删除被覆盖项，保留原本实际生效的值。学习任务的 owner 预算、最多三次租约尝试及取消/重启恢复不另开管理写接口；迁移控制仍走原 sensitive grant。没有在本轮改动真实运营配置或凭证。

### 本人数据与文件清理（本地候选）

LightTick 的专属与平台通用账号删除复用同一领域表清单，包含记录、行动/规划、课程/私人历史、知识/历史及任务回执。PostgreSQL 账号删除先取得现有 LightTick owner gate，再锁 membership；元数据、membership/session 处理及文件删除 outbox 在现有平台事务中提交。全 App 删除也复用同一清单，不遗漏新增领域表。local adoption claim 取消账号/云端映射，防止旧本机身份重新导入已删除数据。

文件物理清理由既有 worker tick 处理 `zook_owner_file_purges`，每批最多 20、45 秒租约、fence、有限退避重试；不新增服务/队列凭据或 env。删除元数据时登记明确的 owner/storage_key，磁盘 IO 不占 owner 事务。仍有平台元数据引用的路径保留；只删除持久根内单个文件，不递归、不扫描其他历史、不跟随父目录逃逸。迟到学习文本上传必须重新核验有效 membership 与元数据，删除后不能确认上传；失败再次登记清理，防止先删后写遗留。平台文件只在 worker 恢复后最终清除，不能宣称事务提交瞬间物理擦除，也不覆盖数据库/文件备份的独立保留策略。

验证只使用专用 localhost 数据库与临时合成文件；本轮未执行真实账号或真实文件清理。监控应观察 worker 聚合清理/重试/保留计数，不把正文、磁盘路径或凭据写入日志。
