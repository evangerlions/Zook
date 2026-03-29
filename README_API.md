# API Interface Specification

## 1. 文档目标

本文档用于统一多产品共用后端时的 API 路径与命名规范。适用场景是多个业务完全不同的产品共用一套服务基础设施，例如 `novel`、`pomodoro`、`ppt`、`my-todo`。

核心原则只有一句：

```text
平台能力平台化，产品能力产品化，管理能力后台化。
```

统一业务前缀：

```text
/api/v1
```

健康检查独立使用：

```text
/api/health
```

## 2. 路径分层

API 按职责分三层：

| 层级 | Path 模板 | 说明 | 示例 |
| --- | --- | --- | --- |
| 平台公共能力 | `/api/v1/{commonScope}/...` | 登录、用户、文件、支付、通知、配置等 | `/api/v1/auth/login` |
| 产品业务能力 | `/api/v1/{productKey}/...` | 某个产品独有的业务接口 | `/api/v1/ppt/projects` |
| 管理能力 | `/api/v1/admin/...` | 运营后台、审核、系统配置 | `/api/v1/admin/users` |

管理后台如果要管理某个具体产品，继续嵌套：

```text
/api/v1/admin/{productKey}/...
```

例如：

```text
/api/v1/admin/novel/projects
/api/v1/admin/ppt/templates
```

平台公共模块推荐固定为：

```text
/api/v1/auth/...
/api/v1/users/...
/api/v1/files/...
/api/v1/billing/...
/api/v1/notifications/...
/api/v1/config/...
```

规则：

1. 平台公共能力必须抽离，不要在每个产品下重复实现。
2. 产品路径使用稳定的技术 key，不用营销名。推荐：`novel`、`pomodoro`、`ppt`、`my-todo`。
3. 产品登录前公开能力、回调、Webhook 仍挂在产品前缀下：

```text
/api/v1/{productKey}/public/...
/api/v1/{productKey}/callbacks/...
/api/v1/{productKey}/webhooks/...
```

## 3. 命名与 Method 规则

1. 路径统一小写，单词使用中划线。
2. 资源优先使用复数名词，如 `/projects`、`/chapters`、`/sessions`。
3. 查询使用 `GET`，创建使用 `POST`，局部更新使用 `PATCH`，删除使用 `DELETE`。
4. 生成、导出、取消、结算这类不适合资源建模的动作，使用 `POST`。
5. 查询条件放 query，写操作参数放 JSON body。
6. 版本只放大版本号，统一使用 `/api/v1`；不使用 `/api/v1.1` 这类小版本路径。
7. 如果 Path、Header、Token 同时携带产品标识，它们必须一致，否则返回 `403 AUTH_APP_SCOPE_MISMATCH`。

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
/api/v1/ppt/login
```

## 4. 新产品接入模板

假设新增产品 key 为 `my-todo`，有以下业务资源：

1. `todos`
2. `projects`
3. `tags`

### 4.1 私有业务接口

已登录用户的私有业务接口，直接挂在产品前缀下：

```text
GET    /api/v1/my-todo/todos
POST   /api/v1/my-todo/todos
GET    /api/v1/my-todo/todos/{todoId}
PATCH  /api/v1/my-todo/todos/{todoId}
DELETE /api/v1/my-todo/todos/{todoId}

GET    /api/v1/my-todo/projects
POST   /api/v1/my-todo/projects
GET    /api/v1/my-todo/projects/{projectId}

GET    /api/v1/my-todo/tags
POST   /api/v1/my-todo/tags
GET    /api/v1/my-todo/tags/{tagId}
```

规则：

1. 这类场景不要写成 `/api/v1/todos`，因为这里不是“单产品多资源”，而是“多产品共用后端”。
2. 产品边界直接体现在 path 上，便于网关、权限、日志和文档按产品收口。
3. 如果 Token 中带有 `app_id` 或 `productKey`，它必须与 path 中的 `my-todo` 一致。

### 4.2 产品公开接口

登录前公开能力也放在产品前缀下：

```text
GET /api/v1/my-todo/public/config
GET /api/v1/my-todo/public/bootstrap
GET /api/v1/my-todo/public/tags
```

适用场景：

1. 启动配置
2. 品牌配置
3. 公开字典或模板数据

### 4.3 产品回调与 Webhook

```text
GET  /api/v1/my-todo/callbacks/oauth/google
GET  /api/v1/my-todo/callbacks/wechat-login

POST /api/v1/my-todo/webhooks/stripe
POST /api/v1/my-todo/webhooks/github
```

规则：

1. `callbacks` 用于 OAuth、支付页面跳回等回调入口。
2. `webhooks` 用于第三方系统主动推送事件。
3. 这类接口应使用签名、密钥或白名单鉴权，不依赖普通用户 Bearer Token。

### 4.4 一眼看懂的模板

| 需求 | 推荐 Path |
| --- | --- |
| 登录 | `/api/v1/auth/login` |
| 产品资源列表 | `/api/v1/my-todo/todos` |
| 产品资源详情 | `/api/v1/my-todo/todos/{todoId}` |
| 产品公开配置 | `/api/v1/my-todo/public/config` |
| 产品回调 | `/api/v1/my-todo/callbacks/oauth/google` |
| 产品 Webhook | `/api/v1/my-todo/webhooks/stripe` |

## 5. Header 与查询参数

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

1. `X-App-Id` 可用于日志、埋点、网关或前置校验。
2. 如果请求同时带 `X-App-Id` 和产品路径，两者必须一致。
3. `X-App-Locale` 表示客户端当前 UI 语言，推荐传 BCP 47，如 `zh-CN`、`en-US`。
4. `X-App-Country-Code` 表示客户端感知到的国家码，使用 ISO 3166-1 alpha-2 大写值，如 `CN`、`US`。
5. `Accept-Language` 可作为 Web / 浏览器环境下的语言兜底。
6. `X-Country-Code` 仅供可信网关注入，普通客户端不需要发送；服务端会优先使用它来决定邮件发送 region。
7. 邮件发送场景的优先级：
   `region = X-Country-Code（可信网关） > X-App-Country-Code > Geo`
   `locale = X-App-Locale > Accept-Language > 国家码推断 > zh-CN`
8. App 客户端建议始终传 `X-App-Locale` 与 `X-App-Country-Code`；Web 客户端至少传 `X-App-Locale`。
9. 列表查询统一通过 query 表达，例如 `page`、`page_size`、`keyword`、`status`、`sort_by`、`sort_order`、`cursor`。

示例：

```text
GET /api/v1/ppt/projects?page=1&page_size=20
GET /api/v1/novel/projects?status=active
GET /api/v1/pomodoro/sessions?date=2026-03-18
```

## 6. 当前已开放接口

当前仓库已经挂出的接口主要是平台层与管理层能力：

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/v1/auth/login` | 登录 |
| `POST` | `/api/v1/auth/login/email-code` | 发送邮箱登录验证码 |
| `POST` | `/api/v1/auth/login/email` | 使用邮箱验证码登录，必要时自动创建账号 |
| `POST` | `/api/v1/auth/register/email-code` | 发送注册邮箱验证码 |
| `POST` | `/api/v1/auth/register` | 邮箱注册并创建账号 |
| `POST` | `/api/v1/auth/qr-logins` | 创建扫码登录会话并生成二维码内容 |
| `POST` | `/api/v1/auth/qr-logins/{loginId}/confirm` | 移动端确认扫码登录 |
| `GET` | `/api/v1/auth/qr-logins/{loginId}` | PC 端轮询扫码登录结果 |
| `POST` | `/api/v1/auth/refresh` | 刷新 Access Token |
| `POST` | `/api/v1/auth/logout` | 登出 |
| `POST` | `/api/v1/analytics/events/batch` | 行为事件上报 |
| `GET` | `/api/v1/admin/metrics/overview` | 概览指标 |
| `GET` | `/api/v1/admin/metrics/pages` | 页面指标 |
| `GET` | `/api/v1/admin/apps/{appId}/i18n-settings` | 获取 app 级多语言设置 |
| `PUT` | `/api/v1/admin/apps/{appId}/i18n-settings` | 更新 app 级多语言设置 |
| `POST` | `/api/v1/files/presign` | 获取上传预签名 |
| `POST` | `/api/v1/files/confirm` | 确认上传完成 |
| `POST` | `/api/v1/notifications/send` | 发送通知任务 |
| `POST` | `/api/v1/ai_novel/ai/chat-completions` | AINovel chat 薄代理，按 `taskType` 选择服务端 scene 与逻辑模型 |
| `POST` | `/api/v1/ai_novel/ai/embeddings` | AINovel embeddings 薄代理，按 `taskType` 选择服务端 scene 与逻辑模型 |

说明：

1. 当前仓库已经挂出一个产品级薄代理示例：`ai_novel`，其余 `novel`、`pomodoro`、`ppt`、`my-todo` 等完整业务路由仍未接入。
2. 新增产品时，应按本规范直接落到 `/api/v1/{productKey}/...`。
3. 扫码登录的对外接入说明见 [docs/public-api-spec.md](docs/public-api-spec.md)。
4. 邮箱验证码登录接口：
   `POST /api/v1/auth/login/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/login/email` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "emailCode": "123456", "clientType": "app" }`
5. 邮箱不存在时，`POST /api/v1/auth/login/email` 在验证码校验成功后会自动创建账号并完成登录。
6. `ai_novel` 的两个 AI 接口都是 scene-first 协议：客户端必须传 `taskType`，不得直传 `model`、`providerModel`、`modelKey` 这类底层选模字段。
7. `POST /api/v1/ai_novel/ai/chat-completions` 至少需要 `taskType + messages`；`POST /api/v1/ai_novel/ai/embeddings` 至少需要 `taskType + input`。

## 7. 统一响应格式

当前实现统一返回：

```json
{
  "code": "OK",
  "message": "success",
  "data": {},
  "requestId": "req_xxx"
}
```

失败时：

```json
{
  "code": "AUTH_INVALID_TOKEN",
  "message": "Bearer token is expired or malformed.",
  "data": null,
  "requestId": "req_xxx"
}
```

客户端应优先根据 `HTTP Status + code` 做分支处理。

## 8. 常用错误码

| HTTP Status | code | 说明 |
| --- | --- | --- |
| `400` | `REQ_INVALID_BODY` | 请求体不合法或缺字段 |
| `400` | `REQ_INVALID_QUERY` | 查询参数不合法 |
| `401` | `AUTH_BEARER_REQUIRED` | 缺失 Bearer Token |
| `401` | `AUTH_INVALID_TOKEN` | Token 非法、签名错误或过期 |
| `401` | `AUTH_REFRESH_TOKEN_REQUIRED` | 需要 Refresh Token 但未提供 |
| `401` | `AUTH_REFRESH_TOKEN_REVOKED` | Refresh Token 已失效或已撤销 |
| `401` | `AUTH_VERIFICATION_CODE_REQUIRED` | 注册验证码缺失 |
| `401` | `AUTH_VERIFICATION_CODE_INVALID` | 注册验证码错误、过期或已失效 |
| `401` | `AUTH_QR_LOGIN_TOKEN_REQUIRED` | 扫码登录所需的一次性 token 缺失 |
| `401` | `AUTH_QR_LOGIN_INVALID` | 扫码登录会话或 token 非法 |
| `401` | `AUTH_QR_LOGIN_EXPIRED` | 扫码登录二维码已过期 |
| `409` | `AUTH_ACCOUNT_ALREADY_EXISTS` | 邮箱已注册 |
| `409` | `AUTH_QR_LOGIN_ALREADY_USED` | 扫码登录会话已确认或已消费 |
| `429` | `AUTH_RATE_LIMITED` | 注册发送或提交频率过高 |
| `403` | `AUTH_APP_SCOPE_MISMATCH` | Header、Path、Token 的产品标识不一致 |
| `403` | `IAM_PERMISSION_DENIED` | 当前用户没有对应权限 |
| `500` | `SYS_INTERNAL_ERROR` | 服务端内部异常 |

## 9. 最终落地模板

新增接口时，优先按下面的骨架设计：

```text
/api/v1/auth/...
/api/v1/users/...
/api/v1/files/...
/api/v1/billing/...
/api/v1/notifications/...
/api/v1/config/...

/api/v1/{productKey}/...
/api/v1/{productKey}/public/...
/api/v1/{productKey}/callbacks/...
/api/v1/{productKey}/webhooks/...

/api/v1/admin/...
/api/v1/admin/{productKey}/...
```
