# API Interface Specification

## 1. 文档目标

本文档只面向外部 App / Web / H5 接入方。

它回答的是：

1. 别的产品如果要接入 Zook 服务，路径应该怎么设计
2. 当前有哪些对外可调用接口
3. Header、鉴权、作用域、响应格式应该怎么遵守

不包含：

1. `admin` 后台接口
2. 内部配置管理接口
3. Zook 运营后台自己的协议细节

内部运营与后台接口请看：

- [docs/admin-api-spec.md](docs/admin-api-spec.md)
- [docs/frogsleep-buddy-operations-runbook.md](docs/frogsleep-buddy-operations-runbook.md)
- [docs/frogsleep-buddy-security-review.md](docs/frogsleep-buddy-security-review.md)

## 2. 核心原则

统一业务前缀：

```text
/api/v1
```

健康检查：

```text
/api/health
```

核心原则只有一句：

```text
平台能力平台化，产品能力产品化。
```

路径决策规则：

1. 如果接口是可复用平台能力，使用 `/api/v1/{commonScope}/...`，例如 `/api/v1/auth/...`、`/api/v1/users/...`、`/api/v1/logs/...`。
2. 如果接口是某个产品独有的业务能力，必须使用 `/api/v1/{productKey}/...`，例如 `/api/v1/ai_novel/...`、`/api/v1/frogsleep/...`。
3. 非标准历史路径只能作为临时兼容 alias，不能作为新客户端 canonical path；文档中必须同时写出 canonical `/api/v1/{productKey}/...` 路径。
4. `productKey` 是 URL namespace；`appId` 是 token、membership、配置与数据隔离使用的运行时作用域键。通常二者相同，但文档模板中路径写 `productKey`，鉴权/数据作用域写 `appId`。

LightTick 固定使用 `productKey = appId = lighttick`。其 canonical 合同位于
`api-contracts/openapi/lighttick/api.yaml`；所有私有业务接口均位于
`/api/v1/lighttick/...`，并要求 Bearer Token、活跃 app membership 与 app scope
一致。客户端应从固定 Zook commit 生成类型，不得把旧 Flutter/Go 项目中的 DTO
视为线上合同。

## 3. 路径分层

| 层级         | Path 模板                   | 说明                           | 示例                   |
| ------------ | --------------------------- | ------------------------------ | ---------------------- |
| 平台公共能力 | `/api/v1/{commonScope}/...` | 登录、用户、文件、通知、统计等 | `/api/v1/auth/login`   |
| 产品业务能力 | `/api/v1/{productKey}/...`  | 某个产品独有的业务接口         | `/api/v1/ppt/projects` |

平台公共模块推荐固定为：

```text
/api/v1/auth/...
/api/v1/users/...
/api/v1/files/...
/api/v1/notifications/...
/api/v1/analytics/...
```

产品路径规则：

1. 使用稳定技术 key，不用营销名
2. 路径统一小写
3. 单词优先使用中划线
4. 如果 Path、Header、Token 同时带产品标识，它们必须一致，否则返回 `403 AUTH_APP_SCOPE_MISMATCH`

## 4. 产品接入模板

假设新增产品 key 为 `my-todo`。

### 4.1 私有业务接口

```text
GET    /api/v1/my-todo/todos
POST   /api/v1/my-todo/todos
GET    /api/v1/my-todo/todos/{todoId}
PATCH  /api/v1/my-todo/todos/{todoId}
DELETE /api/v1/my-todo/todos/{todoId}
```

如果新增产品 key 为 `frogsleep`，canonical 路径应类似：

```text
POST   /api/v1/frogsleep/auth/password/login
GET    /api/v1/frogsleep/me
POST   /api/v1/frogsleep/devices
POST   /api/v1/frogsleep/sleep-buddy/invites
POST   /api/v1/frogsleep/sleep-buddy/shared-sessions
POST   /api/v1/frogsleep/focus-buddy/sessions
POST   /api/v1/frogsleep/focus-buddy/match-profile
```

不要把产品业务 canonical 路径设计成：

```text
/v1/...
/api/v1/sleep-buddy/...
/api/v1/focus-buddy/...
```

LightTick 原生客户端使用以下核心接口族：

```text
GET       /api/v1/lighttick/public/config
POST      /api/v1/lighttick/account/guest-sessions
GET       /api/v1/lighttick/account/session
POST      /api/v1/lighttick/account/upgrade
POST      /api/v1/lighttick/account/reauthentication
GET/PATCH /api/v1/lighttick/profile
POST      /api/v1/lighttick/onboarding
POST      /api/v1/lighttick/onboarding/starter
POST      /api/v1/lighttick/onboarding/first-action
POST      /api/v1/lighttick/onboarding/commitment
GET/POST  /api/v1/lighttick/goals
POST      /api/v1/lighttick/plan-runs
GET        /api/v1/lighttick/today
POST       /api/v1/lighttick/tasks/{taskId}/{command}
POST       /api/v1/lighttick/tasks/{taskId}/variant
GET/POST   /api/v1/lighttick/reviews...
GET/POST   /api/v1/lighttick/change-proposals...
POST/GET   /api/v1/lighttick/sync/{push|pull}
POST/DELETE /api/v1/lighttick/devices...
DELETE     /api/v1/lighttick/me/account
```

`GET /api/v1/lighttick/public/config` 无需登录，即使 LightTick 业务能力默认关闭也可读取。
它只返回固定 `app_id=lighttick`、`local/dev/online` 环境、配置版本、双端最低版本、
游客有效期、公开功能开关及 HTTPS 法律/支持地址。响应由 `admin.delivery_config` 的
显式白名单字段投影生成；密钥、Token、内部地址和其他管理配置不会透传。运行时
`LIGHTTICK_ENABLED` 与后台 `enabled` 必须同时为真，公开功能开关才可能开启。

游客创建接口是唯一无需 Bearer Token 的账户接口，请求必须携带稳定
`Idempotency-Key`，并提交 `device_id` 与至少 32 字符、由设备生成且保存在
Keychain/Keystore 的 `device_secret`。服务端只保存设备密钥与升级证明的哈希，签发 30 天有效的
LightTick-only guest identity、LightTick membership、access/refresh token 和后续升级
证明；同一设备恢复必须再次提供正确设备证明。每个来源 IP 每小时最多发起 5 次，
超限返回 `429 RATE_LIMITED`。游客不能访问其他 Zook 产品，也不能访问 LightTick
review、sync、设备注册、完整规划和删除等敏感能力；刷新凭据后可调用
`GET /api/v1/lighttick/account/session` 恢复账户类型和游客到期时间。

LightTick 推送设备通过 `POST /api/v1/lighttick/devices` 注册或更新，并通过
`DELETE /api/v1/lighttick/devices/{deviceId}` 软删除。注册必须提交匹配的
`ios/apns` 或 `android/fcm`、IANA timezone、locale、app version 和 push token，且受
Bearer token 的 `lighttick` membership 隔离。通知总开关、每日提醒时间、复盘提醒和
安静时段通过 `PATCH /api/v1/lighttick/profile` 的 `notification_preferences` 更新；部分更新会与
现有偏好合并。服务端按 app/user/type/resource/business date 幂等调度，暂停目标会抑制任务压力类通知，
APNs/FCM 的不可恢复 token 只会禁用匹配的 LightTick 设备，429/5xx 仍按队列退避重试。
Provider payload 只含安全展示文案、类型、可选资源 ID 和 `sync=true`，不含任务笔记、Coach 文本或凭据。
Android 的原生 `HttpURLConnection` 可对该 profile 路由发送 `POST` 并携带
`X-HTTP-Method-Override: PATCH`；此兼容头只允许用于该路径，其他路径或方法会返回
`400 REQ_METHOD_OVERRIDE_INVALID`。标准客户端仍直接使用 OpenAPI 中的 `PATCH`。

LightTick Phase 2（以下路径均以 `/api/v1/lighttick` 为前缀）：

目标创建和更新可选携带 `review_cadence: { layers: ["day", "week", "month"] }`。
空数组表示关闭该目标的复盘；省略时默认每周复盘。目标响应会返回实际生效的
复盘层级。`POST /review-runs` 的 `period` 支持 `daily/weekly/monthly`；daily
复盘按单日任务执行事实生成，weekly 和 monthly 复盘保留既有的数据充分性门槛。

| 方法 | 路径 | 请求与响应 `data` |
| --- | --- | --- |
| GET | `/execution-facts` | 可选 `from`（含）/`to`（不含）时间戳；返回 `window/completed_count/average_deviation_minutes/by_lineage/by_slot/consecutive_skips/feedback`，读取同时记录 insight audit |
| POST | `/coach-runs` | `scene=chat`、`goal_id`、`message`（去空白后 1–4000 字符），可选 `thread_id/plan_id/task_id/review_id`；返回 202 AI run，并含 `thread_id/message_id` |
| GET | `/chat/messages` | 必填 `goal_id`，可选 `thread_id`（默认 goal_id）、`limit`（1–200，默认 50）；返回 `{ thread_id, goal_id, items }`，最近消息按时间升序排列 |
| GET | `/chat/intents` | 返回 `{ intents: [{ key, label, message }] }` 快捷话术 |
| GET | `/dna/insights` | 同步并返回 `{ items, next_cursor: null }`；可选 `goal_id` 仅过滤绑定该目标的记录，当前自动生成的洞察未绑定目标 |
| POST | `/dna/insights/{insightId}/feedback` | `action=confirm/deny/correct/dismiss`；correct 必须提供去空白后 2–500 字符 `correction`；返回洞察 |
| POST | `/proposals/from-facts` | `{ goal_id }`；返回 `{ items, suppressed? }`，只生成待确认提案，不直接改计划 |
| GET | `/reviews/{reviewId}/actions` | 返回 `{ review, recommendations, action_state }`，推荐包含稳定 id、证据及可选 proposedTasks |
| POST | `/reviews/{reviewId}/actions` | `action=accept_all/accept_partial/ignore`；partial 必填非空 `recommendation_ids`，ignore 可选 `ignore_reason`（最多 500 字符，省略或空白按未提供处理，非空内容去除首尾空白后保存）；返回 `{ review, action, selected_recommendation_ids, proposed_plan?, recommendations }` |
| GET | `/today/rhythm-suggestion` | 返回 `{ suggestion }` 或 `{ reason }`；reason 为 `no_today_tasks/no_confirmed_insight/no_matching_task` |
| POST | `/today/rhythm-suggestion/feedback` | `{ insight_id, action: accept/dismiss }`；返回 `{ id, rule_id, status, user_feedback?, updated_at }` |

Coach目标隔离：聊天历史按当前账户、`goal_id`和`thread_id`共同筛选后再取limit；同名thread不共享不同目标消息，同一时间按消息ID稳定排序。发送前校验plan/review/task的所有权与目标，另有plan_id时task必须属于该计划。资源不存在或跨账户返回404；同账户目标或任务/计划不匹配返回422，不保存消息或创建run。异步执行时再次校验引用；执行事实仅统计本目标现存任务事件，无法确定归属的历史事件排除。当前上下文未引入跨目标共享容量，不能将单目标统计解释为全人可用预算。

- 以上能力仅限正式 LightTick membership 的 Bearer Token；游客返回 `403 APP_SCOPE_FORBIDDEN`，产品关闭返回 `503 LIGHTTICK_APP_DISABLED`。数据按 app/user 隔离。
- chat 必须携带 8–128 字符 `Idempotency-Key`；消息发出即保存，异步结果通过 `/runs/{runId}` 和消息列表读取，同 key 不同内容返回 `409 LIGHTTICK_IDEMPOTENCY_MISMATCH`。其他 Phase 2 写接口不要求该 header。
- 复盘采纳在同一事务中创建 proposed plan 并保存决策；仍须走计划确认流程才生效。重复决策返回 `409 LIGHTTICK_REVIEW_ACTION_ALREADY_DECIDED`，并发竞争也可能返回 `409 LIGHTTICK_VERSION_CONFLICT`；失败不遗留计划。无可操作推荐返回 `409 LIGHTTICK_REVIEW_NO_ACTIONABLE_RECOMMENDATIONS`。
- 完成事件会中断同 lineage 的连续跳过。已有 pending 提案返回 `suppressed=duplicate_pending`，7 天内拒绝至少 3 次返回 `rejection_dampening`。
- `POST /tasks/{taskId}/complete` 提供 `actual_duration_minutes` 时，任务响应额外包含 `feedback: { rule_id, kind, message, evidence_count, data_range, confident }`，只描述本次事实，不推断稳定偏好。
- DNA hypothesis 不能确认生效，返回 `409 LIGHTTICK_INSIGHT_NOT_ACTIONABLE`；只有用户确认的 rule 获得 allowed_effects。节奏建议使用持久化数值证据：实际耗时大于预计建议上调，小于预计建议下调；零偏差或历史记录缺少数值证据时不输出方向性建议。
- rhythm accept 只记录意向，不修改任务或计划；dismiss 退出建议流。`suggestion` 顶层保留 `insightId/ruleId/evidenceCount` 等 camelCase，内层 task 使用 `estimated_minutes/selected_variant`；复盘响应的 `proposed_plan` 保留存储行 camelCase（如 goalId/periodStart/createdAt），其他字段形状以 OpenAPI 为准。

正式 LightTick 账户使用自己的 Bearer Token 调用 `/account/upgrade`，同时提交原游客
`guest_user_id`、设备绑定的 `guest_upgrade_token`、`device_id` 和稳定 `Idempotency-Key`。
服务端在同一 PostgreSQL 事务中迁移游客资料、目标、计划、任务、事件、操作、设备和同步
位置，并删除游客 membership；正式账户已有偏好优先，重复 operation 只有内容完全一致时
才会去重。响应丢失后使用相同 key 和请求重试会返回原结果，改变请求则返回
`LIGHTTICK_IDEMPOTENCY_MISMATCH`。成功后旧游客 access/refresh session 全部失效。

删除 LightTick 产品账号前，正式密码账户先调用 `/account/reauthentication` 提交
`current_password`，取得 5 分钟有效、仅可使用一次且绑定当前 LightTick membership 的
`reauthentication_token`；随后将该证明与 `confirmation=DELETE` 一并提交到
`DELETE /api/v1/lighttick/me/account`。登出只撤销会话，不删除服务端产品数据。

写命令使用 `Idempotency-Key`；可并发修改资源的命令同时携带
`base_version`。离线同步单批最多 50 个 operation、pull 单页默认 100 条且最多
500 条，准确值和稳定错误码以 OpenAPI 为准。

渐进式启动是 additive 能力：`/onboarding/starter` 只要求模糊愿望和 IANA
timezone，并保证用确定性模板返回一个 5–15 分钟推荐动作和两个备选；它不依赖
LLM 成功。`/onboarding/first-action` 记录实际时长、难度和所选强度，只返回事实
反馈与三日预览，不产生稳定偏好推断。累计两次有效行动（或显式
`deep_planning=true`）后，`/onboarding/commitment` 才允许选择周承诺。

任务变体固定为 `standard | light | minimum`，三者共享 `lineage_id`；切换变体不
新增贡献，终态任务不可切换。目标暂停可携带原因、预计恢复时间、轻任务和通知
策略；恢复模式为 `original_pace | recovery_mode | adjust_goal`。现有
`POST /api/v1/lighttick/onboarding` 的 plan-first 行为继续兼容。

### 4.2 产品公开接口

推荐对外结构：

```text
/api/v1/{productKey}/public/...
/api/v1/{productKey}/callbacks/...
/api/v1/{productKey}/webhooks/...
```

例如：

```text
GET  /api/v1/my-todo/public/config
GET  /api/v1/my-todo/public/bootstrap
POST /api/v1/my-todo/webhooks/stripe
GET  /api/v1/my-todo/callbacks/oauth/google
```

说明：

1. 这是推荐接入规范，不代表当前仓库已经把所有模板接口都实现完
2. 当前仓库已经提供通用的 `GET /api/v1/{productKey}/public/config` 实现
3. 这条接口当前返回的是后台 `admin.delivery_config` 中维护的 app 级公共配置
4. 其他 `/public/*` 模板接口仍需按产品需要补齐

升级提醒使用独立的 `GET /api/v1/{productKey}/public/update`。它从公共
`common.release_updates` 目录按产品 key 投影，只返回当前产品启用的 target；target
用 `platform + channel` 区分平台和商店，`delivery=download` 提供包下载地址，
`delivery=store` 提供商店地址。该接口不负责比较客户端版本、下载、安装或提交商店审核，
这些动作由产品客户端完成。target 的 `reminder.maxCount`（0 表示不限）和
`reminder.intervalSeconds` 提供可选升级提醒的次数与最小间隔；`mandatory` 强制升级不受
提醒次数限制。产物可选提供 `messageI18n`（locale 到文本的映射），客户端只在存在当前
语言文本时显示；未配置时不显示客户端内置的替代更新消息。
AINovel 读取既有 `GET /api/v1/ai_novel/public/config` 时，也会在 `config.releaseUpdate`
中收到同一份 AINovel 专属投影，便于客户端减少一次请求。

当前返回示例：

```json
{
  "appId": "flutter_demo",
  "config": {
    "app": "make_flutter_demo_great_again"
  },
  "updatedAt": "2026-04-04T02:03:31.907Z"
}
```

## 5. 命名与 Method 规则

1. 查询使用 `GET`
2. 创建使用 `POST`
3. 局部更新使用 `PATCH`
4. 删除使用 `DELETE`
5. 查询条件放 query
6. 写操作参数放 JSON body
7. 版本统一使用 `/api/v1`

推荐：

```text
GET    /api/v1/ppt/projects
POST   /api/v1/ppt/projects
PATCH  /api/v1/ppt/projects/{projectId}
POST   /api/v1/ppt/exports/pptx
```

不推荐：

```text
/api/v1/pptProjects
/api/v1/createSlide
/api/v1/magic-super-ppt-maker/projects
```

## 6. Header 约定

推荐 Header：

```http
Authorization: Bearer {token}
X-App-Id: my-todo
X-Platform: ios
X-App-Version: 1.2.0
X-Request-Id: xxxxxx
X-App-Locale: zh-CN
X-App-Country-Code: CN
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
```

说明：

1. `X-App-Id` 可用于日志、埋点、网关或前置校验
2. `X-App-Locale` 推荐传 BCP 47，如 `zh-CN`、`en-US`
3. `X-App-Country-Code` 推荐传 ISO 3166-1 alpha-2 大写值，如 `CN`、`US`
4. `Accept-Language` 可作为 Web / 浏览器环境的兜底语言来源
5. 邮件发送场景的 region 优先级是：
   `X-Country-Code（可信网关） > X-App-Country-Code > Geo`

## 7. 当前已开放的对外接口

当前仓库已经开放的对外接口，主要是平台层与产品薄代理能力：

| 方法   | Path                                       | 说明                                                                                                                                |
| ------ | ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET`  | `/api/health`                              | 健康检查                                                                                                                            |
| `POST` | `/api/v1/auth/login`                       | 密码登录                                                                                                                            |
| `POST` | `/api/v1/auth/login/email-code`            | 发送邮箱登录验证码                                                                                                                  |
| `POST` | `/api/v1/auth/login/email`                 | 使用邮箱验证码登录，必要时自动创建账号                                                                                              |
| `POST` | `/api/v1/auth/login/sms-code`              | 发送短信登录验证码                                                                                                                  |
| `POST` | `/api/v1/auth/login/sms`                   | 使用短信验证码登录，必要时自动创建账号                                                                                              |
| `POST` | `/api/v1/auth/login/one-click`             | 使用运营商一键登录 token 登录，必要时自动创建账号                                                                                   |
| `POST` | `/api/v1/auth/password/email-code`         | 发送密码设置 / 重置邮箱验证码                                                                                                       |
| `POST` | `/api/v1/auth/password/sms-code`           | 发送密码设置 / 重置短信验证码                                                                                                       |
| `POST` | `/api/v1/auth/password/set`                | 已登录的邮箱验证码账号直接设置密码，并签发新会话                                                                                    |
| `POST` | `/api/v1/auth/password/reset`              | 使用邮箱验证码重置密码，并直接签发新会话                                                                                            |
| `POST` | `/api/v1/auth/password/reset-by-sms`       | 使用短信验证码重置密码，并直接签发新会话                                                                                            |
| `POST` | `/api/v1/auth/password/change`             | 已登录用户修改密码，并直接签发新会话                                                                                                |
| `POST` | `/api/v1/auth/register/email-code`         | 发送注册邮箱验证码                                                                                                                  |
| `POST` | `/api/v1/auth/register`                    | 邮箱注册并创建账号                                                                                                                  |
| `POST` | `/api/v1/auth/register/sms-code`           | 发送注册短信验证码                                                                                                                  |
| `POST` | `/api/v1/auth/register/sms`                | 短信注册并创建账号                                                                                                                  |
| `POST` | `/api/v1/auth/qr-logins`                   | 创建扫码登录会话并生成二维码内容                                                                                                    |
| `POST` | `/api/v1/auth/qr-logins/{loginId}/confirm` | 移动端确认扫码登录                                                                                                                  |
| `GET`  | `/api/v1/auth/qr-logins/{loginId}`         | PC/Web 轮询扫码登录结果                                                                                                             |
| `POST` | `/api/v1/auth/refresh`                     | 刷新 Access Token                                                                                                                   |
| `POST` | `/api/v1/auth/logout`                      | 登出                                                                                                                                |
| `GET`  | `/api/v1/users/me`                         | 获取当前 Bearer Token 对应的用户信息                                                                                                |
| `POST` | `/api/v1/users/me/delete`                  | 删除当前产品账号访问关系与当前 app 侧个人数据                                                                                       |
| `POST` | `/api/v1/analytics/events/batch`           | 行为事件上报                                                                                                                        |
| `POST` | `/telemetry/ga4`                           | OrangeWrite 官方 GA4 Measurement Protocol JSON 透明转发                                                                            |
| `POST` | `/telemetry/sentry/api/{projectId}/envelope/` | OrangeWrite 官方 Sentry Envelope 透明转发                                                                                        |
| `POST` | `/api/v1/files/presign`                    | 获取上传预签名                                                                                                                      |
| `POST` | `/api/v1/files/confirm`                    | 确认上传完成                                                                                                                        |
| `GET`  | `/api/v1/logs/policy`                      | 获取客户端日志回捞策略                                                                                                              |
| `GET`  | `/api/v1/logs/pull-task`                   | 拉取客户端日志上传任务                                                                                                              |
| `POST` | `/api/v1/logs/tasks/{taskId}/ack`          | 客户端无日志时回执 `no_data`                                                                                                        |
| `POST` | `/api/v1/logs/upload`                      | 上传 AES-GCM + gzip + NDJSON 客户端日志                                                                                             |
| `POST` | `/api/v1/notifications/send`               | 发送通知任务                                                                                                                        |
| `GET`  | `/api/v1/{productKey}/public/config`       | 获取产品公开配置，当前数据来源于后台维护的 `admin.delivery_config`；`bodylog` 与 `lighttick` 为产品专属实现（见各产品章节）                                                                 |
| `GET`  | `/api/v1/{productKey}/public/update`      | 获取产品自己的平台 / 商店升级目录；匿名可读，`download` 目标提供下载地址，`store` 目标提供商店地址                                                                                         |
| `GET`  | `/api/v1/bodylog/profile`                  | 获取或初始化当前 BodyLog 用户的 app-scoped 公开资料                                                                                 |
| `PUT`  | `/api/v1/bodylog/profile`                  | 更新 BodyLog 昵称和预设头像；昵称会经过内容安全检查                                                                                 |
| `GET` / `POST` | `/api/v1/bodylog/friend-requests` | 查询或发起 BodyLog 好友申请                                                                                                        |
| `GET`  | `/api/v1/bodylog/leaderboards/current/public` | 获取 BodyLog 当前周公开排行榜                                                                                                   |
| `GET` / `POST` | `/api/v1/bodylog/invitations`     | 查询邀请奖励进度或创建邀请                                                                                                         |
| `GET` / `POST` | `/api/v1/bodylog/challenges`      | 查询或创建 BodyLog 好友挑战                                                                                                        |
| `POST` | `/api/v1/ai_novel/ai/chat-completions`     | AINovel chat 能力接口，需要 Bearer 鉴权，按 `scene_key` / `sceneKey` 选择服务端 scene；解密后的 inner body 可用 `stream=true` 切到 SSE |
| `POST` | `/api/v1/ai_novel/ai/embeddings`           | AINovel embeddings 能力接口，需要 Bearer 鉴权，按 `scene_key` / `sceneKey` 选择服务端 scene                                          |
| `POST` | `/api/v1/ai_novel/feedback`                | AINovel 用户反馈提交接口，需要 Bearer 鉴权；正文 trim 后 30–10,000 字，最多 5 张压缩图片；可选内部 SMTP 提醒不会影响提交结果       |
| `GET`  | `/api/v1/ai_novel/statistics`              | 获取当前 AINovel 登录用户的创作统计报告，需要 Bearer 鉴权                                                                           |
| `POST` | `/api/v1/ai_novel/statistics/snapshot`     | 上报当前账号本地写作总量与权威每日字数快照，需要 Bearer 鉴权；服务端校验账号并保留自己的 Token 用量                                  |
| `POST` | `/api/v1/ai_novel/ai-output-reports`      | 提交 AI 消息或章节 revision 举报；按客户端 `submissionId` 幂等，举报原文在服务端加密存储                                              |
| `POST` | `/api/v1/ai_novel/ai-output-reactions`    | 提交最新生成章节的轻量 reaction；当前支持 `chapter_revision + like`                                                                |
| `POST` | `/api/v1/frogsleep/auth/password/login`    | FrogSleep 密码登录，内部固定使用 `appId=frogsleep`                                                                                   |
| `POST` | `/api/v1/frogsleep/auth/token/refresh`     | FrogSleep 刷新 token                                                                                                                 |
| `GET`  | `/api/v1/frogsleep/me`                     | FrogSleep 当前用户信息                                                                                                               |
| `POST` | `/api/v1/frogsleep/devices`                | FrogSleep 设备 / push token 注册                                                                                                     |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites`    | FrogSleep 睡眠搭子邀请                                                                                                               |
| `GET`  | `/api/v1/frogsleep/sleep-buddy/invites/preview` | FrogSleep 睡眠搭子邀请预览 / 登录后恢复，不消费邀请                                                                         |
| `GET`  | `/api/v1/frogsleep/sleep-buddy/guardianship/status` | FrogSleep 共同守护状态快照                                                                                                  |
| `POST` | `/api/v1/frogsleep/sleep-buddy/shared-sessions` | FrogSleep 创建共同守护 session                                                                                              |
| `POST` | `/api/v1/frogsleep/focus-buddy/sessions`   | FrogSleep 专注 session 上报                                                                                                          |
| `POST` | `/api/v1/frogsleep/focus-buddy/match-profile` | FrogSleep 专注搭子匹配资料保存                                                                                                    |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/invite` | FrogSleep 邀请专注搭子候选人                                                                                          |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/dismiss` | FrogSleep 当前用户不再看见该专注匹配候选人                                                                              |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/report` | FrogSleep 当前用户举报该专注匹配候选人，并从后续搜索中排除                                                               |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites`    | FrogSleep 直接邀请专注搭子                                                                                                           |
| `GET`  | `/api/v1/frogsleep/focus-buddy/invites/preview` | FrogSleep 专注搭子邀请预览 / 登录后恢复，不消费邀请                                                                         |
| `GET` / `POST` | `/api/v1/frogsleep/buddy/groups`   | FrogSleep 群组搭子列表 / 创建                                                                                                        |
| `GET` / `PATCH` | `/api/v1/frogsleep/buddy/groups/{groupId}` | FrogSleep 群组搭子详情 / 更新                                                                                              |
| `GET` / `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/invitations` | FrogSleep 群组邀请查询 / 创建                                                                                    |
| `GET`  | `/frogsleep/sleep-buddy-invite`            | FrogSleep 睡眠搭子邀请浏览器中转，302 跳转到 deep link                                                                                |
| `GET`  | `/frogsleep/focus-invite`                  | FrogSleep 专注搭子邀请浏览器中转，302 跳转到 deep link                                                                                |

说明：

1. 当前仓库已经挂出产品级能力：BodyLog 资料、`ai_novel` AI 接口，以及 FrogSleep `/api/v1/frogsleep/*` 业务接口。其余 `novel`、`pomodoro`、`ppt`、`my-todo` 等完整业务路由仍未接入。
2. 新增产品时，应按本规范直接落到 `/api/v1/{productKey}/...`。
3. 扫码登录的对外接入说明见 [docs/public-api-spec.md](docs/public-api-spec.md)。
4. 邮箱验证码登录接口：
   `POST /api/v1/auth/login/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/login/email` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "emailCode": "123456", "clientType": "app" }`
5. 短信验证码登录接口：
   `POST /api/v1/auth/login/sms-code` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "test": false }`
   `POST /api/v1/auth/login/sms` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "smsCode": "123456", "clientType": "app" }`
   `phoneNa` 可省略，默认按 `+86` 处理；服务端会把手机号标准化后再存储和查询。
   `test` 仅对短信发码接口生效；当为 `true` 时，服务端会照常生成并缓存验证码，但不会真正调用短信发送服务，适合联调和自动化测试。
   同一个验证码在有效期内最多允许输错 10 次；达到上限后，该验证码会立即失效并需要重新发码。
   默认风控阈值由 admin `common/auth-rate-limits` 工作区统一维护；当前默认值为：发码窗口 10 分钟 3 次、验证提交窗口 10 分钟 10 次、账号自然日 10 次、IP 自然小时 20 次。
6. 一键登录接口：
   `POST /api/v1/auth/login/one-click` 请求体为 `{ "appId": "app_a", "token": "native-token", "gyuid": "gyuid", "clientType": "app", "operator": "CM", "sdkPlatform": "android" }`。
   服务端使用 `common.getui_gy_service.apps[appId]` 中直接保存的个验 AppID、AppKey、AppSecret、MasterSecret 调用个验服务端取号，不接受客户端直接传手机号；后台读取配置时会对 AppKey、AppSecret、MasterSecret 脱敏，需要二级密码验证后才能查看明文。
   个验取号成功后会复用手机号登录语义：手机号不存在且 app 允许自动加入时创建 `sms-code-only` 账号并签发会话。
7. 密码相关接口：
   `POST /api/v1/auth/password/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/password/sms-code` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "test": false }`
   `POST /api/v1/auth/password/set` 请求体为 `{ "appId": "app_a", "password": "Password1234", "clientType": "app" }`
   `POST /api/v1/auth/password/reset` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "emailCode": "123456", "password": "Password1234", "clientType": "app" }`
   `POST /api/v1/auth/password/reset-by-sms` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "smsCode": "123456", "password": "Password1234", "clientType": "app" }`
   `POST /api/v1/auth/password/change` 请求体为 `{ "appId": "app_a", "currentPassword": "OldPass1234", "newPassword": "NewPass1234", "clientType": "app" }`
   `password` / `newPassword` 当前要求为 8-64 个字符，且同时包含字母和数字。
   `password/set` 只允许当前已登录且仍为 `email-code-only` 的账号调用；如果该账号已经有密码，会返回 `409 AUTH_PASSWORD_ALREADY_SET`，此时应改走 `password/change`。
8. 注册相关接口：
   `POST /api/v1/auth/register/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/register` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "password": "Password1234", "emailCode": "123456", "clientType": "app" }`
   `POST /api/v1/auth/register/sms-code` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "test": false }`
   `POST /api/v1/auth/register/sms` 请求体为 `{ "appId": "app_a", "phone": "18710100985", "phoneNa": "+86", "smsCode": "123456", "clientType": "app" }`
9. 邮箱不存在时，`POST /api/v1/auth/login/email` 在验证码校验成功后会自动创建账号并完成登录；手机号不存在时，`POST /api/v1/auth/login/sms` 也会按同样规则自动创建账号并登录。
10. `POST /api/v1/auth/password/email-code` 和 `POST /api/v1/auth/password/sms-code` 为了避免账号探测，在目标账号不存在、账号被封或当前 app 不允许该账号走密码找回时，也会返回 `{ accepted: true }`；真正的校验在 `reset` / `reset-by-sms` 阶段完成。
11. 账号删除接口：
    `POST /api/v1/users/me/delete` 需要 Bearer 鉴权，请求体为 `{ "appId": "app_a", "confirmation": "DELETE" }`。
    删除语义是 app-scoped：服务端会把当前 `zook_app_users(appId,userId)` 标记为 `DELETED`，撤销该 app 下当前用户所有 session，并清理该 app 下可归属到该用户的运行数据；不会删除或匿名化全局 `zook_users` 身份记录，audit logs 会保留。
    删除后同一 Zook 身份不能被自动重新加入当前 app，后续登录会返回 `403 APP_MEMBER_DELETED`。
12. 当前短信验证码能力已经接入腾讯云短信发送；腾讯云图形验证码能力已在服务端预置，但目前短信主业务默认不启用验证码风控。
13. 本轮不做账号合并和手机号绑定。如果某个手机号已经属于另一条用户记录，短信注册会直接拒绝，不会自动合并或转移绑定。
14. `POST /api/v1/auth/login`、`POST /api/v1/auth/login/email`、`POST /api/v1/auth/login/sms`、`POST /api/v1/auth/password/reset`、`POST /api/v1/auth/password/reset-by-sms`、`POST /api/v1/auth/password/change`、`POST /api/v1/auth/register`、`POST /api/v1/auth/register/sms`、`POST /api/v1/auth/refresh` 以及扫码登录轮询成功时，响应体里都会直接带 `user`，客户端不需要为了首屏再补打一枪用户信息。
15. `GET /api/v1/users/me` 用于 App 重启、刷新页面或恢复登录态时重新拉取当前用户信息；它会按 Bearer Token 的 `app_id` 校验作用域，如果同时传 `X-App-Id`，必须与 token 一致。
16. `clientType = "web"` 时，服务端会通过 `Set-Cookie` 写入 refresh token。当前 API 默认使用跨站友好的 `SameSite=None; Secure`，前端请求必须带 `credentials: "include"`；如果是同站部署，也可以通过 `AUTH_REFRESH_COOKIE_SAMESITE=Lax` 切回更保守的策略。
17. 当前 `user` 结构为：

```json
{
  "id": "user_alice",
  "name": "alice",
  "email": "alice@example.com",
  "phone": null,
  "avatarUrl": null,
  "hasPassword": true
}
```

16. 目前 `name` 会根据现有账号信息推导，优先取邮箱前缀，其次取手机号；`avatarUrl` 预留为 `null`，后续可平滑扩展。
17. `hasPassword` 用于标识当前账号是否已经设置过密码：

- `false`：当前仍是 `email-code-only` 或 `sms-code-only` 账号，前端应展示“设置密码”
- `true`：前端应展示“修改密码”

当 `hasPassword = false` 的账号尝试 `POST /api/v1/auth/login` 密码登录时，服务端返回 `401 AUTH_PASSWORD_NOT_SET`，`message` 会按请求语言本地化，提示用户先使用验证码登录并在账号设置中设置密码。
如果账号不存在，密码登录返回 `401 AUTH_ACCOUNT_NOT_FOUND`，`message` 会按请求语言本地化提示账号不存在；如果账号存在但密码错误，仍返回 `401 AUTH_INVALID_CREDENTIAL`。

18. `POST /api/v1/auth/logout` 当 `scope = “all”` 时，会立即撤销当前 app 下该用户的全部 refresh token，并使现有 access token 立刻失效；客户端收到成功响应后应直接清理本地旧 token。
19. `ai_novel` 的两个 AI 接口都要求 `Authorization: Bearer <access_token>` 与 `X-App-Id: ai_novel`；AINovel 还会发送持久设备标识 `X-Did`，Zook 将其与认证 UID 组合用于稳定的 Provider 分桶。DID 或 UID 任一清洗后不足 3 个字母数字字符时，该项使用内部随机值替代。未登录返回 `401 AUTH_BEARER_REQUIRED`，`app_id` 或 `X-App-Id` 不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`。
20. `ai_novel` 的两个 AI 接口都是 scene-first 协议：客户端必须传 `scene_key` 或 `sceneKey`；不得直传 `model`、`providerModel`、`modelKey` 这类底层选模字段。`scene_key` 只选择 Prompt、工具与响应工作流；所有文本场景共用服务端版本化的 `ai_novel.model_selection.chat.default` 加权数组，并复用通用 LLM 的 `X-Did + auth UID` routing affinity。Provider 与上游模型路由仍统一归 `common.llm_service`。
21. `POST /api/v1/ai_novel/ai/chat-completions` 至少需要 `scene_key + messages`；`chat_compaction` 是无工具、可流式取消的 Pi context compaction 摘要 scene，不作为用户可见 AI 回复使用；`POST /api/v1/ai_novel/ai/embeddings` 至少需要 `scene_key + input`。
22. `ai_novel` 的两个 AI 接口使用应用层 AES-256-GCM JSON 加密 envelope；只有鉴权失败、`appId` 不匹配、外层 envelope 非法、未知 `keyId`、算法不支持、或请求解密失败时才返回明文错误。
23. 一旦 AI 请求解密成功，业务成功结果与业务错误都会加密返回；客户端需要先解密，再读取其中的标准 `code + message + data + requestId` 响应包。
24. `POST /api/v1/ai_novel/ai/chat-completions` 在 `stream=true` 时返回 `text/event-stream`；每个 SSE `data:` 事件仍是加密 outer envelope。解密后的正常事件包括 `reasoning_delta`、`content_delta`、`tool_call_delta`、`tool_call`、`usage`、`done`。`tool_call_delta` 仅是 provider/tool 参数进度，步骤 UI、重试和本地化仍由 AINovel 负责。assistant 历史可携带 `reasoningContent`，Zook 在兼容 provider 请求中转为 `reasoning_content`；`completionTokens` 已包含 reasoning 子集，客户端不得重复相加。`usage.contextWindowTokens` 是 Zook 固定下发的 256,000-token Agent operating budget，不按模型或 provider route 变化；`contextUsedRatio` 按该预算计算。所有 Agent scene 均只由 Zook 输出单轮模型结果，AINovel Pi Agent 执行工具并决定后续回合。Pi-v1 的 raw context 不进入 provider prompt；Zook 仅按加密 `suppliedTools` 过滤 schema。interactive Write Agent 在携带批准 catalog 和 `read` capability 时获得受限虚拟 `read(path)`：AINovel 在每个 app 生命周期首次通过加密 `agent-skills/query` / `agent-skills/fetch` 更新并固定本地 snapshot，Skill 与 references 的读取不在 tool round 内访问网络。旧客户端、其他 Agent scene 和 Generation Job 均不提供该 capability。Zook 不修复工具名大小写、不重写 tool payload，也不执行客户端 Skill。断开 SSE 会取消上游流；之后不保证有 `usage` 或 `done`，客户端必须持久化已收到的增量为 interrupted 状态。`AI_CONTEXT_TOO_LONG`、rate limit、timeout、provider 格式和配置错误各保留稳定业务码。
24a. `POST /api/v1/ai_novel/agent-skills/query` 与 `POST /api/v1/ai_novel/agent-skills/fetch` 都使用相同 AES-256-GCM envelope 与 `ai_novel` 鉴权。query 的解密 response 只含 manifest（Skill name、description、虚拟 location、version、hash）；fetch 必须携带该 manifest 的 `skillSetVersion` 和非空去重 Skill name 列表，才返回指定的 text-only Skill package。客户端须在 app 生命周期首次懒加载时原子固定一个本地 snapshot；`AINOVEL_SKILL_SET_STALE` 表示必须重新 query，禁止拼接不同 revision 的 package。
25. **仅 local 联调环境**允许在 AI 加密 envelope 外层额外挂一个明文字段用于第 8 人员排查：客户端请求体可带 `localDebugRequestPlaintext`，服务端 chat-completion 成功响应可带 `localDebugResponseText`。这两个字段都只是调试镜像，前后端业务逻辑都不得依赖它们。
26. **仅 local / dev 环境**开放 AINovel Trace Console：`POST /api/v1/ai_novel/debug/traces` 接收稳定 `sessionId`（详情页称为 `cid`）、结构化 trace capture 与最小 metadata（`kind`、`status`、可选 `bookId` / `chapterId` / `title`），并由鉴权用户自动记录 `uid`；按 `kind + sessionId` 追加保存。`GET /api/v1/ai_novel/debug/traces/data` 支持按 `uid`、`cid`、kind、status、book、chapter 和关键词过滤，默认按最近活动返回 sessions；`GET /api/v1/ai_novel/debug/traces/{sessionId}?kind=...` 默认渲染 Sessions → Turns → request details 的 HTML，使用 `Accept: application/json` 时返回同一会话的结构化 session、manifest 列表和 normalized view model，供 Admin `/conversation-records` 直接显示；turn 按一次用户消息及其 Pi/tool loop 聚合，并显示相邻 turn 的上下文 diff、彩色消息、可折叠历史请求和原始 JSON。AINovel 不生成或上传 HTML，发送使用 5 秒上限的 best-effort 异步任务，不阻塞产品完成。写入接口要求 `Authorization: Bearer <access_token>` 与 `X-App-Id: ai_novel`；shared dev 的全部 GET 复用 Admin 认证，本机 local/test 可直接查看。所有这些路由在 online / production 或非 local/dev host 都返回 `404`：代码可随 Zook 发布，但线上既不接收 trace、也不写文件、更不暴露 Console。
27. `POST /api/v1/ai_novel/ai-output-reports` 支持 `chat_message` 与 `chapter_revision`；举报接收以 `submissionId`、target、分类、scene 和非空原文为最小必需信息，`messageId` / `sessionId` / 章节定位等相关元数据只用于尽力关联，缺失时不拒绝举报。`contentHash` 由服务端按实际收到的原文统一计算；章节 `chapterId` 为零基，第一章可传 `0`。合规举报入口不做会拒绝有效举报的同步频率限制；滥用识别和处置应在受理后异步完成。服务端只在受限 Admin detail 接口解密举报原文，普通列表、日志和 audit payload 不包含原文。`POST /api/v1/ai_novel/ai-output-reactions` 当前只接受章节 revision 的 `like`，并使用相同的零基 `chapterId`。
28. 客户端日志回捞现在使用轻量 claim 模式：先调 `GET /api/v1/logs/policy`，再用 `X-Did` 调 `GET /api/v1/logs/pull-task` 领取任务；有日志时用 `POST /api/v1/logs/upload` 并带 `X-Log-Claim-Token` 上传，无日志时用 `POST /api/v1/logs/tasks/{taskId}/ack` 回执 `no_data`。后端实现细节见 [docs/client-log-remote-pull-backend.md](docs/client-log-remote-pull-backend.md)。
29. 服务端不再把上传日志逐行落库；上传成功后会把解密解压后的 `.ndjson` 文件直接存到本地，并在 admin 的 `Remote Log Pull` 页面里提供”查看日志 / 下载原始文件”。日志浏览解析发生在前端，不做服务端分页。

30. AINovel chat completion 的解密 inner body 可选传 `agentProtocol = "pi-v1"`。该协议在保持同一 endpoint、加密 envelope 与 SSE event shape 的前提下启用按需上下文：Zook 不把 raw `context` 串行化进 system prompt 或 user message；AINovel Pi Agent 通过真实 read tool 获取 Meta、Contract、MainLine、Draft 与其他当前状态。未传字段的旧客户端保持旧 context 组装；未知值返回 `400 REQ_INVALID_BODY`。
30. 如果客户端在本地重试超过阈值后仍然上传失败，可以调用 `POST /api/v1/logs/tasks/{taskId}/fail` 主动把任务标记为 `FAILED`，并附带失败原因，方便 admin 排障。
31. admin 当前还提供 `Remote Log Pull` 的独立日志详情页：任务列表只展示摘要，点”查看日志”后进入详情页查看任务摘要、文件摘要和本地解析后的日志表格。
32. `/telemetry/ga4` 与 `/telemetry/sentry/api/{projectId}/envelope/` 是
    provider wire-format 透明网关，不使用 `/api/v1` 业务响应 envelope，也不要求
    Bearer token。服务端只接受固定 GA4 destination 与固定 Sentry
    project/public key/origin，不接受客户端指定上游。请求体、GA4 secret、Sentry
    public key 均不写日志；详细配置与边界见
    `deploy_configs/*.env.example` 和 `src/modules/telemetry/`。Sentry event ID
    响应与限流 header 会透传；`X-Forwarded-For` 只在直接连接来自 loopback 或
    `ZOOK_TRUSTED_PROXY_IPS` 明确列出的代理时参与每 IP 限流。

## 8. BodyLog API

BodyLog 固定使用 `appId = "bodylog"`。登录和注册复用平台邮箱验证码接口：

```text
POST /api/v1/auth/login/email-code
POST /api/v1/auth/login/email
```

请求体中的 `appId` 必须为 `bodylog`。所有 `/api/v1/bodylog/*` 接口必须携带 BodyLog Bearer token；如传
`X-App-Id`，其值也必须为 `bodylog`。

| 方法 | Path | 请求体 | 说明 |
| --- | --- | --- | --- |
| `GET` | `/api/v1/bodylog/profile` | 无 | 首次读取会创建未完成资料 |
| `PUT` | `/api/v1/bodylog/profile` | `{ "nickname": "薄荷同行者", "avatarKey": "mint_runner" }` | 完成或更新资料 |
| `GET` / `POST` | `/api/v1/bodylog/friend-requests` | POST: `{ "targetUserId": "user_456" }` | 查询待处理申请或发起好友申请 |
| `POST` | `/api/v1/bodylog/friend-requests/{requestId}/{accept\|reject}` | 无 | 接受或拒绝收到的好友申请 |
| `GET` / `DELETE` | `/api/v1/bodylog/friends[/{friendUserId}]` | 无 | 查询或删除好友 |
| `GET` / `POST` / `DELETE` | `/api/v1/bodylog/blocks[/{targetUserId}]` | POST: `{ "targetUserId": "user_456" }` | 查询、拉黑或解除拉黑 |
| `POST` | `/api/v1/bodylog/reports` | `{ "targetUserId": "user_456", "reason": "offensive_profile" }` | 使用固定原因举报用户 |
| `GET` | `/api/v1/bodylog/leaderboards/current/snapshot` | Header `X-Time-Zone` | 当前用户已冻结的参赛习惯、时区和 joined 状态；未参赛 habits 为空 |
| `POST` | `/api/v1/bodylog/leaderboards/current/join` | 当前周、时区与 1–5 个习惯快照 | 加入当前周排行榜 |
| `POST` | `/api/v1/bodylog/leaderboards/current/aggregate` | 周标识、日期与完成 habit id | 上报由服务端计分的每日聚合 |
| `DELETE` | `/api/v1/bodylog/leaderboards/current/membership` | `{ "timezone": "Asia/Shanghai" }` | 退出当前周排行榜 |
| `GET` | `/api/v1/bodylog/leaderboards/current/{public\|friends}` | Header `X-Time-Zone` | 获取公开榜或好友榜 |
| `GET` / `POST` | `/api/v1/bodylog/invitations` | POST: `{ "installId": "...", "intent"?: "general\|buddy\|group" }` | 查询邀请奖励状态或创建 14 天邀请；`intent` 缺省 `general`，决定分享链接路径 `/i/`、`/b/`、`/g/` |
| `POST` | `/api/v1/bodylog/invitations/attribute` | `{ "token": "...", "installId": "..." }` | 绑定邀请归因，禁止自己邀请和同设备归因 |
| `POST` | `/api/v1/bodylog/invitations/progress` | 当天日期与时区 | 记录邀请资格进度 |
| `GET` / `POST` | `/api/v1/bodylog/challenges` | POST: 主题、1–7 个好友和时区 | 查询或创建挑战 |
| `GET` | `/api/v1/bodylog/challenges/{challengeId}` | 无 | 获取可见挑战详情 |
| `POST` | `/api/v1/bodylog/challenges/{challengeId}/respond` | `{ "action": "accept" }` | 接受或拒绝挑战 |
| `POST` | `/api/v1/bodylog/challenges/{challengeId}/progress` | 当天日期、完成状态和时区 | 更新挑战进度 |
| `GET` | `/api/v1/bodylog/public/config` | 无（匿名） | BodyLog 专属公开配置；响应为功能开关映射（见下文），不走通用 `admin.delivery_config` 模板 |
| `POST` | `/api/v1/bodylog/buddies` | `{ "partnerUserId": "...", "sharedHabitIds": [...] }` | 发起搭子配对 |
| `GET` | `/api/v1/bodylog/buddies` | 无 | 查询我的搭子列表 |
| `GET` | `/api/v1/bodylog/buddies/{pairId}` | 无 | 搭子详情（连续天数、层级、活动） |
| `POST` | `/api/v1/bodylog/buddies/{pairId}/accept` | 无 | 接受配对邀请 |
| `POST` | `/api/v1/bodylog/buddies/{pairId}/dissolve` | 无 | 解除搭子关系 |
| `POST` | `/api/v1/bodylog/buddies/encourage` | `{ "pairId": "...", "emoji": "...", "isSameAction"?, "targetHabitId"? }` | 发送鼓励动作 |
| `POST` | `/api/v1/bodylog/buddies/checkin` | `{ "habitId": "...", "count"?: 1, "eventId"?: "local-log-id", "occurredAt"?: "ISO timestamp" }` | 记录搭子打卡同步 |
| `POST` | `/api/v1/bodylog/groups` | `{ "name": "...", "icon"?, "sharedHabitIds": [...], "completionRule"?: "all\|majority", "maxMembers"? }` | 创建打卡小组 |
| `GET` | `/api/v1/bodylog/groups` | 无 | 查询我所在的小组 |
| `GET` | `/api/v1/bodylog/groups/{groupId}` | 无 | 小组详情与成员状态；返回含 `isOwner`/`isAdmin` 权限标记，`invitationToken` 仅组长/管理员可见 |
| `POST` | `/api/v1/bodylog/groups/{groupId}/invite` | `{ "userId": "..." }` | 邀请成员加入小组 |
| `POST` | `/api/v1/bodylog/groups/{groupId}/accept` | `{ "token": "..." }` | 接受小组邀请 |
| `POST` | `/api/v1/bodylog/groups/{groupId}/leave` | 无 | 退出小组 |
| `POST` | `/api/v1/bodylog/groups/{groupId}/checkin` | `{ "habitId": "...", "count"? }` | 小组打卡 |
| `GET` | `/api/v1/bodylog/groups/{groupId}/leaderboard` | 无 | 小组排行榜（成员周统计与排名） |
| `POST` | `/api/v1/bodylog/groups/{groupId}/members/remove` | `{ "userId": "..." }` | 组长/管理员移除成员（组长可移除任意 member/admin，admin 仅可移除 member，不能移除 leader） |
| `POST` | `/api/v1/bodylog/groups/{groupId}/transfer` | `{ "userId": "..." }` | 组长转让（仅现任 leader；原组长降为 admin，新组长保持 active） |
| `POST` | `/api/v1/bodylog/seven-day-plan/enroll` | `{ "timeZone"?: "Asia/Shanghai" }` | 报名 7 天成长计划；新计划每天一条本地目标任务（需 growth 功能开关） |
| `GET` | `/api/v1/bodylog/subscription/status` | 无 | 云端有效权益 `{tier, expiresAt, autoRenew}`，无有效权益返回 free/null/false |
| `POST` | `/api/v1/bodylog/subscription/purchases` | iOS `{platform:"ios", productId, signedTransaction}`；Android `{platform:"android", productId, purchaseToken}` | 服务端验签并同步云端权益；同一商店交易不能绑定到其他 BodyLog 账号 |
| `GET` | `/api/v1/bodylog/seven-day-plan/latest` | 无 | 最近一次计划（含 completed）；支持重启后继续领奖，无计划为 null |
| `GET` | `/api/v1/bodylog/seven-day-plan/active` | 无 | 查询进行中的计划，无则返回 `null` |
| `GET` | `/api/v1/bodylog/seven-day-plan/{planId}` | 无 | 计划详情 |
| `GET` | `/api/v1/bodylog/seven-day-plan/{planId}/missions` | 无 | 计划任务列表 |
| `POST` | `/api/v1/bodylog/seven-day-plan/{planId}/daily-aggregate` | 日期、时区、达标目标数、适用目标数、定义版本和 eventId | 覆盖提交某本地日期汇总并自动重算当日任务 |
| `POST` | `/api/v1/bodylog/seven-day-plan/{planId}/missions/{missionId}/complete` | 无 | 兼容旧客户端的废弃路由；始终返回 `409 BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED`，不会手动完成任务 |
| `GET` | `/api/v1/bodylog/seven-day-plan/{planId}/rewards` | 无 | 计划奖励列表 |
| `POST` | `/api/v1/bodylog/seven-day-plan/{planId}/rewards/{rewardId}/claim` | 无 | 领取奖励 |
| `GET` | `/api/v1/bodylog/notification-preferences` | 无 | 查询通知偏好 |
| `PUT` | `/api/v1/bodylog/notification-preferences` | `{ "enabledCategories"?, "quietHours"?, "mergeRequests"?, "leaderboardRankPush"?, "marketingConsent"? }` | 更新通知偏好 |
| `POST` | `/api/v1/bodylog/push-devices` | `{ "deviceToken": "...", "platform": "ios\|android", "name"?: "..." }` | 注册推送设备 |
| `GET` | `/api/v1/bodylog/push-devices` | 无 | 列出推送设备 |
| `DELETE` | `/api/v1/bodylog/push-devices/{deviceId}` | 无 | 移除推送设备 |

BodyLog 新增接口约定：

- `GET /api/v1/bodylog/public/config` 匿名返回 `accountSocial`、`friends`、`competition`、`challengeCreation`、`growth` 五个布尔开关。客户端可接受 `{ code, data }` 信封；缺失/无效的开关按关闭处理。远程配置缓存超过 24 小时后不再授权远程域。
- 服务端在认证后逐域检查开关：profile/好友/邀请/搭子/小组/社交通知设备路由需 `accountSocial`；好友请求、好友、屏蔽和举报还需 `friends`；挑战与排行榜需 `competition`；仅创建挑战额外要求 `challengeCreation`；所有七日计划路由需 `growth`。开关关闭或记录缺失统一返回 `404 BODYLOG_FEATURE_DISABLED`。逐路由列表同步记录在 BodyLog OpenAPI 的 `x-bodylog-feature-gates` 扩展中。
- 关闭这些远程路由不会影响 iOS 本地习惯日志、健康提醒或 Watch 快速打卡；客户端 DEBUG 构建也遵循远程开关（仅显式 `-BodyLogGrowthFixture` 可展示本地成长 fixture）。

- 新客户端在 `/buddies/checkin` 同时传 `eventId` 与 `occurredAt`。同一账号、同一配对、同一事件重复发送不增加活动或重复入队通知；改变习惯、次数或时间后复用事件 ID 返回 409 `BODYLOG_EVENT_CONFLICT`。缺一个字段、非法 ID/时间或超过服务器时间 5 分钟的未来时间返回 400。旧版不带这两个字段仍按原有非幂等方式处理。
- `occurredAt` 使用带时区的 ISO 8601 时间；服务端按 UTC 归属活动日期。早于关系接受时间的本地记录不进入新关系；历史补报不会重新结算已结算的搭子日期。客户端只上传用户明确共享的非私密习惯。
- `/leaderboards/current/snapshot` 只返回当前认证用户的目标快照；客户端使用其中的时区、habitId 和 scheduledDates 生成每日完整聚合。聚合为覆盖更新，空数组可反映撤销；它不是多设备日志合并协议。
- `/subscription/status` 使用搭子/小组额度判断的同一份服务端权益，不接受客户端 premium 布尔值。购买成功或恢复购买后，客户端应将 StoreKit 2 JWS / Google Play purchase token 提交到 `POST /subscription/purchases`，再读取该状态接口。无效凭证返回 `400 BODYLOG_PURCHASE_INVALID`，已绑定其他账号返回 `409 BODYLOG_PURCHASE_ALREADY_CLAIMED`，商店验签配置缺失返回 `503 BODYLOG_PURCHASE_VERIFICATION_UNAVAILABLE`。
- BodyLog 推送从自己的设备表取 token，应用当前通知类别设置；`buddy_invite` 归 `friendRequest`，等级奖励归 `rewardArrived`，其他搭子动态归 `activity`。现有 quietHours 不含时区字段，按 UTC 小时判断；静默窗口内跳过本条通知。分发失败会标记 FAILED 并抛给任务队列重试。部署配置见 `docs/bodylog-client-cloud-integration.md`。


- 创建搭子返回 `{ pair, invitationUrl }`；仅被邀请者可接受，发起者不能代替对方接受。邀请接受时重新检查拉黑及双方额度。邀请 14 天后过期，不再占用额度，可重新发送；缺少发起者记录的历史邀请也需重新发送。
- 创建小组返回 `{ group, invitationUrl }`；详情返回 `{ group, members, recentActivities, weeklyRecords }`，每日记录的 `completionRate` 为 0–100 的百分数。
- 直接配对/小组链接分别为 `/b/{pairId}?token=...` 和 `/g/{groupId}?token=...`；小组接受请求从链接提取 groupId 和 token。小组共享链接有效期为创建后 7 天；定向邀请链接随通知 `data.invitation_url` 发送。`POST groups/{groupId}/invite` 返回 `{ invited: true }`。邀请归因接口生成的 `/i/{token}`、`/b/{token}`、`/g/{token}` 仍由归因接口消费。
- 小组仅活跃组长/管理员可邀请；离组组长的权限立即失效，组长转让持久化。打卡仅接受小组共同习惯和正整数 count。
- 全部 `seven-day-plan/*` 接口受 `growth` 开关控制，关闭时返回 `404 BODYLOG_FEATURE_DISABLED`。新计划按版本 1 生成 7 条 `localGoal` 日任务；每天至少达成一个明确次数/时长目标后由服务端自动完成。日汇总按账号/日期覆盖保存；同一请求重试幂等，撤销或改目标后的新汇总可重算进度。直接手动完成返回 `409 BODYLOG_GROWTH_LOCAL_EVIDENCE_REQUIRED`。奖励只能在计划完成后领取；领取奖励后锁定计划汇总，避免已发权益与回退状态冲突。
- 注册推送设备的 `name` 可省略；同一设备 token 被新账号注册后转移归属，旧账号列表不再显示该设备。
- 注销 BodyLog app 账号会清理成长计划、通知偏好、设备、订阅、搭子关系与所拥有的小组；其他小组中的个人成员和活动记录同时清理。共享 Zook 用户及其他产品数据保留。

Profile 成功响应的 `data`：

```json
{
  "userId": "user_123",
  "nickname": "薄荷同行者",
  "avatarKey": "mint_runner",
  "profileCompleted": true,
  "createdAt": "2026-07-28T00:00:00.000Z",
  "updatedAt": "2026-07-28T00:00:00.000Z"
}
```

昵称去除首尾空白后必须为 2–20 个 Unicode 字符。头像仅支持 `mint_runner`、`blue_drop`、
`orange_sun`、`purple_moon`。校验失败分别返回 `BODYLOG_NICKNAME_INVALID` 或
`BODYLOG_AVATAR_INVALID`；内容安全拦截返回 `422 BODYLOG_PROFILE_UNSAFE`。调用
`POST /api/v1/users/me/delete` 删除 BodyLog app 账号时会删除这份服务端资料，但不会删除共享
Zook 用户或其他 app 数据。

BodyLog 的完整请求、响应结构与枚举以
`api-contracts/openapi/bodylog/api.yaml` 为准。排行榜分数、邀请资格和挑战排名均由
服务端计算；客户端不得提交或覆盖最终分数。好友、邀请和挑战接口会共同执行拉黑隔离规则。

## 9. FrogSleep API

FrogSleep 是 Zook 的 app-scoped 产品，固定 app id 为：

```text
frogsleep
```

FrogSleep API 统一使用产品作用域前缀 `/api/v1/frogsleep/*`，对应 OpenAPI 合同位于 `api-contracts/openapi/frogsleep/api.yaml`，并同步生成到 `src/generated/openapi/public-contracts.generated.ts`。这些接口内部仍使用 Zook 共享账号、共享 Bearer token、app membership、通知队列和 worker。客户端不需要在 `/api/v1/frogsleep/auth/*` 公共接口里传 `appId`；服务端会自动按 `frogsleep` 处理。受保护接口必须使用 FrogSleep token，并要求当前用户仍是 active FrogSleep member；其他 app token 会返回 `403 AUTH_APP_SCOPE_MISMATCH`，已删除或封禁的 FrogSleep membership 会返回对应 app member 错误。`/v1/*` 不属于 FrogSleep 外部 API；客户端必须使用本文档和 OpenAPI 中的 canonical path。

FrogSleep 已作为 dev / online 部署槽的线上联调产品开放。`DEPLOY_SLOT=dev` 或 `DEPLOY_SLOT=online` 时会默认 seed `frogsleep` app 并分发 FrogSleep 路由；其他默认 runtime 仍保持关闭，避免影响未发布产品面。需要显式覆盖时可使用 `FROGSLEEP_ENABLED=true` / `FROGSLEEP_ENABLED=false`，测试仍可通过选项 `frogsleepEnabled` 控制。本地 iOS 联调启动 Zook 时可使用：

```bash
FROGSLEEP_ENABLED=true npm run dev
```

搭子成长能力按阶段独立灰度，默认均关闭：

```bash
FROGSLEEP_BUDDY_INBOX_ENABLED=true
FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED=true
FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED=true
FROGSLEEP_BUDDY_INTERACTIONS_ENABLED=true
FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED=true
FROGSLEEP_BUDDY_PUSH_ENABLED=true
FROGSLEEP_BUDDY_GROUP_ENABLED=true
```

这些开关分别控制邀请收件箱、邀请显式同意、搭子成长主页、结构化互动、共同目标/周报、Push 投递和 2-5 人群组搭子。客户端可逐项灰度；服务端关闭某项能力时不得通过旧链接绕过鉴权或显式接受规则。

FrogSleep 成功响应在迁移期采用双兼容格式：保留 Zook 标准响应包 `code + message + data + requestId`，同时把对象型 `data` 字段复制到响应根部，方便仍按 Go 后端 raw JSON 解码的 Sleep 客户端读取 `access_token`、`refresh_token`、`user_id`、`device`、`status`、`relationship_id`、`session_id`、`summary`、`recap`、`moments` 等字段。错误响应仍使用 Zook 统一错误码；常见错误包括：请求体缺字段返回 `400 REQ_INVALID_BODY`；未带 Bearer token 返回 `401 AUTH_BEARER_REQUIRED`；token 非法或过期返回 `401 AUTH_INVALID_TOKEN`；非 FrogSleep app token 访问 `/api/v1/frogsleep/*` 保护接口返回 `403 AUTH_APP_SCOPE_MISMATCH`；重复关系、重复邮箱等业务冲突返回 `409`。

对象型详情接口会同时返回根对象和嵌套对象。例如 `/api/v1/frogsleep/sleep-buddy/shared-summaries/latest` 同时包含根部 `session_id` 和 `summary.session_id`，并在 `data.summary.session_id` 下保留 Zook envelope 读法。列表接口使用根部容器字段，例如 `invites` / `pending_invites`、`sessions`、`achievements`、`candidates`、`messages`、`moments`、`sleep_reports`；客户端不应假设这些列表接口返回裸数组。业务 payload 避免使用顶层 `data` 字段，以免覆盖 Zook envelope。

### 9.1 FrogSleep Auth / Me / Device

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/v1/frogsleep/auth/email/send-code` | 发送邮箱验证码 |
| `POST` | `/api/v1/frogsleep/auth/email/auth-code` | 发送邮箱验证码，兼容旧命名 |
| `POST` | `/api/v1/frogsleep/auth/email/change-code` | 已登录用户发送共享账号 email 变更验证码 |
| `POST` | `/api/v1/frogsleep/auth/email/login` | 邮箱验证码登录 |
| `POST` | `/api/v1/frogsleep/auth/email/complete` | 邮箱验证码登录，兼容旧命名 |
| `POST` | `/api/v1/frogsleep/auth/email/verify` | 邮箱验证码登录，兼容旧命名 |
| `POST` | `/api/v1/frogsleep/auth/email/register` | 无验证码时发送注册验证码；带验证码时邮箱 + 密码注册 |
| `POST` | `/api/v1/frogsleep/auth/password/register` | 无验证码时发送注册验证码；带验证码时邮箱 + 密码注册 |
| `POST` | `/api/v1/frogsleep/auth/password/login` | 密码登录 |
| `POST` | `/api/v1/frogsleep/auth/password/reset/request` | 发送重置密码验证码 |
| `POST` | `/api/v1/frogsleep/auth/password/reset/confirm` | 使用验证码重置密码 |
| `POST` | `/api/v1/frogsleep/auth/password/change` | 已登录用户修改密码 |
| `POST` | `/api/v1/frogsleep/auth/token/refresh` | 刷新 token |
| `POST` | `/api/v1/frogsleep/auth/logout` | 登出 |
| `GET` | `/api/v1/frogsleep/me` | 当前用户 |
| `DELETE` | `/api/v1/frogsleep/me/account` | 删除当前 FrogSleep app 账号；保留共享 Zook 用户和其他 app membership |
| `POST` | `/api/v1/frogsleep/auth/email/bind` | 使用新邮箱验证码修改当前共享账号 email |
| `POST` | `/api/v1/frogsleep/auth/email/change` | 使用新邮箱验证码修改当前共享账号 email |
| `POST` | `/api/v1/frogsleep/devices` | 注册 / 更新设备 push token |
| `DELETE` | `/api/v1/frogsleep/devices/{deviceId}` | 删除当前用户设备 |

密码登录请求示例：

```json
{
  "identifier": "alice@example.com",
  "password": "Password1234"
}
```

兼容 alias：

1. 密码登录账号字段支持 `identifier`、`account`、`email`。
2. 邮箱验证码字段支持 `code`、`email_code`、`emailCode`。
3. 邮箱验证 / 密码重置确认支持 `verification_id`、`verificationId` 作为兼容字段别名。
4. 密码重置确认的新密码字段支持 `new_password`、`newPassword`、`password`。

`/api/v1/frogsleep/auth/email/register` 和 `/api/v1/frogsleep/auth/password/register` 如果未传验证码，会发送注册验证码并返回 `accepted`、`verification_id`、`expires_at` 等字段；如果同时传 `email`、`password` 和验证码字段，会完成注册并签发 FrogSleep session。`/api/v1/frogsleep/auth/password/reset/confirm` 成功后同样返回兼容 token 响应，客户端应保存新的 `access_token` / `refresh_token` 会话。`/api/v1/frogsleep/auth/password/change` 修改的是共享 Zook 账号密码，同一账号在 ai_novel 或其他 app 的密码登录也会使用新密码。

`/api/v1/frogsleep/auth/email/bind` 和 `/api/v1/frogsleep/auth/email/change` 会修改共享 Zook 用户的 email；请求前必须在已登录状态下先对目标新邮箱调用 `/api/v1/frogsleep/auth/email/change-code`，然后提交 `{ "email": "new@example.com", "code": "123456" }`，验证码字段同样支持 `code`、`email_code`、`emailCode`。登录验证码 `/api/v1/frogsleep/auth/email/send-code` / `/api/v1/frogsleep/auth/email/auth-code` 不能用于修改共享账号 email；未验证的新邮箱不会写入共享账号。`DELETE /api/v1/frogsleep/me/account` 不需要请求体，会删除当前 FrogSleep app 账号：将当前用户的 FrogSleep membership 标记为 deleted，撤销 FrogSleep app session，并清理 FrogSleep app-scoped 设备和业务数据；它不会删除共享 Zook 用户，也不会删除同一用户在 ai_novel 或其他 app 的 membership 与业务数据。

兼容 token 响应示例。客户端既可以读根部字段，也可以读 `data`：

```json
{
  "code": "SUCCESS",
  "message": "OK",
  "requestId": "req_xxx",
  "access_token": "...",
  "access_token_expires_at": "2026-06-24T10:00:00.000Z",
  "expires_in": 900,
  "refresh_token": "...",
  "refresh_token_expires_at": "2026-08-23T10:00:00.000Z",
  "user_id": "user_alice",
  "app_id": "frogsleep",
  "user": {
    "id": "user_alice",
    "name": "alice",
    "email": "alice@example.com",
    "phone": null,
    "avatarUrl": null,
    "hasPassword": true
  },
  "data": {
    "access_token": "...",
    "access_token_expires_at": "2026-06-24T10:00:00.000Z",
    "expires_in": 900,
    "refresh_token": "...",
    "refresh_token_expires_at": "2026-08-23T10:00:00.000Z",
    "user_id": "user_alice",
    "app_id": "frogsleep",
    "user": {
      "id": "user_alice",
      "name": "alice",
      "email": "alice@example.com",
      "phone": null,
      "avatarUrl": null,
      "hasPassword": true
    }
  }
}
```

`GET /api/v1/frogsleep/me` 会返回根部和 `data` 下的 `app_id`、`user_id`、`verified_email`、`display_name`、`email_verified`、`user`。`display_name` 是响应兼容字段；专注搭子匹配资料里的 `display_name` 存在 FrogSleep app-scoped profile 中，不会写入共享用户资料。`POST /api/v1/frogsleep/auth/logout` 返回 `{ "status": "ok", "revoked": n }` 兼容字段。`DELETE /api/v1/frogsleep/me/account` 返回 `{ "status": "ok", "deleted": true, "revoked": n, "revokedSessions": n }`，删除当前 FrogSleep app 账号并清理 FrogSleep app-scoped runtime data，但保留共享用户和其他 app 数据。设备注册返回根部和 `data.device`；设备删除返回根部 `status: "deleted"`、`deleted`、`device`。

设备注册请求示例：

```json
{
  "platform": "ios",
  "push_token": "apns-or-fcm-token",
  "app_version": "1.0.0",
  "timezone": "Asia/Shanghai"
}
```

### 9.2 FrogSleep 睡眠搭子

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites` | 创建睡眠搭子邀请 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/invites/preview` | 按 `token` 或 `code` 预览邀请，不接受邀请 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/invites/pending` | 待处理邀请 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites/accept-code` | 用 code 接受邀请 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites/accept-token` | 用 token 接受邀请 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites/{inviteId}/accept` | 用 invite id 接受邀请 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites/{inviteId}/decline` | 拒绝邀请 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/invites/{inviteId}/cancel` | 取消邀请 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/relationships/current` | 当前睡眠搭子关系 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/pause` | 暂停关系 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/resume` | 恢复关系 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/revoke` | 解除关系 |
| `PATCH` | `/api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/preferences` | 更新当前用户守护偏好 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/guardianship/status` | 共同守护状态快照 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/shared-sessions` | 创建共同守护 session |
| `GET` | `/api/v1/frogsleep/sleep-buddy/shared-sessions/active` | 当前活跃共同守护 session |
| `POST` | `/api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/accept` | 接受共同守护 session |
| `POST` | `/api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/events` | 上报共同守护事件 |
| `POST` | `/api/v1/frogsleep/sleep-buddy/shared-sessions/{sessionId}/pause-tonight` | 今晚暂停 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/shared-summaries/latest` | 最新个人总结 |
| `GET` | `/api/v1/frogsleep/sleep-buddy/shared-recaps/latest` | 最新共同 recap |

邀请请求示例：

```json
{
  "invitee": "bob@example.com",
  "role": "guardian",
  "custom_label": "今晚互相监督"
}
```

邀请响应包含 canonical 字段和 rollout alias。客户端应优先读取 `invite_id`、`invite_code`、`invite_token`、`invite_link`、`invitee_email_snapshot`、`status`、`expires_at`；迁移期仍保留 `id`、`code`、`token`、`share_link` 等旧字段。用 code、token 或 invite id 接受睡眠搭子邀请时，Zook 会校验当前 FrogSleep Bearer token 对应用户的已验证邮箱与 `invitee_email_snapshot` 一致；不一致返回 `403 AUTH_APP_SCOPE_MISMATCH` 且不会创建关系。取消邀请仅邀请发起人可调用；拒绝邀请仅指定 invitee 或邮箱快照匹配的登录用户可调用。无指定目标的公开/纸条邀请不能被任意登录用户 decline，应由发起人 cancel。

`GET /api/v1/frogsleep/sleep-buddy/invites/preview?token=...` 或 `?code=...` 需要 FrogSleep Bearer 鉴权，只用于登录后恢复邀请上下文，不会创建关系、不会消耗邀请。响应包含 `invite.domain = "sleep"`、`invite_id`、`raw_invite_id`、`status`、`inviter_user_id`、`invitee_user_id`、`viewer_can_accept`、`accept_method`、`expires_at`、`share_title`、`share_subtitle`。接受成功后，关系响应会带回 `source_invite_id`、`accept_source`、`accepted_at`；邀请内部会记录 `accepted_by_user_id`，便于统计邀请转化。

邀请决定更新使用严格递增的持久化逻辑时间，已读时间追平最新决定；同毫秒操作或设备时钟回退不会吞掉新的未读状态，相同状态和版本的幂等重放保持已读。

同一对用户已有 active/paused 的睡眠或专注关系时，重复组合邀请的对应领域只读显示已连接，复用原关系 ID；此规则同时覆盖旧聚合 `/accept` 与新逐域接受产生的关系。不会新建关系、占用新 slot 或扩大任一方授权；canonical 撤销记录仍覆盖旧关系事实。

睡眠搭子关系状态机为 `active -> paused -> active`，`active|paused -> revoked`；`revoked` 是终态，不能恢复、暂停或创建新的共同守护 session。`POST /api/v1/frogsleep/sleep-buddy/shared-sessions` 可传 `joint_activity_id`（兼容别名 `jointActivityId`），将已接受并开始的 `tonight_together` 活动固定到同一个共享会话；双方跨午夜、跨时区加入、并发重试以及活动完成后的恢复均返回原会话，不再按各自 `date_anchor` 新建。活动必须属于该关系及当前参与者；错误关系/活动返回 `403`，未接受、未开始或已过期且尚无绑定会话返回 `409`。共同活动仅使用绑定会话的真实完成事实。未传活动 ID 时保留 `relationship_id + date_anchor` 的 pending/active 会话复用规则；日期键接受有效日历日期及旧 ISO 时间戳并归一为其日期部分，非法日期返回 `400`。

`PATCH /api/v1/frogsleep/sleep-buddy/relationships/{relationshipId}/preferences` 成功响应包含 `preferences` 和当前 `relationship`，用于 iOS 在保存守护偏好后直接刷新关系状态。请求只接受 `guard_level`、`visibility_scope`、`mute_for_tonight`、`allow_morning_summary_push`、`allow_recovery_nudges`；未知字段或类型不匹配返回 `400 REQ_INVALID_BODY`。共同守护 session 响应包含 Zook canonical 字段 `session_id`、`relationship_id`、`status`、`participant_states`、`starts_at`、`ends_at`，并额外保留 iOS 兼容字段 `shared_session_id`、`initiator_user_id`、`invite_status`、`date_anchor`、`initiator_state`、`partner_state`、`started_at`、`ended_at`；其中 `initiator_state` / `partner_state` 会把后端内部 `pending` 映射为 iOS 已有枚举 `invited`。

共同守护事件请求示例：

```json
{
  "event_type": "morning_completed",
  "occurred_at": "2026-06-24T07:30:00.000Z",
  "metadata": {
    "score": 88
  }
}
```

共同守护事件 `event_type` 支持 `sleep_started`、`ritual_completed`、`interrupted`、`returned`、`paused_tonight`、`morning_completed`。未知事件、非法 `occurred_at` 或不可见 session 返回 `400/403`，不会写入事件。`morning_completed` 与 `paused_tonight` 会生成基于共同守护事件的 summary/recap。summary 保留 `completed`、`date_anchor`、`started_at`、`ended_at`、`interrupted_count`、`returned_count`、`paused_tonight`、`telemetry_level = "shared_session_events"`，并补充 iOS 可见字段 `artifact_version`、`visible_state`、`started_on_time`、`had_recovery`、`returned_after_recovery`、`completed_morning`、`headline`。recap 保留 `participant_states`、`event_types` 等字段，并补充 `artifact_version`、`combined_result_type`、`my_result_state`、`partner_result_state`、`headline`、`supporting_line`、`recommended_next_step`。这些字段来自共同守护 session 和事件，不是睡眠阶段或医疗级睡眠评分。

### 9.3 FrogSleep 专注搭子

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/v1/frogsleep/focus-buddy/sessions` | 上报专注 session |
| `GET` | `/api/v1/frogsleep/focus-buddy/sessions` | 查询专注 session |
| `GET` | `/api/v1/frogsleep/focus-buddy/stats/week` | 最近 7 天专注统计 |
| `GET` | `/api/v1/frogsleep/focus-buddy/achievements` | 专注成就 |
| `POST` | `/api/v1/frogsleep/focus-buddy/achievements/notify` | 标记成就通知 |
| `POST` | `/api/v1/frogsleep/focus-buddy/match-profile` | 保存匹配资料 |
| `GET` | `/api/v1/frogsleep/focus-buddy/match-profile/me` | 当前匹配资料 |
| `DELETE` | `/api/v1/frogsleep/focus-buddy/match-profile` | 删除匹配资料 |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/search` | 搜索匹配候选人 |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/invite` | 邀请候选人 |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/dismiss` | 不再看见该匹配候选人 |
| `POST` | `/api/v1/frogsleep/focus-buddy/matches/{userId}/report` | 举报该匹配候选人 |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites` | 直接邀请专注搭子 |
| `GET` | `/api/v1/frogsleep/focus-buddy/invites/preview` | 按 `token` 或 `code` 预览邀请，不接受邀请 |
| `GET` | `/api/v1/frogsleep/focus-buddy/invites/pending` | 查询当前用户发出和收到的待处理专注搭子邀请 |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites/{inviteId}/decline` | 被邀请人拒绝专注搭子邀请 |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites/{inviteId}/cancel` | 邀请人取消专注搭子邀请 |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites/accept-code` | 用 code 接受专注搭子邀请 |
| `POST` | `/api/v1/frogsleep/focus-buddy/invites/accept-token` | 用 token 接受专注搭子邀请 |
| `GET` | `/api/v1/frogsleep/buddy/invitations?direction=incoming\|outgoing` | 统一查询睡眠与专注搭子收件箱/发件箱 |
| `POST` | `/api/v1/frogsleep/buddy/invitations` | 创建睡眠、专注或两者组合邀请；`domains` 为 `sleep`/`focus` 数组 |
| `POST` | `/api/v1/frogsleep/buddy/invitation-receipts` | 记录邮箱绑定的不透明邀请回执，不创建或投递正式邀请 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/{inviteId}` | 按 ID 预览统一搭子邀请，不消费邀请 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/preview` | 按 `invitation_id`、`token`、`code` 或 `notification_id` 预览邀请，不消费邀请 |
| `GET` | `/api/v1/frogsleep/buddy/safety-baseline` | 获取版本化安全基线；要求 FrogSleep Bearer 鉴权，独立于普通搭子增长能力开关 |
| `GET` | `/api/v1/frogsleep/buddy/capabilities` | 获取版本化普通搭子命令能力；要求 FrogSleep Bearer 鉴权，不包含邀请或关系数据 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/accept` | 按 `expected_version` 显式接受邀请，要求 `idempotency_key` |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/accept` | 被邀请人按 `sleep` 或 `focus` 单独接受组合邀请中的一个领域 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/decline` | 被邀请人独立拒绝一个领域；安全命令，不受普通能力开关影响 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/cancel` | 邀请人独立取消一个领域；安全命令，不受普通能力开关影响 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/decline` | 按版本拒绝邀请，重复 idempotency key 返回同一结果 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{inviteId}/cancel` | 邀请人按版本取消邀请 |
| `GET` | `/api/v1/frogsleep/buddy/relationships/{relationshipId}/grants` | 关系参与者查询双方按方向、领域和类别拆分的分享授权 |
| `PATCH` | `/api/v1/frogsleep/buddy/relationships/{relationshipId}/grants/{grantId}` | 授权人用 `expected_version` 暂停或恢复自己的单项授权 |
| `GET` | `/api/v1/frogsleep/buddy/groups` | 查询当前用户参与或拥有的群组搭子 |
| `POST` | `/api/v1/frogsleep/buddy/groups` | 创建睡眠或专注群组搭子，创建者为 owner |
| `GET` | `/api/v1/frogsleep/buddy/groups/{groupId}` | 查询群组详情、成员和邀请 |
| `PATCH` | `/api/v1/frogsleep/buddy/groups/{groupId}` | owner 更新群组名称、描述和分享基线 |
| `GET` | `/api/v1/frogsleep/buddy/groups/{groupId}/hub` | 查询群组主页、成员 presence、近期活动和当前用户可执行动作 |
| `GET` / `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/invitations` | 查询或创建群组邀请 |
| `POST` | `/api/v1/frogsleep/buddy/groups/invitations/{invitationId}/{action}` | 群组邀请 `accept`、`decline` 或 `cancel` |
| `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/members/{userId}` | owner/moderator 移除非 owner 成员 |
| `PATCH` | `/api/v1/frogsleep/buddy/groups/{groupId}/members/{userId}/role` | owner 调整非 owner 成员角色 |
| `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/{action}` | 群组 `leave`、`pause`、`resume` 或 `dissolve` |
| `GET` | `/api/v1/frogsleep/buddy/groups/{groupId}/grants` | 查询群组成员共享基线授权视图 |

受保护的搭子数据按方向授权分类校验：`presence` 用于在线/专注状态，`daily_summary` 用于睡眠总结与联合回顾，`weekly_trend` 用于专注对比，`shared_activity` 用于共享时刻、结构化消息和共同睡眠活动。关系暂停、撤销、拉黑或对应方向授权撤销后，新读取和新互动立即拒绝。在方向授权上线前已接受的旧关系会幂等回填双向默认授权，以保持原有共享行为；新关系只使用接受预览中明示的分类。

`GET /api/v1/frogsleep/buddy/safety-baseline` 返回标准 Zook envelope，并提供 `schema_version: "1"`、`minimum_client_version: "1.0.0"`、ISO-8601 `server_time` 以及始终为 `true` 的 `safety_commands.decline`、`cancel`、`pause`、`revoke`、`block`。响应头固定为 `Cache-Control: private, max-age=300`。该接口不返回邀请、关系、授权或能力开关，且不受普通搭子增长能力开关影响；未携带 FrogSleep Bearer token 时返回现有 `401 AUTH_BEARER_REQUIRED` 错误 envelope。

`GET /api/v1/frogsleep/buddy/capabilities` 返回标准 Zook envelope，并提供 `schema_version: "1"`、`buddy_api_version: "1"`、`minimum_client_version: "1.0.0"`、最多五分钟后过期的 ISO-8601 `expires_at`，以及 `commands.create`、`accept`、`activity`、`share`、`focus_matching`、`group_buddies` 等显式布尔值。`create` 与 `accept` 仅在普通邀请收件箱和显式邀请同意能力均启用时为 `true`；`activity` 与 `share` 仅在结构化互动能力启用时为 `true`；`group_buddies` 仅在 `FROGSLEEP_BUDDY_GROUP_ENABLED=true` 时为 `true`。响应头固定为 `Cache-Control: private, max-age=300`，未携带 FrogSleep Bearer token 时返回现有 `401 AUTH_BEARER_REQUIRED` 错误 envelope。此普通能力文档不返回安全命令、邀请、关系、授权、账户或功能开关元数据；它可以全部为 `false`，而独立的 safety baseline 仍保持可用。

群组搭子接口要求 FrogSleep Bearer 鉴权并受 `group_buddies` 能力开关控制，关闭时返回未命中路由。群组 `domain` 只允许 `sleep` 或 `focus`，`group_name` 为 1-40 字符，`group_description` 最长 160 字符，`sharing_baseline` 只允许 `presence`、`daily_summary`、`weekly_trend`、`shared_activity`。每组最多 5 名 active 成员；每个 owner 最多 5 个未解散群组。群组状态为 `forming`、`active`、`paused`、`dissolved`；首个成员创建后为 `forming`，第二名成员接受邀请后进入 `active`。owner 可更新、暂停、恢复、解散和改角色；owner/moderator 可邀请或移除普通成员；owner 不能直接离开最后一个 owner 身份。常见业务错误包括 `400 BUDDY_GROUP_LIMIT`、`400 BUDDY_GROUP_FULL`、`400 BUDDY_GROUP_INVITATION_NOT_FOUND`、`400 BUDDY_GROUP_INVITATION_EXPIRED`、`403 BUDDY_GROUP_FORBIDDEN`、`403 BUDDY_GROUP_NOT_MEMBER`、`403 BUDDY_GROUP_PAUSED` 和 `409 BUDDY_GROUP_CONFLICT`。

`POST /api/v1/frogsleep/buddy/invitation-receipts` 要求 FrogSleep Bearer 鉴权和普通 `create` 能力。请求体只接受邮箱语法合法的 `email` 与非空、不重复的 `domains`（`sleep`、`focus`）；邮箱会先 `trim().toLowerCase()`，服务端仅保存其 SHA-256 小写十六进制哈希。响应为标准 envelope，`data` 只含不透明 `receipt_id`、固定 `status: "recorded"` 和七天后过期的 ISO-8601 `expires_at`。同一邀请人、规范化邮箱和领域集合重复提交会返回原回执。已注册且合格的账户会在内部绑定不可变用户 ID；未注册、本人或不合格目标会记录同形 decoy 回执。该命令不泄露账户、投递或领域信息，当前只记录邀请回执，不代表已经投递、接受、创建邀请、关系、通知、定位器或分享链接。

统一邀请的列表与预览 `status` 按 `domain_results` 的有效状态聚合：只要仍有待处理领域即为 `pending`，全部接受后为 `accepted`，客户端不应继续对已处理领域展示接受按钮。同一对用户在某领域已有 active/paused 关系时，新邀请该领域返回只读 `accepted`、既有 `relationship_id` 和空 `viewer_actions`；不重复创建子邀请或关系，不重置既有授权，其它领域仍可独立操作。过期旧关系的原 decision 不会借用新关系恢复。

邀请列表 `unread` 由当前查看者的持久化阅读时间与邀请/逐域决定更新时间比较生成。按 ID、code 或 token 成功预览后会标记当前查看者已读；随后产生的新决定会重新变为未读。发起者创建邀请时视为已读，另一方初次查看前为未读。预览只更新阅读状态，不接受、拒绝或取消邀请。

`POST /api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/accept` 要求 FrogSleep Bearer 鉴权和普通 `accept` 能力，`domain` 仅支持 `sleep`、`focus`。请求体必须包含 JSON number 类型的正整数 `expected_version` 和非空 `idempotency_key`；字符串或布尔型版本不会被转换。调用者必须是邀请绑定的收件用户，或当前邮箱与未认领邀请目标匹配的用户，且该领域必须属于邀请；错误账户或不存在的邀请统一返回 `404 REQ_ROUTE_NOT_FOUND`。成功只接受指定领域，在一个事务中创建该领域关系、占用双方领域 slot、递增该领域 decision 版本，并向邀请人写入一条去重 outbox 事件；同步该领域兼容子邀请的终态，保留另一领域及既有关系，不隐式开启任何分享授权。单域关系建立时在同一事务内初始化双方各四类、共八条 `revoked` grant；不会沿用旧关系的自动补授逻辑。随后可通过该 `relationship_id` 查询 grants，各用户仅可 PATCH 自己作为 grantor 的记录；授权失败只重试 grant 更新，不重新接受另一个域。Bundle 预览的 `domain_results` 按实际领域 decision 返回 `status`、`decision_version` 和匹配该次接受的 `relationship_id`，不能使用 Bundle 总版本代替领域 decision 版本。旧领域关系已不可用时返回空关系 ID 和 `BUDDY_RELATIONSHIP_UNAVAILABLE`，不会从新 slot 恢复旧关系。

`POST /api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/decline` 与 `/cancel` 是始终可用的安全命令：均要求 FrogSleep Bearer 鉴权，但不受普通搭子能力、邀请收件箱、显式同意或双向 block 影响。`domain` 仅支持 `sleep`、`focus`，请求体使用与单领域 accept 相同的正整数 JSON `expected_version` 和非空 `idempotency_key`。`decline` 仅允许绑定收件用户或当前邮箱匹配的未认领邀请收件用户，`cancel` 仅允许邀请人；错误账户或不存在的邀请统一返回 `404 REQ_ROUTE_NOT_FOUND`。成功时只更新指定领域 decision（分别为 `declined` 或 `cancelled`）并向对方写入一条去重 outbox 事件，同步对应兼容子邀请的终态，保留其它领域、slot、关系和授权。相同行为和 idempotency key 可在组合邀请过期或终态后无写入重放；不同 key 或冲突版本返回现有 `409` 冲突响应。安全命令的成功响应 `data` **只**包含 `invitation_id`、`domain`、`decision_status`、`decision_version`。

`accept` 成功响应的 `data` 仅包含 `invitation_id`、`domain`、`decision_status`、`decision_version`、`relationship_id`、`relationship_status`。相同 idempotency key 重放返回已有权威结果，即使旧 bundle 随后过期或进入旧终态也不增加版本或 outbox；重放仍校验不可变被邀请人和领域归属。不同 key 的终态重放或 `expected_version` 过期返回 `409 REQ_INVALID_BODY`。任一参与者的领域 slot 已占用时返回 `409 BUDDY_DOMAIN_SLOT_OCCUPIED`，且 decision、slot、关系和 outbox 均不产生部分写入。
已生成的共享总结或联合回顾在授权移除后只返回 `redacted=true` 的稳定占位对象。运营元数据与 Push 路由仅允许不透明资源 ID 和路由枚举；邀请 token/code、私密总结、备注、自定义文本和原始记录会被丢弃，不进入日志、分析、Push 或错误轨迹。
邀请创建、code/token 预览、终态响应和重复未授权访问均按用户与操作域限流。超限返回 `429 AUTH_RATE_LIMITED`，`details.retry_after_seconds` 指示可重试时间；不同用户和操作域互不影响。
通知 worker 在投递前重新校验目标。邀请已过期、目标已删除/撤销或双方已拉黑时，outbox 直接转为 `dead_letter`，`last_error_code` 分别为 `TARGET_EXPIRED`、`TARGET_REVOKED` 或 `TARGET_BLOCKED`，不生成站内通知也不发 Push。短暂投递失败最多重试 5 次，之后以 `DELIVERY_FAILED` 进入 dead-letter 供运维查询。

统一邀请创建和终态响应会各写入一条去重 notification outbox 事件。旧组合邀请终态响应仍产生 bundle 级事件；新的单领域接受命令按领域各产生一条事件。安全路由只包含邀请 ID、领域和目标类型，不包含 token、code 或数据摘要。

| `GET` | `/api/v1/frogsleep/buddy/notifications` | 游标分页查询当前用户的搭子站内通知 |
| `GET` / `PATCH` | `/api/v1/frogsleep/buddy/notifications/preferences` | 查询/更新分类开关、安静时段、时区偏移、同类冷却和每日 Push 预算 |
| `GET` | `/api/v1/frogsleep/buddy/hub` | 查询按当前查看者授权过滤的搭子成长快照 |
| `GET` | `/api/v1/frogsleep/buddy/activity` | 游标分页查询结构化分享、受限互动和共同活动 |
| `POST` | `/api/v1/frogsleep/buddy/shares` | 创建带过期时间的最小结构化进度快照 |
| `POST` | `/api/v1/frogsleep/buddy/interactions` | 发送鼓励、赞美、支持、下次一起或今晚一起等受限回应 |
| `POST` | `/api/v1/frogsleep/buddy/joint-activities` | 发起联合专注或今晚一起睡的共同活动 |
| `POST` | `/api/v1/frogsleep/buddy/joint-activities/{activityId}/{action}` | 接受、拒绝、取消或完成共同活动 |
| `GET` | `/api/v1/frogsleep/buddy/goals` | 查询当前用户可见的共同目标、双方同意与已验证进度；可按 `relationship_id` 过滤 |
| `POST` | `/api/v1/frogsleep/buddy/goals` | 提议共同目标，要求 `relationship_id`、支持的 `type`、`target`、IANA `timezone` 和 `idempotency_key` |
| `POST` | `/api/v1/frogsleep/buddy/goals/{goalId}/{action}` | 使用 `expected_version` 和 `idempotency_key` 接受、调整、暂停或完成目标 |
| `GET` | `/api/v1/frogsleep/buddy/milestones` | 查询当前关系可见的去重里程碑；可按 `relationship_id` 过滤 |
| `GET` | `/api/v1/frogsleep/buddy/weekly-reports` | 查询按当前查看者和方向授权生成的共同周报版本 |
| `GET` | `/api/v1/frogsleep/buddy/weekly-reports/{reportId}` | 读取单份周报，读时再次校验关系与当前 `weekly_trend` 授权 |
| `GET` | `/api/v1/frogsleep/buddy/groups` | 查询当前用户参与或拥有的群组搭子 |
| `POST` | `/api/v1/frogsleep/buddy/groups` | 创建睡眠或专注群组搭子，创建者为 owner |
| `GET` / `PATCH` | `/api/v1/frogsleep/buddy/groups/{groupId}` | 查询或更新群组详情 |
| `GET` | `/api/v1/frogsleep/buddy/groups/{groupId}/hub` | 查询群组主页 |
| `GET` / `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/invitations` | 查询或创建群组邀请 |
| `POST` | `/api/v1/frogsleep/buddy/groups/invitations/{invitationId}/{action}` | 群组邀请 `accept`、`decline` 或 `cancel` |
| `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/members/{userId}` | 移除群组成员 |
| `PATCH` | `/api/v1/frogsleep/buddy/groups/{groupId}/members/{userId}/role` | 调整成员角色 |
| `POST` | `/api/v1/frogsleep/buddy/groups/{groupId}/{action}` | 群组 `leave`、`pause`、`resume` 或 `dissolve` |
| `GET` | `/api/v1/frogsleep/buddy/groups/{groupId}/grants` | 查询群组共享基线授权 |
| `GET` | `/api/v1/frogsleep/buddy/notifications/unread-count` | 查询搭子通知未读数 |
| `POST` | `/api/v1/frogsleep/buddy/notifications/{notificationId}/read` | 标记当前用户的一条通知已读 |
| `POST` | `/api/v1/frogsleep/buddy/notifications/mark-all-read` | 标记当前用户全部搭子通知已读 |
| `GET` | `/api/v1/frogsleep/buddy/notifications/{notificationId}/route` | 鉴权后解析仍有效的安全目标路由 |

notification worker 每分钟幂等物化 outbox：站内通知按 `outbox_id` 去重，并分别记录 `in_app` 与 `apns` delivery attempt。APNs payload 只携带 opaque `notification_id` 和安全路由元数据，受保护内容必须登录后从通知 feed 获取。

共同目标首批模板为 `focus_days`、`focus_minutes`、`sleep_schedule_days`、`daily_encouragement`。服务端根据提议者 IANA timezone 计算周一至下周一 UTC 窗口；提议者默认同意，对方必须显式接受才进入 `active`。任意一方调整目标后重新进入双边确认；暂停和完成使用中性状态。进度只由服务端可验证的专注 session、睡眠摘要、结构化互动或共同活动来源事件累计，同一 source event 幂等去重。
周报 worker 按每个查看者最新设备时区生成上一个已结束周窗口，只保存验证进度数、互动数、共同活动数和中性下一步。对方数据需要对方→查看者的 `weekly_trend` 授权；授权撤销后旧报告读取立即返回 `redacted` 并移除 partner 字段。晚到事件只在过滤后内容变化时生成新 version。里程碑覆盖首次有意义互动、首次共同行动和已结束周内两次有意义成长行为，按规则与窗口去重。
| `GET` | `/api/v1/frogsleep/focus-buddy/relationships/current` | 当前专注搭子关系 |
| `POST` | `/api/v1/frogsleep/focus-buddy/relationships/{relationshipId}/{action}` | 关系动作，仅支持 `accept`、`decline`、`revoke` |
| `POST` | `/api/v1/frogsleep/focus-buddy/messages` | 发送搭子消息 |
| `GET` | `/api/v1/frogsleep/focus-buddy/messages` | 查询搭子消息 |
| `GET` | `/api/v1/frogsleep/focus-buddy/presence` | 查询搭子 presence |
| `GET` | `/api/v1/frogsleep/focus-buddy/comparison` | 查询搭子对比 |
| `GET` | `/api/v1/frogsleep/focus-buddy/shared` | 查询共同专注时刻 |

匹配资料请求示例：

```json
{
  "display_name": "Alice",
  "study_types": ["deep_work"],
  "scene_tags": ["morning", "reading"],
  "active_period": "morning"
}
```

专注 session 请求示例：

```json
{
  "started_at": "2026-06-24T10:00:00.000Z",
  "ended_at": "2026-06-24T10:30:00.000Z",
  "room": "reading",
  "goal": "30m"
}
```

私人专注上报支持可选 `session_id`（兼容 `sessionId`）：1–128字符、至少包含一个非空白字符、大小写敏感，不自动trim或按UUID改写；两者都传时必须相同。幂等键为认证推导的 `(app_id, owner_user_id, client_session_id)`，请求体伪造owner/app不改变归属。相同内容重试返回相同的 `session_id`（服务端实体ID）、`id`（客户端ID）及创建时间，并保留首次省略时间字段时的服务端默认值；并发重复上报只产生一条有效记录。同键内容修正更新原记录，保留服务端ID/创建时间，周/日统计按最新内容计一次；按数据库最后接受的写入为准，尚无客户端revision排序。首次里程碑/共享检测仅在插入时触发，不因重试或私人修正重复创建。省略两个ID继续旧客户端每次新增行为；显式null、非字符串、全空白、超长或两个别名冲突返回 `400 REQ_INVALID_BODY`。

迁移 `021_frogsleep_focus_session_idempotency.sql` 对既有同app/user/client ID重复行保留最早实体ID和created_at、采用最新updated_at内容，其余软删除，并重接历史共享时刻的session引用；无有效客户端ID的旧记录保持原状。唯一索引与整理同事务安装，需要先在dev验证迁移与候选版本；没有自动发布授权。请求分析事件仍记录上报请求次数，唯一session数量以历史/统计接口为准。

专注 session 上报会校验 `started_at`、`ended_at` 为 ISO 时间，且 `ended_at >= started_at`；`planned_minutes`、`actual_minutes`、`interrupt_count` 必须是有限非负数，超出范围返回 `400 REQ_INVALID_BODY`。`status` 支持完成态 `completed`、`abandoned`、`interrupted`、`cancelled`，以及 presence 推导使用的进行态 `active`、`in_progress`、`focusing`。`GET /api/v1/frogsleep/focus-buddy/sessions`、`GET /api/v1/frogsleep/focus-buddy/achievements`、`GET /api/v1/frogsleep/focus-buddy/messages`、`GET /api/v1/frogsleep/focus-buddy/shared` 支持 `limit`、`cursor`，响应保留原列表容器字段并额外返回 `pagination = { limit, next_cursor, has_more }`。`limit` 默认 50，最大 100。

专注匹配搜索只返回已开启 `matching_consent`、仍有公开资料、与当前用户匹配条件兼容、且未与当前用户存在 pending / accepted 专注关系的候选人。候选响应除 `score`、`matched_scenes`、`matched_study_types`、`explanation` 外，还会带 `recommendation_type = "controlled_focus_partner"`、`privacy_note_key = "buddy_match.privacy.summary_only"`、`why_recommended`、`invite_prompt_key = "buddy_match.invite.controlled_prompt"`，用于客户端展示受控推荐理由和隐私边界。如果当前用户已有未过期的 outgoing pending 专注邀请，`/api/v1/frogsleep/focus-buddy/matches/search` 会直接返回空候选，并在 `empty_state` 中给出 `reason = "pending_invites"`、`title_key`、`subtitle_key`、`pending_relationship_id`、`pending_user_id`，客户端应引导用户回到待处理邀请状态；如果关联邀请已过期，搜索会先刷新过期状态，不继续卡住匹配。`dismiss` 与 `report` 都是当前用户维度的匹配反馈：请求体可传 `reason`、`note`，成功后该候选人会从当前用户后续匹配搜索中排除；不能对自己执行 dismiss / report。搜索内部会批量读取当前用户的 dismiss/report 反馈，避免按候选逐个查询。

专注搭子邀请响应同时包含 `share_link` / `expires_at` 与 iOS 读取的 `invite_link` / `invite_expires_at`。`GET /api/v1/frogsleep/focus-buddy/invites/preview?token=...` 或 `?code=...` 需要 FrogSleep Bearer 鉴权，只用于登录后恢复邀请上下文，不会创建关系、不会消耗邀请。响应包含 `invite.domain = "focus"`、`invite_id`、`raw_invite_id`、`status`、`inviter_user_id`、`invitee_user_id`、`viewer_can_accept`、`accept_method`、`expires_at`、`share_title`、`share_subtitle`。接受成功后，关系响应会带回 `source_invite_id`、`accept_source`、`accepted_at`；邀请内部会记录 `accepted_by_user_id`，便于统计邀请转化。

专注关系 `revoked` 是终态，不能再次 accept/decline/revoke，也不能用于消息、presence、共同专注时刻等搭子互动。搭子消息请求必须包含 `receiver_user_id` 以及 `template_key` 或 `custom_text`，`custom_text` 最大 280 字符；响应保留 snake_case 字段 `sender_user_id`、`receiver_user_id`、`template_key`、`custom_text`、`sent_at`，并提供 `senderUserId`、`receiverUserId`、`templateKey`、`customText`、`context`、`sentAt`、`readAt` camelCase alias。查询消息支持 `receiver_user_id` / `receiverUserId` 和 `since`，后端会先按指定搭子与时间过滤，再分页；非法 `since` 返回 `400 REQ_INVALID_BODY`。presence 需要 `buddy_user_id` / `buddyUserId`，仅接受已建立的专注搭子关系，状态由最近 session、消息和共同专注时刻推导，可能返回 `focusing`、`recently_active`、`idle`、`stale`，并保留 `buddy_user_id`、`status`、`updated_at`，可选返回 `active_session_id`、`goal_tag`、`started_at`、`ends_at`。comparison 支持 `week_start=YYYY-MM-DD` 或 ISO 时间，缺省使用服务端当前 UTC 周；shared moments 支持 `room_id` / `roomId`、`from`、`to`，非法时间或 `from > to` 返回 `400 REQ_INVALID_BODY`。`GET /api/v1/frogsleep/focus-buddy/achievements` 返回的每个成就包含 `id`、`milestone_id`、`type`、`title`、`description`、`earned_at`、`notified`、`unlocked`、`metadata`。

### 9.4 FrogSleep 云端产品数据

这些接口只保存需要跨设备同步、重装恢复或服务端校验的派生数据；实时音频/噪声采集、Screen Time shield、Widget、Watch、Live Activity 运行态仍由本地系统能力负责。

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/v1/frogsleep/product-data/sleep-reports` | 保存睡眠报告快照 |
| `GET` | `/api/v1/frogsleep/product-data/sleep-reports?since={iso}&limit={n}&cursor={cursor}` | 查询当前用户睡眠报告快照（支持增量同步） |
| `PUT/PATCH` | `/api/v1/frogsleep/product-data/progress/{namespace}` | upsert 当前用户进度快照 |
| `GET` | `/api/v1/frogsleep/product-data/progress/{namespace}` | 查询当前用户进度快照 |
| `GET` | `/api/v1/frogsleep/product-data/entitlements/current` | 查询当前 FrogSleep 权益状态 |
| `POST` | `/api/v1/frogsleep/account/guest-sessions` | 创建/恢复受限云游客；独立设备密钥与幂等 key |
| `POST` | `/api/v1/frogsleep/account/upgrade` | 正式账号凭据升级游客；旧设备ID正文仍409 |
| `POST/GET` | `/api/v1/frogsleep/product-data/sleep-sessions` | 原始终态睡眠创建/固定边界恢复，含墓碑 |
| `GET/PUT/PATCH/DELETE` | `/api/v1/frogsleep/product-data/sleep-sessions/{sessionId}` | 本人原始历史读取、修正和墓碑删除 |

睡眠报告请求必须包含 `snapshot_id`（或 `report_id` / `id`）、`schema_version`（或 `version`）、`recorded_at` ISO 时间和对象型 `data`。响应会把报告内容放在 `snapshot_data`，避免覆盖 Zook envelope 的 `data`。列表响应返回 `sleep_reports`、兼容 alias `reports` 与 `pagination`。`GET` 支持 `limit`（1–100，默认50）和不透明 `cursor`；按规范报告时间、稳定资源ID倒序在数据库分页，持续使用 `pagination.next_cursor` 直到 `has_more=false`，可恢复超过500条的完整历史。游标绑定认证身份和固定恢复边界，非法游标返回409 `FROGSLEEP_SYNC_CURSOR_INVALID`。

列表查询支持增量同步参数：
- `since`: ISO 8601 时间戳，返回 `recorded_at > since` 的报告；修订和删除使用changes
- `limit`: 最大返回记录数（默认 50，最大 100）
- `cursor`: 分页游标

进度快照 `namespace` 当前支持 `habit_progress`、`companion_state`、`cat_state`、`onboarding`、`report_preferences`。请求必须包含 `schema_version`（或 `version`）和对象型 `state`（或 `data`）；未知 namespace 返回 `400 REQ_INVALID_BODY`。权益查询返回当前 app-scoped entitlement；无记录时返回 `{ state: "unknown", plan: "free", source: "none" }`。FrogSleep logout 只注销 App 登录态，不删除报告、进度、权益记录，也不删除 Zook 全局账号。

`POST /api/v1/frogsleep/account/guest-sessions` 接收安全随机 `device_secret`、`device_id`、`platform`，必填 `Idempotency-Key`；返回受限 Bearer/refresh 和独立升级凭据，身份有效期30天。正式账号以自己的 Bearer、当前 `X-Sync-Epoch`、`Idempotency-Key`、来源 `guest_user_id/guest_upgrade_token/device_id` 及 `confirmed:true` 原子升级私人原始睡眠、报告和偏好。目标相同数据去重，不同正文或墓碑冲突整次回滚；成功撤销来源访问，原请求可重放确认。游客只能访问私人同步和本人会话，不能使用公共平台、搭子、专注或设备管理。旧 `guest_device_id` 单字段请求仍409 `FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED`，设备ID不证明归属。完整请求、错误、限额与重试见 [游客升级专题](docs/public-frogsleep-guest-upgrade.md)。

### 9.5 FrogSleep 邀请链接与推送

FrogSleep 邀请响应会包含 canonical 分享字段和兼容字段 alias。睡眠搭子邀请优先使用 `invite_code`、`invite_token`、`invite_link`、`invitee_email_snapshot`，同时保留 `code`、`token`、`share_link`、`share_title`、`share_subtitle`。链接 base URL 来自 `frogsleep` app 的 `admin.delivery_config.inviteLinks`：

```json
{
  "inviteLinks": {
    "sleepBuddyBaseUrl": "frogsleep://sleep-buddy-invite",
    "focusBuddyBaseUrl": "frogsleep://focus-invite"
  }
}
```

浏览器中转接口：

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `GET` | `/frogsleep/sleep-buddy-invite?token=...&code=...` | 302 到带 `mode=preview` 的 App 预览路由；该链接只定位邀请，不表达接受同意 |
| `GET` | `/frogsleep/focus-invite?token=...&code=...` | 302 到带 `mode=preview` 的 App 预览路由；该链接只定位邀请，不表达接受同意 |

中转接口不要求登录、不消费邀请；服务端会尽力记录打开行为到邀请 payload，包括 `first_opened_at`、`last_opened_at`、`open_count`、`last_open_source = "redirect"`、`last_open_user_agent`。即使打开记录写入失败，中转仍返回 302，避免分享链路被统计失败阻断。

完整邀请 handoff 行为见 [docs/public-frogsleep-invites.md](docs/public-frogsleep-invites.md)。

FrogSleep push 使用 Zook 通知队列，设备来源是 `/api/v1/frogsleep/devices` 注册的 app-scoped 设备。当前支持的 payload 类型包括：

- `sleep_buddy_invite`
- `shared_session_invite`
- `shared_session_interrupted`
- `shared_session_returned`
- `morning_summary`
- `focus_buddy_invite`
- `focus_achievement`

睡眠 session 邀请、恢复动态与晨报推送在入队及投递前读取接收方的最新关系和偏好：`mute_for_tonight=true` 抑制这些推送，`allow_recovery_nudges=false` 抑制 interrupted/returned，`allow_morning_summary_push=false` 抑制晨报。已入队后关闭偏好也会抑制投递；这些设置不阻止个人流程或共享事件/晨报保存。

通知任务只有提供方成功接受后才记录 `SENT`，不代表设备已经展示。无有效设备或投递被禁止时记录 `SUPPRESSED`；缺少 APNs/FCM 配置或目标平台 dispatcher 时记录 `FAILED` 并保留 failed-event 补偿，日志回退不能算作发送成功。恢复配置后，worker 可重投失败事件。

APNs / FCM 返回不可恢复的无效 token 错误时，服务端会仅将当前 app、当前用户、当前 push token 对应的 FrogSleep device 软删除或禁用，后续不会继续向该无效 token 发送；provider 429/5xx 等可重试错误仍保留原有 failed event / retry 行为，不会清理设备。

## 9. 统一响应格式

成功响应：

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

失败响应：

```json
{
  "code": "AUTH_INVALID_TOKEN",
  "message": "Bearer token is expired or malformed.",
  "data": null,
  "requestId": "req_xxx"
}
```

客户端应优先根据 `HTTP Status + code` 做分支处理。

## 10. 常用错误码

| HTTP Status | code                                | 说明                                 |
| ----------- | ----------------------------------- | ------------------------------------ |
| `400`       | `REQ_INVALID_BODY`                  | 请求体不合法或缺字段                 |
| `400`       | `REQ_INVALID_QUERY`                 | 查询参数不合法                       |
| `404`       | `REQ_ROUTE_NOT_FOUND`               | 请求路径不存在或当前环境未开放       |
| `401`       | `AUTH_BEARER_REQUIRED`              | 缺失 Bearer Token                    |
| `401`       | `AUTH_INVALID_TOKEN`                | Token 非法、签名错误或过期           |
| `401`       | `AUTH_REFRESH_TOKEN_REQUIRED`       | 需要 Refresh Token 但未提供          |
| `401`       | `AUTH_REFRESH_TOKEN_REVOKED`        | Refresh Token 已失效或已撤销         |
| `401`       | `AUTH_VERIFICATION_CODE_REQUIRED`   | 验证码缺失                           |
| `401`       | `AUTH_VERIFICATION_CODE_INVALID`    | 验证码错误、过期或已失效             |
| `401`       | `AUTH_ACCOUNT_NOT_FOUND`            | 账号不存在                           |
| `401`       | `AUTH_PASSWORD_NOT_SET`             | 账号未设置密码                       |
| `401`       | `AUTH_QR_LOGIN_TOKEN_REQUIRED`      | 扫码登录所需的一次性 token 缺失      |
| `401`       | `AUTH_QR_LOGIN_INVALID`             | 扫码登录会话或 token 非法            |
| `401`       | `AUTH_QR_LOGIN_EXPIRED`             | 扫码登录二维码已过期                 |
| `401`       | `AUTH_ONE_CLICK_TOKEN_INVALID`      | 一键登录 token 非法或已失效          |
| `403`       | `AUTH_APP_SCOPE_MISMATCH`           | Header、Path、Token 的产品标识不一致 |
| `403`       | `IAM_PERMISSION_DENIED`             | 当前用户没有对应权限                 |
| `409`       | `AUTH_ACCOUNT_ALREADY_EXISTS`       | 邮箱已注册                           |
| `409`       | `AUTH_QR_LOGIN_ALREADY_USED`        | 扫码登录会话已确认或已消费           |
| `429`       | `AUTH_RATE_LIMITED`                 | 提交频率过高                         |
| `503`       | `ONE_CLICK_SERVICE_NOT_CONFIGURED`  | 一键登录服务未配置                   |
| `502`       | `ONE_CLICK_PROVIDER_REQUEST_FAILED` | 个验服务端校验失败或不可用           |
| `500`       | `SYS_INTERNAL_ERROR`                | 服务端内部异常                       |

## 11. FrogSleep 统一搭子邀请（canonical）

统一入口覆盖睡眠、专注及组合邀请。所有请求均使用 FrogSleep Bearer Token：

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/frogsleep/buddy/invitations` | 通过邮箱或 FrogSleep user ID 创建邀请 |
| `GET` | `/api/v1/frogsleep/buddy/invitations?direction=incoming\|outgoing` | 当前账号收件箱/发件箱 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/preview?code=...` | 按手工码预览 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/preview?token=...` | 按链接 token 预览 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/{invitationId}` | 按 ID 预览 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{invitationId}/accept` | 显式同意并建立所选领域关系 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{invitationId}/decline` | 拒绝 |
| `POST` | `/api/v1/frogsleep/buddy/invitations/{invitationId}/cancel` | 发起人取消 |
| `GET` | `/api/v1/frogsleep/buddy/invitations/{invitationId}/delivery` | 发起人查看邮件投递状态 |

创建请求：

```json
{
  "target": { "email": "buddy@example.com" },
  "domains": ["sleep", "focus"]
}
```

`target` 也可为 `{"user_id":"..."}` 或兼容字符串。邮箱统一去空格并转小写；响应不会披露该邮箱是否已注册。成功响应的 `data` 包含 `invitation_id`、`domains`、`version`、`share_code`、HTTPS `share_link`、`expires_at`、`domain_results` 和可选 `delivery`。邮件状态为 `queued`、`processing`、`provider_accepted`、`delivered`、`bounced`、`suppressed`、`retryable_failed` 或 `dead_letter`；邮件失败不使 code/link 失效。

接受请求必须携带创建/预览响应中的版本和调用方生成的稳定幂等键：

```json
{
  "expected_version": 1,
  "idempotency_key": "client-generated-stable-key",
  "sharing_categories": ["presence", "daily_summary"]
}
```

响应 `results` 按 `sleep`/`focus` 返回 `relationship_id`、`status` 和可选 `error_code`。只有已绑定用户或已验证邮箱与邀请邮箱一致的账号可以预览/接受；未授权和不存在统一使用隐私安全的 `404 REQ_ROUTE_NOT_FOUND`。版本或终态冲突返回 `409 REQ_INVALID_BODY`，限流返回 `429 AUTH_RATE_LIMITED`。

公开 handoff `GET /frogsleep/buddy-invitation?token=...` 返回 `no-store` 的安全页面，尝试打开 `frogsleep://buddy-invitation` 并提供手工码路径，不展示邮箱或用户资料。

以下路径仅为兼容旧客户端的非 canonical 路径，新接入不得使用：`/api/v1/frogsleep/sleep-buddy/invites*`、`/api/v1/frogsleep/focus-buddy/invites*`、`/frogsleep/sleep-buddy-invite`、`/frogsleep/focus-invite`。

### LightTick 周承诺状态

`GET /api/v1/lighttick/onboarding/commitment` 返回当前鉴权账户的 `{ commitment_mode, valid_action_count, required_action_count: 2, eligible }`。未选择或无 profile 时 mode 为 null。模式为 recovery/light/standard/sprint；读取无副作用，访客可用，账户隔离。计数与 POST 使用相同有效行动规则，deep_planning 不改写 eligible。

LightTick 周承诺保存仍要求两次有效行动（或用户明确 deep_planning）；无 profile 时返回 404，不再返回未实际保存的成功。客户端仅在写入成功后更新选择，失败保留原值；重启从 GET 恢复，不用当日完成项推算累计资格。新客户端应在此接口部署后启用；旧服务不支持 GET 时显示“暂时无法核对本周投入”并保留其他 Journey 能力。

### 对话规划会话（P2，默认关闭）

启用服务器环境变量 `LIGHTTICK_CONVERSATIONAL_PLANNING_ENABLED=1` 后可调用下列接口；仍需 LightTick 注册用户 token 和有效 app membership，游客不可使用。未启用返回 503 `LIGHTTICK_APP_DISABLED`。这些接口创建新的计划周期，调整的是本会话尚未确认的草案，确认不会自动撤销现有活跃计划。

| 方法与路径（前缀 /api/v1/lighttick） | 请求与结果 |
| --- | --- |
| POST /planning-sessions | `{goal_id}`，返回 201 `{session,run:null}`；thread_id 由服务器生成 |
| GET /planning-sessions/{id} | 返回当前 session，供重启、跨设备恢复 |
| POST /planning-sessions/{id}/messages | `{base_version,message}`，返回 202 `{session,run}` |
| PATCH /planning-sessions/{id}/context | `{base_version,fields:{字段:{value,source}}}`，返回更新后的 session |
| POST /planning-sessions/{id}/drafts | `{base_version,context_revision,instruction?,deep_planning?}`，返回 202；instruction 用于调整当前草案 |
| POST /planning-sessions/{id}/confirm | `{base_version,context_revision,draft_plan_id,plan_version}`，原子生成执行任务并返回 confirmed session |

所有写请求必须带 `Idempotency-Key`（非空，最多 128 字符）。同 key 同请求重放同一结果；不同请求返回 409 `LIGHTTICK_IDEMPOTENCY_MISMATCH`。读取最新版本后执行新操作应使用新 key。异步请求中的 run 包含 id/status/scene/prompt_version，可继续使用已有 GET /api/v1/lighttick/runs/{id} 查询；完成后重新读取 session，草案通过已有计划读取接口获取。消息保存到 session.thread_id 对应的已有聊天记录。

摘要 context 允许 objective、outcome、experience、available_minutes、period_start、period_end、constraints。每项包含 value、source，可含服务器记录的 source_message_id。来源为 user / confirmed / imported / assumption；用户 PATCH 只允许 user 或 confirmed。模型仅填充缺失项或 assumption，不覆盖已确认和导入的信息。available_minutes 为周期总分钟数（1–10080）；objective/outcome 最多 200 字符，其他文本最多 1000；日期必须是合法 YYYY-MM-DD，周期有序且跨度不超过 90 天。

状态为 collecting / ready / generating / draft_ready / confirmed。明确的 objective、available_minutes、起止日期全部具备才可生成；必要字段的 assumption 必须先显式确认。questions 最多两条，两轮澄清后留给客户端展示摘要编辑入口。can_generate 为服务器计算值。生成还需已有周承诺资格、已启用 commitment_mode，或本次明确选择 deep_planning:true；该选项不替用户保存周承诺。

会话 version 用于 CAS，context_revision 用于草案有效性。生成中修改摘要可成功，但本次生成随后被判为失效；active_run_id 清除后才能再次生成。调整生成得到新的 draft_plan_id；旧草案不能通过通用计划确认接口绕过检查。草案有效期为生成后 7 天。确认时检查 owner、目标、摘要版本、草案、目标和活跃计划/任务版本；任何冲突都不产生执行任务。

409 错误：LIGHTTICK_VERSION_CONFLICT（重读并重新预览）、LIGHTTICK_PLANNING_BUSY（等待当前 run）、LIGHTTICK_PLANNING_NOT_READY（补充并确认摘要）、LIGHTTICK_PLANNING_STALE（旧/过期草案，重新生成）、LIGHTTICK_STATE_TRANSITION_INVALID（解锁或目标状态不允许）。异步失败通过 session.last_error 和 run.error_code 返回 LIGHTTICK_AI_UNAVAILABLE 或 LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE；保留输入，不用通用模板伪造对话规划成功。客户端缩短摘要后以新 key 重试。

Canonical OpenAPI 与生成模型已同步；跨端错误/并发样例见 `api-contracts/fixtures/lighttick/planning-errors.json`。本阶段尚未接入 iOS/Android 会话 UI。

Android HttpURLConnection 可对会话 context 使用 POST + X-HTTP-Method-Override: PATCH；其他会话操作不接受方法覆盖。


### LightTick App 规划、执行与复盘闭环

- 注册用户可先 `POST /api/v1/lighttick/goals`，提交 `title` 与 `constraints: {}` 保存草稿目标，再创建 PlanningSession；无需先生成或完成启动任务。预算、日期仍须在规划会话内明确，未知不填默认事实。游客升级与对话规划开关约束保持不变。
- `GET /plans`、`GET /plans/{id}` 的 `proposal.tasks[]` 保留内部字段 `title/estimatedMinutes/priority/scheduledFor`，新增可选 `completionCriteria`、`steps: string[]` 与 `guidance`。`guidance` 包含可选 `purpose`、`materials: string[]`、`expected_output`。草案同时保留 `summary` 与 `assumptions`。
- 确认仍需版本与幂等保护。确认事务把完成标准、指导材料和有序步骤保存到任务；`GET /today` 与任务读取返回 `completion_criteria`、`guidance`、已有的 `steps` 对象数组。指导文本和步骤单项最长 1000 字符，步骤最多 12 项，材料最多 10 项。旧草案可缺省这些字段。
- Today 汇总各活跃计划中属于用户业务日的任务；确认未来周期不会隐藏今天任务。`YYYY-MM-DD` 排期按业务日期比较，带时区时间戳按 profile 时区转换。无排期任务只在所属计划周期内展示；已完成/归档目标不再出现可执行任务。
- `POST /api/v1/lighttick/review-runs` 的 `period` 支持 `daily/weekly/monthly`。日期必须真实有效，daily 要求 `period_start == period_end`。日期窗口按 profile 的 IANA 时区解释。复盘只使用当前目标的执行事件，创建目标/编辑目标不计作执行样本；日复盘至少一个完成/跳过/延期/取消事实，周/月至少三个，此充分性仅指执行回顾，不代表能力或成果达标。
- Review `facts` 包含 `timezone/goal_id/event_counts/tasks/source_event_ids/outcome_status`。未知实际时长为 null，`outcome_status` 为 unverified；私人任务备注不会隐式送入 AI。用户可通过既有 `self_reflection`（最多 4000 字符）主动补充愿意用于 AI 复盘的信息。生成 run 显式关联 review_id。窗口中事实新增后会生成新复盘快照，旧结果保留；同一 Idempotency-Key 重放仍返回原操作。
- `POST /change-proposal-runs` 可传 `review_id` 让调整引用该复盘，引用必须属于计划的目标；可选 `goal_id` 也须匹配。跨目标引用返回 422 `LIGHTTICK_PLAN_CONSTRAINT_FAILED`，找不到复盘返回 404。
- 接受 `/reviews/{id}/actions` 的建议只创建 `proposed_plan`，响应和 `action_state.proposed_plan_id` 可用于重新打开草案。新周期从用户本地今日与复盘结束次日的较晚者起算，不把任务排回已结束窗口；仍须用户显式确认后才进入 Today。原任务完成事实保持不变。
- 本轮未改变鉴权、app scope 和公共路径；指导字段存储依赖增量迁移 `064_lighttick_task_guidance.sql`。部署迁移及后端后再启用新客户端能力。完整顺序和验证边界见 `docs/lighttick/app-loop-integration.md`。


### LightTick 通用规划与个人复盘（2026-09-19）

- `GET /api/v1/lighttick/reflections?goal_id=...`：返回该目标已保存个人复盘，`data.items` 按更新时间倒序。需要注册 LightTick membership，与其他产品/用户隔离。
- `PUT /api/v1/lighttick/reflections/{reflectionId}`：客户端生成8–128字符字母/数字/下划线/连字符ID；body 为 `goal_id, period_start, period_end, content, base_version`，可选 `plan_id, next_action`。正文1–4000字符（不可纯空白），下一步最多1000字符；日期为有效 YYYY-MM-DD 且起止有序。`base_version=0`新建，后续使用服务端版本；相同请求响应丢失重放返回已保存版本，其他旧版本写入409。返回 `data` 包含id、原文、下一步、范围、version、created_at、updated_at。goal不可跨记录改绑，plan必须属于同目标。保存不调用AI、不创建待办。删除LightTick账户同时删除这些记录。
- `POST /api/v1/lighttick/review-runs`：原有daily/weekly/monthly兼容；新增可选 `plan_id`，要求属于goal且起止日期与计划一致，只聚合此计划。省略时按目标与日期聚合；过去七天由客户端明确提交滚动日期，不等于自然周。新增可选`next_action`（最多1000字符），与显式`self_reflection`一起分析，但不会直接执行。每个新Idempotency-Key生成独立review；重放同key返回同run。已保存笔记和私人任务备注不会被自动读取给模型。
- review facts新增`scope`、可选`plan_id/plan_version`、`planned_tasks`与`snapshot_at`。`current_status`是生成时状态，不是历史窗口内完成数；窗口事件仍为`source_event_ids/event_counts`。AI输出与个人原文分开保存，所有调整仍须显式确认。
- 计划确认事务检查同目标、同本地日期的规范化重复任务标题，含草案内部重复；409 `LIGHTTICK_PLAN_CONSTRAINT_FAILED` 时修改草案或使用已有任务的调整提案。不同日期的重复练习仍允许；不是语义查重或跨目标预算承诺。
- 历史分析按生成时间倒序展示。服务端笔记保存与原生本地草稿是两种状态，离线不能显示已云端保存。

### FrogSleep 2A：统一邀请分域决策（2026-10-11）

`GET /api/v1/frogsleep/buddy/invitations/{inviteId}` 与 `.../preview` 的 `domain_results` 现在包含每个域自己的 `status`、`relationship_id`、`decision_version` 和 `viewer_actions`。预览只读，不绑定收件人或建立关系；不能用组合邀请的 `version/status` 代替某一域的决策。终态域没有接受/拒绝/取消动作，另一个 pending 域可以继续处理。旧兼容决策可能不含 `decision_version`。

| 操作 | canonical 路径 | 操作者 |
|---|---|---|
| 接受单域 | `POST /api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{sleep|focus}/accept` | 收件账号 |
| 拒绝单域 | 同上末段 `/decline` | 收件账号 |
| 取消单域 | 同上末段 `/cancel` | 邀请人，包括对方尚未注册的情况 |

请求为 `{"expected_version":1,"idempotency_key":"persisted-command-key"}`。客户端在发送前保存请求身份；相同动作重试复用原 key 和原版本。成功回执含 `invitation_id/domain/decision_status/decision_version`，accept 另含原始 `relationship_id` 和其当前 `relationship_status`。相同 key 的回放不重复写关系、slot、授权或通知事件；错版本、不同 key 的终态写入及竞争失败为 409。接受回放读取决策保存的原关系，不读取当前 slot，关系被解除后也不会重新激活。

未绑定的邮箱邀请只允许当前收件邮箱对应账号显式接受/拒绝时绑定。错误账号、错误角色和不存在的邀请统一返回中性的 `404 REQ_ROUTE_NOT_FOUND`，回放也重新检查角色和 active app membership；客户端保留 locator，登录正确账号后重新预览，不自动接受。code 支持首尾空白及大小写规范化。accept 仍受普通邀请 capability 控制，decline/cancel 保持能力关闭时可用。

单域 accept 建立 canonical 域关系与两端 slot，**不隐含共享授权**；共享仍需后续独立授权。旧整单接口保留已发布客户端的授权语义，已由新协议决策的邀请禁止再用整单操作改变 sibling；新旧接受共用用户/域 slot 锁并检查既有旧关系，避免不同邀请重复建立同域关系。兼容回放必须由原操作角色执行。

迁移 `022_frogsleep_invitation_relationship_receipt.sql` 持久化原始关系回执；历史回填仅匹配同 app、域、账号对和决定时间的唯一关系，无法确认时返回冲突，绝不猜测当前搭子。详情和本机证据见 [邀请专题](docs/public-frogsleep-invites.md) 与 [2A 验证记录](docs/frogsleep-phase2a-invitation-closeout-verification-2026-10-11.md)。


### FrogSleep 2A 方向授权与关系生命周期（2026-10-11）

新邀请建立的 canonical 关系和旧兼容关系共用以下入口，鉴权为 FrogSleep active membership，安全/撤权操作不依赖 discovery flags。pending Focus 邀请关系不能通过这些入口转换为 accepted，仍须走邀请决策。

| Method | Canonical path | 行为 |
| --- | --- | --- |
| GET | `/api/v1/frogsleep/buddy/relationships` | 当前 active/paused 的 Sleep、Focus 关系元数据 |
| GET | `/api/v1/frogsleep/buddy/relationships/{id}` | 本人关系快照及 terminal receipt |
| POST | `/api/v1/frogsleep/buddy/relationships/{id}/{pause,resume,revoke,mute,unmute}` | body `{"expected_version":1}`；成功返回关系快照 |
| GET | `/api/v1/frogsleep/buddy/relationships/{id}/grants` | `viewer_user_id` 与双方独立授权；允许 paused 状态读取授权元数据 |
| PUT | `/api/v1/frogsleep/buddy/relationships/{id}/grants` | 原子替换当前 token 授权人向另一方的选择 |

关系快照包含 `id/viewer_user_id/partner_user_id/domain/status/version/paused_by_user_ids/is_muted`。暂停按参与人分别记录；恢复只移除本人暂停，另一个参与人仍暂停时返回 paused。旧 Sleep resume 也遵循这一安全规则，不能替对方恢复。历史 paused 缺少操作人时按双方暂停保守处理。新统一端点重复已经生效的 pause/resume/revoke 不增加版本；旧 Focus revoke 保留既有重复请求 400 行为。终止关系不能恢复，需新邀请。解除只释放仍指向旧关系的 slot，旧回放不得触碰新搭子的 slot。

PUT 授权示例：

```json
{"domain":"sleep","categories":["presence","daily_summary"],"expected_versions":{"presence":0,"daily_summary":0,"weekly_trend":0,"shared_activity":0}}
```

必须传全部四个类别的原版本。不存在的授权以 revoked/version 0 的只读默认项呈现，不在 GET 时写库；首次授予后为 version 1。当前服务端从 token 推导授权人，不接受外部指定 grantor，不能改变另一方向。批次在双方 domain slot 锁中重验关系及全部版本，再写授权/审计；冲突或审计失败整批回滚。授权变更不修改关系 version；paused 可撤销已有授权，新增授予需要 active。撤销 shared_activity 会关闭既有共享协调会话；daily_summary/weekly_trend 读时即时过滤。A→B 授权只允许 B 读取 A，不隐含 B→A；A 发布自己的摘要以 A→B 的授权为准。只有既有旧关系保留历史无 grant 记录的兼容回填，新关系永不隐式授予。

静默是本人按关系的通知偏好，不撤销共享授权；不修改旧睡眠守护配置。Buddy worker 每次尝试（含 retry）重验真实目标类型/ID、收件人、过期、关系 active、当前方向类别和本人静默，再物化通知/入 Push 队列。旧共享睡眠通知入队前也重验相同权限和静默。通知 route 在每次打开时重新验权，GET 不以历史通知或仅 target 存在作为授权，撤权/暂停/解除/拉黑后的旧通知不会绕过保护。新报告/里程碑/目标路由键分别为 `report_id/milestone_id/goal_id`，旧 `interaction_id` 仅在指向同一个真实目标且类型一致时兼容。

解除和双边拉黑会撤销该关系双方授权、结束共享 Sleep/joint activity 协调会话；拉黑覆盖同一参与人对的 Sleep/Focus 及兼容关系，解除拉黑不复活关系、授权或会话。私人 Sleep/Focus 历史不受影响。403/404 表示不可访问，409 为版本冲突或关系终态，客户端先清共享缓存再重新取数；网络失败不得显示操作成功。

本机实现/测试证据见 [生命周期验证记录](docs/frogsleep-phase2a-lifecycle-closeout-verification-2026-10-11.md)。实际 provider 重试、已进入通用 Push 队列的投递门槛、dev/真机和发布仍属于未完成的 2.3/§3 验收。


### 2A 双账号专注与共同守护旅程（2026-10-11）

统一邀请产生的 canonical Focus 关系直接投影到旧 current-relationship、比较和 shared-moments 读端，兼容输出 accepted，但不写入另一份旧关系。所有共享读端继续按当前方向授权重新验权。私人专注原子上报先提交本人记录；共享派生失败不把个人成功变成错误。完成/回放时在关系双方 slot 锁中重验 active 与双向 shared_activity，按关系和两个服务端 session ID 生成唯一时刻，旧时刻也按原 pair 去重；回放可补派生，不能重复累计个人统计。

shared-moments 每项增加稳定UUID `moment_id`、`server_moment_id`、查看者自己的 `my_session_id` 与对方的 `viewer_buddy_session_id`，以及交叠 `start_time`/`overlap_minutes`。保留 `session_id`/`buddy_session_id` 原服务端引用。没有client ID时使用server ID；这些是兼容读取字段，不改变私人上报身份或承诺多设备版本冲突解决。

共享 Sleep 事件增加 `sleep_started`、`ritual_completed`，兼容客户端个人开始/仪式完成的共享镜像。共享状态只描述双方协调：一个参与人morning_completed或paused_tonight后session仍允许另一人独立完成；双方都进入morning_completed/paused_tonight终态后session才completed。单方暂停不覆盖另一人的晨间结果。terminal不接受新流程事件；重复accept及同参与人重复终态acknowledgement返回原状态、不重置完成标记，相同 actor/type/规范化 occurred_at 的非终态重试不增加事件。每个 session 每个查看者维护一个summary和一个recap，第二个人未确认不能显示晨间已完成。旧单主recap根据存储的participant_states重投影；缺少查看者上下文返回redacted。

读取 status snapshot/latest summary/recap 每次验证当前 daily_summary，redacted 占位不应解码为普通晨报或完成。断网与401仅影响共享和该身份的网络同步；个人本地计时、历史与固定owner队列保留。客户端本次共享请求重试保留进程内原session/事件时间，重启后的共享持久化恢复属于2B，未在此承诺。

本机双账号真实HTTP、PG及iOS证据与复现步骤见 [旅程验证记录](docs/frogsleep-phase2a-two-account-journey-verification-2026-10-11.md)。当前dev/真机/provider发布验收仍未完成。


### 2A 通知投递、重试与站内回退（2026-10-11）

通知feed的`id`是站内列表、Push payload的`notification_id`及route/read使用的同一稳定身份。`GET /api/v1/frogsleep/buddy/notifications`提供当前登录人的分页元数据，不依赖设备或系统通知授权；不能把历史safe route当作当前授权，打开必须调用`.../{id}/route`。客户端已读后再次resolve，再检查账号/缓存代际，撤权或身份切换期间不得导航。重复read保留首次已读时间，重复打开不重复站内记录。

Buddy outbox与通用Push job按稳定身份和跨进程session锁串行。outbox重放始终沿用同一逻辑job，只有一条in_app与逻辑Push记录；worker在重试时重新计算当前禁用类别、静默、静音时段、冷却/预算（排除自身通知），不以原attempt跳过。进入通用队列及failed_event之后，每次实际发送、每个设备发送前仍重验app membership、当前目标、关系/方向授权、静默、Push开关和设备归属。数据库故障不被当作授权拒绝而静默丢弃。

设备确认成功、永久拒绝、processing及outcome_unknown回执写入原job的内部`_frogsleep_delivery` JSON，key只保存app/owner/platform/token哈希，不增加token明文副本。确认成功设备不会重发，失败设备继续按原job重试，provider attempt最多5次，每job至多一个待重放failed_event，已关闭或预算耗尽不会再重放。发送前先持久化processing，崩溃恢复或传输响应丢失变为`PROVIDER_OUTCOME_UNKNOWN`，停止自动重发并保留站内回退；不能把未知结果说成成功，也不保证外部provider物理恰好一次。

outbox `delivered`只表示站内/队列协调已收口；内部通用job `SENT`表示该任务停止自动处理，须结合内部outcome看provider接受、抑制、无设备或结果未知。逻辑Push delivery成功使用`provider_accepted`，不当作设备已展示；in_app `delivered`表示站内物化。无有效设备为`NO_ACTIVE_DEVICES`，不制造provider失败事件；无配置provider、可重试provider拒绝、永久设备错误与结果未知分别记录，不使用logging-only当成功。永久无效token只清当前app/owner/device，不清另一账号或app。

`POST /api/v1/frogsleep/devices`按认证账号绑定(app_id,platform,push_token)唯一活跃身份；新账号注册同token会转移归属，旧账号不能删除新主记录。068迁移扩展逻辑delivery的provider_accepted状态，069迁移保留每app/platform/token最近注册，软删除旧活跃重复，建立partial unique index；不改其他app的设备归属，不猜测guest绑定。

邮件worker每次claim/重试检查开关、有效邀请/邀请人及已绑定收件人的禁用类别/拉黑。已provider_accepted不再次投递，SES callback才更新delivered。过期processing及已发请求后响应未知进入`dead_letter/PROVIDER_OUTCOME_UNKNOWN`，等待核查，不盲目自动重发；已知可重试失败最多5次，配置/永久拒绝停止。静音时段是Push中断偏好，不自动静默异步邮件；总禁用/邀请类别禁用适用于已绑定收件人的邮件。

本机测试/迁移/复现见[通知收口验证记录](docs/frogsleep-phase2a-notification-closeout-verification-2026-10-11.md)。邮件真实送达、APNs/FCM当前配置、真机deep link及dev/发布仍须单独验证。

设备历史若最新注册时间并列，069停止这些冲突token的活跃绑定，等待当前账号显式重新注册；不通过随机ID猜当前使用人。PG已验证并列停用、重新注册与旧主不能删除新主。

### Sleep 私人报告同步（2026-10-11）

个人报告 API 以稳定 snapshot_id 幂等保存；新增本人 detail/PUT/DELETE、personal-sync/state、固定边界 restore、提交有序 changes，并将 report_preferences 接入相同修订协议。历史 GET 使用完整数据库分页，无前500条截断。写入支持 X-Sync-Epoch、Idempotency-Key、If-Match，409冲突/410墓碑不可盲目覆盖或复活。旧无epoch兼容仅限未重建的账号。范围已扩展到原始终态睡眠、报告和报告偏好，并支持独立凭据的游客云升级；客户端2B恢复仍需双端验收。接入细则、保留策略、开关和回滚见 [私人同步专题](docs/public-frogsleep-personal-sync.md)。

### FrogSleep 共享读取的身份与撤权边界

`/api/v1/frogsleep/buddy/relationships/:id/grants` 与受保护摘要读取使用关系参与者、域和定向 grant 校验。共享读取在初次授权查询后重新检查关系仍 active/accepted、双方未屏蔽、授权仍 granted 且版本未变化；读取途中暂停、解除、撤权或撤权再授权，旧读取不得凭最初状态放行。使用现有 403/404 安全错误或摘要 redacted 占位，不新增对第三方可见的关系详情。

本次校验不承诺撤回已发送的 HTTP 字节；客户端必须在 UI 和持久缓存提交前复核账号、关系/授权代次、请求序号及期限。A→B→A 或撤权→恢复均不能复用旧请求。新读取可使用新授权重新获取。客户端本地搭子开关关闭应取消同步并清共享缓存；服务端能力开关停用普通增长/通知路径时，暂停、撤销等安全命令仍应可用。单域接受与 grant 是独立协议动作，Bundle 不能隐式授予另一个域。

### FrogSleep 二期：游客绑定上传及账号删除（A03/A10）

沿用 `POST /api/v1/frogsleep/focus/sessions` 与 `POST /api/v1/frogsleep/product-data/sleep-reports`，不增加并行上传通道。上传 owner 始终来自 FrogSleep 会话；可选 `owner_user_id` / `ownerUserId` / `user_id` / `userId` 若与登录主体不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`，不能把旧账号作业改归当前账号。

- 专注历史记录提供稳定 `session_id`（兼容 `sessionId`），按账号+类型+记录 ID 去重；相同内容重试返回原结果。带 `binding` 的 completed/abandoned/interrupted/cancelled 确认导入记录内容不可变，更换终态内容返回 `409 REQ_INVALID_BODY`；未带 `binding` 的既有专注上报仍支持同 ID 修正并保留服务端 ID 和创建时间。睡眠报告使用稳定 `snapshot_id`（兼容 report_id/id），统一保存在私人同步仓库；相同内容幂等重试，修正已有报告必须通过私人同步协议携带当前 revision，否则返回 `409 FROGSLEEP_SYNC_REVISION_CONFLICT`。不同账号的相同本机 ID 互不覆盖。查重不受列表分页限制。
- 可选 `binding: {owner_user_id, job_id, confirmed_at}` 表示用户确认的导入作业。owner 必须等于当前主体；job_id 非空，confirmed_at 为 ISO 时间。更换作业 ID不会重复导入同一条记录。绑定专注记录必须是终态、有稳定 ID和原始开始/结束时间，否则返回400。客户端只发送用户确认的类别、日期与记录；设备状态、未完成锁定和运行中会话不迁移。服务端不能以这份 metadata 代替客户端的真实确认界面。
- 旧专注调用未提供记录 ID 时保留 append 行为；运行中状态仍走原有通道，不以终态去重规则改变生命周期。绑定上传不得使用这个兼容分支。存量已重复的数据不在本次自动删除。
- `DELETE /api/v1/frogsleep/me/account` 保持既有响应，清理 FrogSleep 数据并撤销其凭据，保留 Zook 全局身份和其他产品。新增清理规范化分域关系、双方授权、邀请决定/邮件任务、相关通知；释放搭子的领域占位并推进版本。清理与 membership 更新在事务内完成，数据库失败回滚。删除与领域命令使用同一 slot 锁边界；旧接受重放不能恢复已删除关系。
- 删除成功后旧 token 再次请求返回401，不提供使用失效 token 的成功重放；数据清理可重复执行且无跨产品副作用。外部提供方已接收的邮件/推送不能撤回，待发送任务清理及发送前权限校验仍是边界。以上本地测试不等同于生产部署或双端整体联调。


### 2026-10-18 整合后的 Sleep 边界补充

- `GET /api/v1/frogsleep/focus-buddy/stats/week`（以及兼容 `/focus/stats/week`）支持 `week_start` / `weekStart`，按该周返回统计；非法日期返回400。
- `GET /api/v1/frogsleep/product-data/sleep-reports` 的 `since` 严格筛选 `recorded_at > since`，游标绑定该筛选和固定读取边界；后续分页须重复同一时间（等价ISO表达可规范化）。筛选改变返回409，非法时间返回400。`since` 仅为报告时间筛选；修改/删除增量必须使用 `personal-sync/changes`。
- canonical关系接受后会持久化双方共八条 `revoked/version=1` 授权。PUT前必须先GET本人当前grant版本，不能固定传0；仅尚不存在的只读默认项为version0。默认revoked不代表已共享。
- 未授予共享时守护状态可显示关系，活动共享session为空；完成晨间确认的参与者不能重新accept覆盖终态。通知在入队和实际投递前重验接收方睡眠偏好。
- 共同目标调整不能跨Sleep/Focus域；共同活动必须双方完成真实记录才计完成。周报进度来自终态专注和本人晨间确认，不采信客户端声明的累计贡献。撤权后目标列表省略不可访问项，活动命令仍拒绝。

能力范围、分支整合及当前验证限制见 [Sleep审计](docs/sleep-api-capability-audit-2026-10-18.md)。

### FrogSleep 首次共同完成（P0，本地未发布）

- 搭子中心、目标、专注与睡眠读取同一逐域关系事实；新关系默认关闭各类分享，显式授权后才可操作。活动/目标必须匹配关系域，`adjust` 也校验。
- `POST /api/v1/frogsleep/buddy/joint-activities/{activityId}/start`：接受后参与者各自开始，开始时间持久化、重试不重置。接受后有效期36小时；先完成或由发起人取消当前活动，再开始新的同域活动。
- `payload.participant_progress` 按用户 ID 返回 `status: pending|started|completed`、`completed_at`、`minutes`。只有双方实际完成才更新活动 `completed` 并产生去重通知。接受、点击完成或暂停今晚均不等于共同完成。
- 专注按开始后真实 `completed` 会话且分钟达到 `planned_minutes`；`session_id` 是当前账号内稳定身份，重传返回已有记录，不重复计数。分钟上限取上报分钟与实际起止时长较小值，未来/未完成源不计。睡眠按本人 `morning_completed` 原始事件，不用对方摘要推定。
- 目标只累计双方接受之后、目标时间窗内的对应域真实记录。分钟求和；天数以目标时区自然日去重；鼓励按发送自然日去重。`sleep_schedule_days` 当前表示完成共同睡眠的天数，不代表按时入睡，三端显示为共同睡眠天数。暂停后冻结截止时间，双方达标自动完成。
- 共同活动读取与目标读取可修复离线重试后遗漏的衍生状态；真实会话写入同样触发刷新。撤权/解除后不返回受保护内容，个人专注保存不依赖共享权限。


追加整合：共同目标从双方接受时开始计数，暂停后冻结进度；共同活动以真实完成时间归属周窗口，超过期限且未完成才失效。共同睡眠按每位参与者持久化的事件时间归属完成事实，之后另一人的事件不能改写先完成者的日期。canonical关系（包括已撤销关系）遮蔽同一参与者/域的旧兼容关系，避免旧记录重新显示或绕过撤权；解除/拉黑仍清理被遮蔽的旧事实。私人专注列表及周统计读取完整数据库记录，不因旧500/200条上限截断。

### FrogSleep 原始睡眠同步与可信游客升级

原始睡眠 `sleep-sessions` 支持 completed/cancelled/interrupted 终态、结构化事件和128 KiB以内私有历史；所有写入/删除必填 X-Sync-Epoch、Idempotency-Key，修正/删除要求 If-Match。单条响应为 data.sleep_session；分页和统一 restore/changes 包含 sleep_session 种类及墓碑，不能恢复为活动设备锁。详见 [私人同步协议](docs/public-frogsleep-personal-sync.md)。游客凭据只以哈希持久化，来源与目标锁定后一次迁移，最多10,000个最新资源/32 MiB，不截断。独立凭据、明确确认、回执重试及会话撤销见 [游客升级协议](docs/public-frogsleep-guest-upgrade.md)。

### FrogSleep 浏览器同步预检

允许的 Web Origin 发起 `OPTIONS` 预检后，服务端允许 `GET/POST/PUT/PATCH/DELETE/OPTIONS`。个人同步的 `Authorization`、`Content-Type`、`X-Sync-Epoch`、`Idempotency-Key`、`If-Match` 可用于跨域请求；响应会反映浏览器声明的请求头，默认请求头列表也包含这三个同步头。`PUT` 修正睡眠原始记录、报告和偏好不应被浏览器预检拦截。Origin allowlist、鉴权和账号归属规则仍独立生效。原始记录和升级协议见 [私人同步](docs/public-frogsleep-personal-sync.md) 与 [游客升级](docs/public-frogsleep-guest-upgrade.md)。

私人同步与游客创建/升级由资源服务拥有数据库事务，HTTP 错误转换在其提交/回滚之后执行；升级冲突不能留下已迁入的部分记录。SQL 提交后才撤销游客会话；会话清理失败时可保留原请求重试，不能把5xx视为未提交。dev 专项入口与可删账号边界见 [验收记录](docs/frogsleep-dev-personal-sync-acceptance-2026-10-18.md)。


## LightTick 共享行动计划

新增 `/api/v1/lighttick/action-plans`、`/action-plans/{id}/operations`、执行记录、复盘及AI历史、日历、`/action-link-tickets` 和受信 `/grow-bridge`。正式账号公共登录鉴权；功能开关 `LIGHTTICK_ACTIONS_ENABLED=1`，未开启返回503。完整方法、字段、幂等、签名、接管恢复与错误语义见 [共享行动计划接入](docs/public-lighttick-actions.md) 和 canonical OpenAPI。

### LightTick 独立记录（Grow I1）

注册 LightTick 成员以 Token 中的 app/user 归属访问，无需 goal/plan；游客仅在客户端暂存。记录不会自动进入 AI 上下文。

| 方法 | Canonical 路径 | 结果 |
|---|---|---|
| GET | `/api/v1/lighttick/records` | `items,has_more,next_cursor`；q/date/archived=false,true,all/limit(1–200)/cursor；日期降序后按 ID 降序，游标固定 owner 与筛选 |
| GET | `/api/v1/lighttick/records/{recordId}` | 当前记录，他人或未知 ID 为 404 |
| PUT | `/api/v1/lighttick/records/{recordId}` | 客户端稳定 ID，base_version=0 创建；之后使用当前版本 |
| GET | `/api/v1/lighttick/records/{recordId}/versions` | 含归档/恢复操作的不可变历史，版本倒序 |
| POST | `/api/v1/lighttick/records/{recordId}/archive`、`/restore` | body: `{base_version}`，产生新版本 |
| GET | `/api/v1/lighttick/records/export` | format_version=1、exported_at、records[{record,versions}]，含归档及全部历史 |

PUT 原文字段 raw_text（非空，最多 10000 UTF-16 code units），record_date 为真实 YYYY-MM-DD；prompt_kind 为 free/learning/difficulty/decision，guided_answers 可选（最多12项，每值2000字符），tags 可选（最多20项，每项50字符）。采用整理 adopted_summary 需提供 summary_basis_version（1至base_version）；本轮不生成 AI 整理。

所有写请求必须携带 8–128 字符 Idempotency-Key；同键同请求返回原结果，不再增加版本或变化；同键更换正文、对象或操作返回 LIGHTTICK_IDEMPOTENCY_MISMATCH(409)。陈旧版本为 LIGHTTICK_VERSION_CONFLICT(409)，输入不得自动覆盖。写入、历史、请求结果与 sync change log 同事务；sync/pull 返回 entity_type=record 的完整快照，sync/push 仍仅承载已有任务事件。LightTick 应用删除覆盖新表、历史、操作及变化日志，其他产品保持原归属。无旧 Grow 数据迁移或账户自动合并。


### Grow 独立记录交接（默认关闭）

- `POST /api/v1/lighttick/record-link/tickets`：正式账户生成五分钟记录连接码；`GET /record-link/status` 返回该账户当前阶段。与 action-link 的计划授权分开。
- `POST /api/v1/lighttick/record-bridge`：仅信任配置的 Grow 实例和服务端登录 subject。HMAC 签名覆盖实例、subject、秒级时间、nonce 和递归排序的紧凑 JSON；窗口 ±120 秒，nonce 入库防重放。原生端不能自行声明 Grow 身份。
- 流程：preview → claim → stage（原生查询、同步和导出均不可见）→ 来源持久化写屏障和精确备份 → 签名 frozen 回执 → activate。binding、operation、快照 SHA256、目标 owner 必须一致；激活、历史和变更日志在同一个 owner 事务内提交。响应丢失使用相同操作和快照重试，不覆盖之后的新编辑。
- `cancel` 仅允许 prepared/staged，取消确认后来源可恢复写入；active/readonly 禁止取消。已激活回退使用 `POST /record-link/readonly` 返回 `{phase, export}`：目标停止写入并导出最新完整状态，来源继续冻结，不能用交接前快照直接回写。
- 交接包最大 4 MiB / 10000 条，包含所有归档记录、实际存在的版本、当前观察快照、AI 私人历史与安全的操作元数据。旧版未存下的版本须在 `source.missing_versions` 明列。原始结构保存在 owner-only `source_history`，完整导出一并返回；不会伪造缺失历史。凭据字段不得进入包。
- 转入记录的 `source` 只由服务端写入；客户端编辑不得提交该字段。原文、日期、提问类型、回答、标签和已采用整理保持独立于目标。AI 历史在本阶段只读，桥接不能触发新 AI 生成。
- 记录、版本、来源历史、stage 备份、连接码及绑定随 LightTick app-scoped 账户删除清理；原 Grow 只读备份的独立删除仍由 Grow 账户负责，删除目标不会重新开放旧来源。
- 部署配置：Zook `LIGHTTICK_RECORD_HANDOFF_ENABLED=1`、`GROW_RECORDS_SOURCE_ID`、`GROW_RECORDS_BRIDGE_SECRET`（至少 32 字符）；Grow 使用相同来源 ID 和密钥，加 `LIGHTTICK_BRIDGE_URL`。只允许 HTTPS，localhost 合成验收可用 HTTP。密钥只留在服务端。未配置或网络错误时保持当前写入归属并保留输入。
- 记录写入在 owner 锁内复核 ACTIVE user/membership，避免删除与在途写入交错后重建数据。桥接每次也在锁内复核正式账户访问资格。

旧 Grow 历史版本未记录 `summary_basis_version` 时，不从最新记录推断旧依据；规范投影可省略该历史版本的整理字段，原始 `adopted_summary` 完整保存在 `source_history.private_history.versions`，被省略的版本号在 `private_history.normalization.summary_basis_missing_versions` 明列。当前观察快照使用其实际保存的依据。

`/api/v1/lighttick/action-plans` 及 `/schedules`、operations、执行记录、复盘/AI历史和日历已对齐P0 v2字段与内部完成语义。正式账号公共登录鉴权；`LIGHTTICK_ACTIONS_ENABLED=1`启用读取，另需显式 `LIGHTTICK_ACTIONS_V2_ENABLED=1` 才开放写入、新连接码和 Grow v2 接管。行动POST须声明 `X-Grow-Action-Schema: 2`；默认关闭时仍返回409/CONTRACT_UPGRADE_REQUIRED及CONNECTION_WRITES_DISABLED，旧版本始终拒写。原生消费者在本地候选适配，真机和生产发布另验。完整字段、错误码和边界见 [共享行动计划接入](docs/public-lighttick-actions.md) 和 canonical OpenAPI。

### LightTick：Grow 私有来源证明与可靠回执（C2）

`POST /api/v1/lighttick/grow-bridge` 增加签名 source-context/source-confirmation/source-receipt/source-reconcile。仅已有 active 绑定和活跃注册会员可用；服务器生成的 article_read/lesson_completed 证明通过私有 outbox 投递，按不可变事件 ID/hash 去重，丢响应后查询/重放，running 结束后核对原事件完成。origin 证明保留原计划日期/时区；不复制正文/笔记。新增稳定错误 SOURCE_EVENT_CONFLICT、SOURCE_PROOF_INVALID、SOURCE_DELIVERY_UNAVAILABLE；详细字段、状态与恢复见 [共享行动协议](docs/public-lighttick-actions.md#c2-私有来源通道2026-10-21) 和唯一 OpenAPI 的 LightTickActionSource* schemas。

默认不放行普通 action 写入、新配对或 v2 接管；2026-10-25 独立 v2 开关与消费者适配见行动协议当前接入节，生产尚未部署。验收见 [C2 验证报告](docs/verification/lighttick-source-delivery/README.md)。

### LightTick 行动接管快照 v2（默认关闭，显式启用）

唯一 OpenAPI 新增 `LightTickActionHandoffSnapshot/Event`，覆盖行动、执行事实、复盘、总结、旧操作回执、提醒 claim、来源清单和确认事件。内部预检/原子导入验证身份、摘要、目标版本及整个关系图，同快照重试返回原回执；不新增公开预检端点。公开 grow-bridge import/claim、普通连接写入和新配对默认关闭；显式 v2 开关启用后由三模式消费者接入，旧消费者仍拒写。私有切换协调、来源确认屏障、不可变备份与故障恢复已隔离验收；新增 LightTickActionHandoffReceipt 严格区分预检和导入回执，并将迁移事件接入既有 C2 完成核对。目标版本冲突用 REVISION_CONFLICT / HANDOFF_TARGET_VERSION_CHANGED 拒绝，pending 仅可对同一备份重预检；未恢复来源发布日志会阻断冻结。2026-10-25 已将同一内部服务接到显式启用的受信 bridge 预检/导入动作；默认门禁和旧客户端拒写仍保留。原生/真实双端与生产放行仍待完成，不能据内部通过迁移真实账号；最新证据见 docs/verification/lighttick-handoff-cutover/README.md。字段与验证边界见 [行动协议](docs/public-lighttick-actions.md#c3-内部快照-v22026-10-21公开接管仍关闭)。


### Grow 手机学习计划进度（本地候选）

`GET /api/v1/lighttick/action-plans/learning-progress` 读取正式账号本人已绑定 Grow 来源的最近快照，无快照返回 `data.progress:null`。有快照包含来源修订/观察和接收时间、配置网页地址、正式计划及阶段的总课数/发布数/本人学完数/百分比；不含课程正文、笔记、反馈或模型输出。匿名与游客不能读取私人进度。源每30秒通过受信 `grow-bridge action=learning-progress` 检查并持久重试投递，绑定、修订、摘要及阶段数量必须匹配；不接受客户端自报完成数。协议、配置、H5分工与开关见 [行动协议当前接入](docs/public-lighttick-actions.md#2026-10-25-原生执行及学习计划进度)。

### 2026-10-25 Grow 原生课程只读接入

`GET /api/v1/lighttick/learning-library` 返回本人当前绑定且已另行授权的课程目录；`GET /api/v1/lighttick/learning-library/{lessonId}` 返回正文、来源参考、内容版本和来源学完状态。需要 lighttick 正式账户 Bearer 与有效成员身份，禁用服务返回503；未授权目录为空，正文404。仅投影已发布内容，不含笔记/作答，不产生完成。正文版本绑定 content+references 的 canonical SHA256，课程ID不随标题改名变化。

可信 Grow 源通过既有签名桥接 `action=learning-library` 推送，需 schema 2、相同已认领的 binding（可处于只读 staged 阶段）、单调 source_revision、observed_at、consent_enabled 和有界 lessons。授权单独在 Grow 确认，旧行动/记录授权不扩大。重放同版本同摘要幂等；篡改、过期绑定和乱序拒绝。最多200节、每正文/参考100000字符、整包4MiB。独立可重建投影表不膨胀行动工作区，产品账户删除覆盖镜像。原生每账户有界缓存、同版本阅读位置；撤回后在线清理，离线旧缓存须设备清理。默认 v2 写开关不变，不推送私人正文到未授权账户。

只读课程连接允许使用已认领但未接管行动的 staged binding：只有显式阅读 scope 可读写课程镜像，其他行动/来源操作仍要求 active，不能因此绕过 R20 或行动冻结/接管门禁。
