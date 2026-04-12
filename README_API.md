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

## 3. 路径分层

| 层级 | Path 模板 | 说明 | 示例 |
| --- | --- | --- | --- |
| 平台公共能力 | `/api/v1/{commonScope}/...` | 登录、用户、文件、通知、统计等 | `/api/v1/auth/login` |
| 产品业务能力 | `/api/v1/{productKey}/...` | 某个产品独有的业务接口 | `/api/v1/ppt/projects` |

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

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/health` | 健康检查 |
| `POST` | `/api/v1/auth/login` | 密码登录 |
| `POST` | `/api/v1/auth/login/email-code` | 发送邮箱登录验证码 |
| `POST` | `/api/v1/auth/login/email` | 使用邮箱验证码登录，必要时自动创建账号 |
| `POST` | `/api/v1/auth/password/email-code` | 发送密码设置 / 重置邮箱验证码 |
| `POST` | `/api/v1/auth/password/set` | 已登录的邮箱验证码账号直接设置密码，并签发新会话 |
| `POST` | `/api/v1/auth/password/reset` | 使用邮箱验证码重置密码，并直接签发新会话 |
| `POST` | `/api/v1/auth/password/change` | 已登录用户修改密码，并直接签发新会话 |
| `POST` | `/api/v1/auth/register/email-code` | 发送注册邮箱验证码 |
| `POST` | `/api/v1/auth/register` | 邮箱注册并创建账号 |
| `POST` | `/api/v1/auth/qr-logins` | 创建扫码登录会话并生成二维码内容 |
| `POST` | `/api/v1/auth/qr-logins/{loginId}/confirm` | 移动端确认扫码登录 |
| `GET` | `/api/v1/auth/qr-logins/{loginId}` | PC/Web 轮询扫码登录结果 |
| `POST` | `/api/v1/auth/refresh` | 刷新 Access Token |
| `POST` | `/api/v1/auth/logout` | 登出 |
| `GET` | `/api/v1/users/me` | 获取当前 Bearer Token 对应的用户信息 |
| `POST` | `/api/v1/analytics/events/batch` | 行为事件上报 |
| `POST` | `/api/v1/files/presign` | 获取上传预签名 |
| `POST` | `/api/v1/files/confirm` | 确认上传完成 |
| `GET` | `/api/v1/logs/policy` | 获取客户端日志回捞策略 |
| `GET` | `/api/v1/logs/pull-task` | 拉取客户端日志上传任务 |
| `POST` | `/api/v1/logs/tasks/{taskId}/ack` | 客户端无日志时回执 `no_data` |
| `POST` | `/api/v1/logs/upload` | 上传 AES-GCM + gzip + NDJSON 客户端日志 |
| `POST` | `/api/v1/notifications/send` | 发送通知任务 |
| `GET` | `/api/v1/{productKey}/public/config` | 获取产品公开配置，当前数据来源于后台维护的 `admin.delivery_config` |
| `POST` | `/api/v1/ai_novel/ai/chat-completions` | AINovel chat 能力接口，需要 Bearer 鉴权，按 `taskType` 选择服务端 scene 与逻辑模型；解密后的 inner body 可用 `stream=true` 切到 SSE |
| `POST` | `/api/v1/ai_novel/ai/embeddings` | AINovel embeddings 能力接口，需要 Bearer 鉴权，按 `taskType` 选择服务端 scene 与逻辑模型 |

说明：

1. 当前仓库已经挂出一个产品级薄代理示例：`ai_novel`，其余 `novel`、`pomodoro`、`ppt`、`my-todo` 等完整业务路由仍未接入。
2. 新增产品时，应按本规范直接落到 `/api/v1/{productKey}/...`。
3. 扫码登录的对外接入说明见 [docs/public-api-spec.md](docs/public-api-spec.md)。
4. 邮箱验证码登录接口：
   `POST /api/v1/auth/login/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/login/email` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "emailCode": "123456", "clientType": "app" }`
5. 密码相关接口：
   `POST /api/v1/auth/password/email-code` 请求体为 `{ "appId": "app_a", "email": "user@example.com" }`
   `POST /api/v1/auth/password/set` 请求体为 `{ "appId": "app_a", "password": "Password1234", "clientType": "app" }`
   `POST /api/v1/auth/password/reset` 请求体为 `{ "appId": "app_a", "email": "user@example.com", "emailCode": "123456", "password": "Password1234", "clientType": "app" }`
   `POST /api/v1/auth/password/change` 请求体为 `{ "appId": "app_a", "currentPassword": "OldPass1234", "newPassword": "NewPass1234", "clientType": "app" }`
   `password` / `newPassword` 当前要求为 10-256 个字符，且同时包含字母和数字。
   `password/set` 只允许当前已登录且仍为 `email-code-only` 的账号调用；如果该账号已经有密码，会返回 `409 AUTH_PASSWORD_ALREADY_SET`，此时应改走 `password/change`。
6. 邮箱不存在时，`POST /api/v1/auth/login/email` 在验证码校验成功后会自动创建账号并完成登录。
7. `POST /api/v1/auth/password/email-code` 为了避免账号探测，在邮箱不存在、账号被封或当前 app 不允许该用户走密码找回时，也会返回 `{ accepted: true }`；真正的校验在 `reset` 阶段完成。
8. `POST /api/v1/auth/login`、`POST /api/v1/auth/login/email`、`POST /api/v1/auth/password/reset`、`POST /api/v1/auth/password/change`、`POST /api/v1/auth/register`、`POST /api/v1/auth/refresh` 以及扫码登录轮询成功时，响应体里都会直接带 `user`，客户端不需要为了首屏再补打一枪用户信息。
9. `GET /api/v1/users/me` 用于 App 重启、刷新页面或恢复登录态时重新拉取当前用户信息；它会按 Bearer Token 的 `app_id` 校验作用域，如果同时传 `X-App-Id`，必须与 token 一致。
10. `clientType = "web"` 时，服务端会通过 `Set-Cookie` 写入 refresh token。当前 API 默认使用跨站友好的 `SameSite=None; Secure`，前端请求必须带 `credentials: "include"`；如果是同站部署，也可以通过 `AUTH_REFRESH_COOKIE_SAMESITE=Lax` 切回更保守的策略。
11. 当前 `user` 结构为：

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

11. 目前 `name` 会根据现有账号信息推导，优先取邮箱前缀，其次取手机号；`avatarUrl` 预留为 `null`，后续可平滑扩展。
12. `hasPassword` 用于标识当前账号是否已经设置过密码：
   - `false`：当前仍是 `email-code-only` 账号，前端应展示“设置密码”
   - `true`：前端应展示“修改密码”
13. `POST /api/v1/auth/logout` 当 `scope = "all"` 时，会立即撤销当前 app 下该用户的全部 refresh token，并使现有 access token 立刻失效；客户端收到成功响应后应直接清理本地旧 token。
14. `ai_novel` 的两个 AI 接口都要求 `Authorization: Bearer <access_token>` 与 `X-App-Id: ai_novel`；未登录返回 `401 AUTH_BEARER_REQUIRED`，`app_id` 或 `X-App-Id` 不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`。
15. `ai_novel` 的两个 AI 接口都是 scene-first 协议：客户端必须传 `taskType`，不得直传 `model`、`providerModel`、`modelKey` 这类底层选模字段。
16. `POST /api/v1/ai_novel/ai/chat-completions` 至少需要 `taskType + messages`；`POST /api/v1/ai_novel/ai/embeddings` 至少需要 `taskType + input`。
17. `ai_novel` 的两个 AI 接口使用应用层 AES-256-GCM JSON 加密 envelope；只有鉴权失败、`appId` 不匹配、外层 envelope 非法、未知 `keyId`、算法不支持、或请求解密失败时才返回明文错误。
18. 一旦 AI 请求解密成功，业务成功结果与业务错误都会加密返回；客户端需要先解密，再读取其中的标准 `code + message + data + requestId` 响应包。
19. **仅 local 联调环境**允许在 AI 加密 envelope 外层额外挂一个明文字段用于第 8 人员排查：客户端请求体可带 `localDebugRequestPlaintext`，服务端 chat-completion 成功响应可带 `localDebugResponseText`。这两个字段都只是调试镜像，前后端业务逻辑都不得依赖它们。
20. 客户端日志回捞现在使用轻量 claim 模式：先调 `GET /api/v1/logs/policy`，再用 `X-Did` 调 `GET /api/v1/logs/pull-task` 领取任务；有日志时用 `POST /api/v1/logs/upload` 并带 `X-Log-Claim-Token` 上传，无日志时用 `POST /api/v1/logs/tasks/{taskId}/ack` 回执 `no_data`。后端实现细节见 [docs/client-log-remote-pull-backend.md](docs/client-log-remote-pull-backend.md)。
21. 服务端不再把上传日志逐行落库；上传成功后会把解密解压后的 `.ndjson` 文件直接存到本地，并在 admin 的 `Remote Log Pull` 页面里提供“查看日志 / 下载原始文件”。日志浏览解析发生在前端，不做服务端分页。
22. 如果客户端在本地重试超过阈值后仍然上传失败，可以调用 `POST /api/v1/logs/tasks/{taskId}/fail` 主动把任务标记为 `FAILED`，并附带失败原因，方便 admin 排障。
23. admin 当前还提供 `Remote Log Pull` 的独立日志详情页：任务列表只展示摘要，点“查看日志”后进入详情页查看任务摘要、文件摘要和本地解析后的日志表格。

## 8. 统一响应格式

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

## 9. 常用错误码

| HTTP Status | code | 说明 |
| --- | --- | --- |
| `400` | `REQ_INVALID_BODY` | 请求体不合法或缺字段 |
| `400` | `REQ_INVALID_QUERY` | 查询参数不合法 |
| `401` | `AUTH_BEARER_REQUIRED` | 缺失 Bearer Token |
| `401` | `AUTH_INVALID_TOKEN` | Token 非法、签名错误或过期 |
| `401` | `AUTH_REFRESH_TOKEN_REQUIRED` | 需要 Refresh Token 但未提供 |
| `401` | `AUTH_REFRESH_TOKEN_REVOKED` | Refresh Token 已失效或已撤销 |
| `401` | `AUTH_VERIFICATION_CODE_REQUIRED` | 验证码缺失 |
| `401` | `AUTH_VERIFICATION_CODE_INVALID` | 验证码错误、过期或已失效 |
| `401` | `AUTH_QR_LOGIN_TOKEN_REQUIRED` | 扫码登录所需的一次性 token 缺失 |
| `401` | `AUTH_QR_LOGIN_INVALID` | 扫码登录会话或 token 非法 |
| `401` | `AUTH_QR_LOGIN_EXPIRED` | 扫码登录二维码已过期 |
| `403` | `AUTH_APP_SCOPE_MISMATCH` | Header、Path、Token 的产品标识不一致 |
| `403` | `IAM_PERMISSION_DENIED` | 当前用户没有对应权限 |
| `409` | `AUTH_ACCOUNT_ALREADY_EXISTS` | 邮箱已注册 |
| `409` | `AUTH_QR_LOGIN_ALREADY_USED` | 扫码登录会话已确认或已消费 |
| `429` | `AUTH_RATE_LIMITED` | 提交频率过高 |
| `500` | `SYS_INTERNAL_ERROR` | 服务端内部异常 |
