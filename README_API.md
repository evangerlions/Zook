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
X-App-Region: CN
Accept-Language: zh-CN,zh;q=0.9,en;q=0.8
```

说明：

1. `X-App-Id` 可用于日志、埋点、网关或前置校验
2. `X-App-Locale` 推荐传 BCP 47，如 `zh-CN`、`en-US`
3. `X-App-Country-Code` 推荐传 ISO 3166-1 alpha-2 大写值，如 `CN`、`US`
4. `X-App-Region` 是产品区域的客户端判断，只接受 `CN` 或 `GLOBAL`；它与界面语言、`X-App-Country-Code` 无关
5. `Accept-Language` 可作为 Web / 浏览器环境的兜底语言来源
6. 邮件发送场景的 region 优先级是：
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
| `POST` | `/api/v1/files/presign`                    | 获取上传预签名                                                                                                                      |
| `POST` | `/api/v1/files/confirm`                    | 确认上传完成                                                                                                                        |
| `GET`  | `/api/v1/logs/policy`                      | 获取客户端日志回捞策略                                                                                                              |
| `GET`  | `/api/v1/logs/pull-task`                   | 拉取客户端日志上传任务                                                                                                              |
| `POST` | `/api/v1/logs/tasks/{taskId}/ack`          | 客户端无日志时回执 `no_data`                                                                                                        |
| `POST` | `/api/v1/logs/upload`                      | 上传 AES-GCM + gzip + NDJSON 客户端日志                                                                                             |
| `POST` | `/api/v1/notifications/send`               | 发送通知任务                                                                                                                        |
| `GET`  | `/api/v1/{productKey}/public/config`       | 获取产品公开配置，当前数据来源于后台维护的 `admin.delivery_config`                                                                  |
| `POST` | `/api/v1/ai_novel/ai/chat-completions`     | AINovel chat 能力接口，需要 Bearer 鉴权，按 `scene_key` / `sceneKey` 选择服务端 scene；解密后的 inner body 可用 `stream=true` 切到 SSE |
| `POST` | `/api/v1/ai_novel/ai/embeddings`           | AINovel embeddings 能力接口，需要 Bearer 鉴权，按 `scene_key` / `sceneKey` 选择服务端 scene                                          |
| `POST` | `/api/v1/ai_novel/feedback`                | AINovel 用户反馈提交接口，需要 Bearer 鉴权；正文 trim 后 30–10,000 字，最多 5 张压缩图片                                             |
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
| `GET`  | `/frogsleep/sleep-buddy-invite`            | FrogSleep 睡眠搭子邀请浏览器中转，302 跳转到 deep link                                                                                |
| `GET`  | `/frogsleep/focus-invite`                  | FrogSleep 专注搭子邀请浏览器中转，302 跳转到 deep link                                                                                |
| `GET`  | `/api/v1/ai_novel/statistics`              | 获取当前 AINovel 登录用户的创作统计报告，需要 Bearer 鉴权                                                                           |
| `POST` | `/api/v1/ai_novel/statistics/snapshot`     | 上报当前账号本地写作总量与权威每日字数快照，需要 Bearer 鉴权；服务端校验账号并保留自己的 Token 用量                                  |

说明：

1. 当前仓库已经挂出产品级能力：`ai_novel` AI 接口，以及 FrogSleep `/api/v1/frogsleep/*` 业务接口。其余 `novel`、`pomodoro`、`ppt`、`my-todo` 等完整业务路由仍未接入。
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
14. `POST /api/v1/auth/login`、`POST /api/v1/auth/login/email`、`POST /api/v1/auth/login/sms`、`POST /api/v1/auth/login/one-click`、`POST /api/v1/auth/password/set`、`POST /api/v1/auth/password/reset`、`POST /api/v1/auth/password/reset-by-sms`、`POST /api/v1/auth/password/change`、`POST /api/v1/auth/register`、`POST /api/v1/auth/register/sms`、`POST /api/v1/auth/refresh` 以及扫码登录轮询成功时，响应体里都会直接带 `user` 和 `accountRegion`，客户端不需要为了首屏再补打一枪用户信息。已登录设备调用 `POST /api/v1/auth/qr-logins/{loginId}/confirm` 时，确认响应也会返回本次账号最终的 `accountRegion`。
15. `accountRegion` 取值为 `CN | GLOBAL | UNKNOWN`。既有 membership 迁移后为 `UNKNOWN`；首次收到带有效 `X-App-Region` 的已认证请求时，服务端用数据库原子更新永久确定区域。之后任何设备的冲突值都不能覆盖。无效或缺失的 Header 不报错，也不会把 `UNKNOWN` 写成其他值。
16. `GET /api/v1/users/me` 用于 App 重启、刷新页面或恢复登录态时重新拉取当前用户信息；它会按 Bearer Token 的 `app_id` 校验作用域，如果同时传 `X-App-Id`，必须与 token 一致，并返回同一份 `accountRegion`。
17. `clientType = "web"` 时，服务端会通过 `Set-Cookie` 写入 refresh token。当前 API 默认使用跨站友好的 `SameSite=None; Secure`，前端请求必须带 `credentials: "include"`；如果是同站部署，也可以通过 `AUTH_REFRESH_COOKIE_SAMESITE=Lax` 切回更保守的策略。
18. 当前 `user` 结构为：

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

19. 目前 `name` 会根据现有账号信息推导，优先取邮箱前缀，其次取手机号；`avatarUrl` 预留为 `null`，后续可平滑扩展。
20. `hasPassword` 用于标识当前账号是否已经设置过密码：

- `false`：当前仍是 `email-code-only` 或 `sms-code-only` 账号，前端应展示“设置密码”
- `true`：前端应展示“修改密码”

当 `hasPassword = false` 的账号尝试 `POST /api/v1/auth/login` 密码登录时，服务端返回 `401 AUTH_PASSWORD_NOT_SET`，`message` 会按请求语言本地化，提示用户先使用验证码登录并在账号设置中设置密码。
如果账号不存在，密码登录返回 `401 AUTH_ACCOUNT_NOT_FOUND`，`message` 会按请求语言本地化提示账号不存在；如果账号存在但密码错误，仍返回 `401 AUTH_INVALID_CREDENTIAL`。

21. `POST /api/v1/auth/logout` 当 `scope = "all"` 时，会立即撤销当前 app 下该用户的全部 refresh token，并使现有 access token 立刻失效；客户端收到成功响应后应直接清理本地旧 token。
22. `ai_novel` 的两个 AI 接口都要求 `Authorization: Bearer <access_token>` 与 `X-App-Id: ai_novel`；未登录返回 `401 AUTH_BEARER_REQUIRED`，`app_id` 或 `X-App-Id` 不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`。
23. `ai_novel` 的两个 AI 接口都是 scene-first 协议：客户端必须传 `scene_key` 或 `sceneKey`；不得直传 `model`、`providerModel`、`modelKey` 这类底层选模字段。AINovel 的 `ainovel-free-creative` / `ainovel-plus-reasoning` 等值属于业务 scene route key，不是 common LLM model key。
24. `POST /api/v1/ai_novel/ai/chat-completions` 至少需要 `scene_key + messages`；`chat_compaction` 是无工具、非流式的 hard compact 摘要 scene，不作为用户可见 AI 回复使用；`POST /api/v1/ai_novel/ai/embeddings` 至少需要 `scene_key + input`。
25. `ai_novel` 的两个 AI 接口使用应用层 AES-256-GCM JSON 加密 envelope；只有鉴权失败、`appId` 不匹配、外层 envelope 非法、未知 `keyId`、算法不支持、或请求解密失败时才返回明文错误。
26. 一旦 AI 请求解密成功，业务成功结果与业务错误都会加密返回；客户端需要先解密，再读取其中的标准 `code + message + data + requestId` 响应包。
27. `POST /api/v1/ai_novel/ai/chat-completions` 在 `stream=true` 时会返回 `text/event-stream`；每个 SSE `data:` 事件仍然是一个加密 outer envelope。解密后的正常事件类型通常为 `reasoning_delta`、`content_delta`、`tool_call_delta`、`tool_call`、`usage`、`done`；其中 `content_delta` 是 assistant 正文增量事件，`tool_call_delta` 是通用 provider/tool 参数进度事件，只携带可读 `text` 和可选 `toolCallId`、`toolCallName`、`toolArgumentPath`，不是产品工作流状态。步骤 chrome、本地化文案、loading detail 映射和 retry UI 都由 AINovel 负责。客户端回放 assistant 历史时可以携带 `reasoningContent`，Zook 会在百炼/OpenAI-compatible provider 请求中转成 `reasoning_content`，用于保持多轮上下文与 LLM cache 连贯；该字段不应作为普通用户可见内容展示。`usage` 与 `done.usage` 包含 `promptTokens`、`completionTokens`、`totalTokens`，并在 provider 返回时额外携带 `reasoningTokens`，在服务端能识别模型窗口时额外携带 `contextWindowTokens`、`contextUsedRatio`，客户端应以这些字段判断 hard compact 阈值。`done.completion` 当前保证包含 `sceneRouteKey`、`content`，并按需携带 `reasoningText`、`finishReason`；这里的 `sceneRouteKey` 仍是 AINovel 业务 route key，不是 common LLM `modelKey`。对于 `kickoff_turn`，Zook 只负责单轮 assistant content / tool_call 输出，不在服务端内部继续 kickoff tool loop；后续 tool 执行与下一轮请求由 AINovel engine 负责。服务端会在 relay `ask_question` 时再次规范化 payload：`options` 只保留 2 到 4 个非空、去重后的字符串；`optionSubtitles` 只有在与 `options` 一一对应时才会继续下发；如果规范化后仍不合法，则改为发出流式错误事件而不是把非法 `tool_call` 直接交给客户端。如果在请求解密成功后发生 mid-stream 业务失败，服务端会发出一个加密后的非 `OK` 业务错误 envelope，客户端应把该事件视为流式失败，且后续不应再期待 `done` 事件。
28. **仅 local 联调环境**允许在 AI 加密 envelope 外层额外挂一个明文字段用于第 8 人员排查：客户端请求体可带 `localDebugRequestPlaintext`，服务端 chat-completion 成功响应可带 `localDebugResponseText`。这两个字段都只是调试镜像，前后端业务逻辑都不得依赖它们。
29. **仅 local 联调环境**开放 `POST /api/v1/ai_novel/debug/audit-file`，用于 Flutter Web 把完整自包含的 generation audit HTML 上传给本机 Zook。该接口仍要求 `Authorization: Bearer <access_token>` 与 `X-App-Id: ai_novel`；生产环境或非 localhost/127.0.0.1 host 返回 `404`。请求体为 `{ "sessionId": "...", "html": "..." }`；服务端只 sanitize `sessionId` 并覆盖写入 AINovel 仓库 `.zook/quality-generation/app/{safeSessionId}/generation-audit.html`，响应 `filePath`、`fileUrl`、`viewUrl`、`updatedAt`。其中 `viewUrl` 是 local-only HTTP 查看地址，用于 Flutter Web 在新标签页打开报告；Zook 不解析 HTML 或 audit JSON。
30. 客户端日志回捞现在使用轻量 claim 模式：先调 `GET /api/v1/logs/policy`，再用 `X-Did` 调 `GET /api/v1/logs/pull-task` 领取任务；有日志时用 `POST /api/v1/logs/upload` 并带 `X-Log-Claim-Token` 上传，无日志时用 `POST /api/v1/logs/tasks/{taskId}/ack` 回执 `no_data`。后端实现细节见 [docs/client-log-remote-pull-backend.md](docs/client-log-remote-pull-backend.md)。
31. 服务端不再把上传日志逐行落库；上传成功后会把解密解压后的 `.ndjson` 文件直接存到本地，并在 admin 的 `Remote Log Pull` 页面里提供“查看日志 / 下载原始文件”。日志浏览解析发生在前端，不做服务端分页。
32. 如果客户端在本地重试超过阈值后仍然上传失败，可以调用 `POST /api/v1/logs/tasks/{taskId}/fail` 主动把任务标记为 `FAILED`，并附带失败原因，方便 admin 排障。
33. admin 当前还提供 `Remote Log Pull` 的独立日志详情页：任务列表只展示摘要，点“查看日志”后进入详情页查看任务摘要、文件摘要和本地解析后的日志表格。

## 8. FrogSleep API

FrogSleep 是 Zook 的 app-scoped 产品，固定 app id 为：

```text
frogsleep
```

FrogSleep API 统一使用产品作用域前缀 `/api/v1/frogsleep/*`，对应 OpenAPI 合同位于 `third_party/zook-api-contracts/openapi/frogsleep/api.yaml`，并同步生成到 `src/generated/openapi/public-contracts.generated.ts`。这些接口内部仍使用 Zook 共享账号、共享 Bearer token、app membership、通知队列和 worker。客户端不需要在 `/api/v1/frogsleep/auth/*` 公共接口里传 `appId`；服务端会自动按 `frogsleep` 处理。受保护接口必须使用 FrogSleep token，并要求当前用户仍是 active FrogSleep member；其他 app token 会返回 `403 AUTH_APP_SCOPE_MISMATCH`，已删除或封禁的 FrogSleep membership 会返回对应 app member 错误。`/v1/*` 不属于 FrogSleep 外部 API；客户端必须使用本文档和 OpenAPI 中的 canonical path。

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
```

这些开关分别控制邀请收件箱、邀请显式同意、搭子成长主页、结构化互动、共同目标/周报和 Push 投递。客户端可逐项灰度；服务端关闭某项能力时不得通过旧链接绕过鉴权或显式接受规则。

FrogSleep 成功响应在迁移期采用双兼容格式：保留 Zook 标准响应包 `code + message + data + requestId`，同时把对象型 `data` 字段复制到响应根部，方便仍按 Go 后端 raw JSON 解码的 Sleep 客户端读取 `access_token`、`refresh_token`、`user_id`、`device`、`status`、`relationship_id`、`session_id`、`summary`、`recap`、`moments` 等字段。错误响应仍使用 Zook 统一错误码；常见错误包括：请求体缺字段返回 `400 REQ_INVALID_BODY`；未带 Bearer token 返回 `401 AUTH_BEARER_REQUIRED`；token 非法或过期返回 `401 AUTH_INVALID_TOKEN`；非 FrogSleep app token 访问 `/api/v1/frogsleep/*` 保护接口返回 `403 AUTH_APP_SCOPE_MISMATCH`；重复关系、重复邮箱等业务冲突返回 `409`。

对象型详情接口会同时返回根对象和嵌套对象。例如 `/api/v1/frogsleep/sleep-buddy/shared-summaries/latest` 同时包含根部 `session_id` 和 `summary.session_id`，并在 `data.summary.session_id` 下保留 Zook envelope 读法。列表接口使用根部容器字段，例如 `invites` / `pending_invites`、`sessions`、`achievements`、`candidates`、`messages`、`moments`、`sleep_reports`；客户端不应假设这些列表接口返回裸数组。业务 payload 避免使用顶层 `data` 字段，以免覆盖 Zook envelope。

### 8.1 FrogSleep Auth / Me / Device

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

### 8.2 FrogSleep 睡眠搭子

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

睡眠搭子关系状态机为 `active -> paused -> active`，`active|paused -> revoked`；`revoked` 是终态，不能恢复、暂停或创建新的共同守护 session。`POST /api/v1/frogsleep/sleep-buddy/shared-sessions` 按 `relationship_id + date_anchor` 幂等：同一关系同一日期已有 pending/active session 时返回既有 session，不再创建重复 session。

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

共同守护事件 `event_type` 仅支持 `interrupted`、`returned`、`paused_tonight`、`morning_completed`。未知事件、非法 `occurred_at` 或不可见 session 返回 `400/403`，不会写入事件。`morning_completed` 与 `paused_tonight` 会生成基于共同守护事件的 summary/recap。summary 保留 `completed`、`date_anchor`、`started_at`、`ended_at`、`interrupted_count`、`returned_count`、`paused_tonight`、`telemetry_level = "shared_session_events"`，并补充 iOS 可见字段 `artifact_version`、`visible_state`、`started_on_time`、`had_recovery`、`returned_after_recovery`、`completed_morning`、`headline`。recap 保留 `participant_states`、`event_types` 等字段，并补充 `artifact_version`、`combined_result_type`、`my_result_state`、`partner_result_state`、`headline`、`supporting_line`、`recommended_next_step`。这些字段来自共同守护 session 和事件，不是睡眠阶段或医疗级睡眠评分。

### 8.3 FrogSleep 专注搭子

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

受保护的搭子数据按方向授权分类校验：`presence` 用于在线/专注状态，`daily_summary` 用于睡眠总结与联合回顾，`weekly_trend` 用于专注对比，`shared_activity` 用于共享时刻、结构化消息和共同睡眠活动。关系暂停、撤销、拉黑或对应方向授权撤销后，新读取和新互动立即拒绝。在方向授权上线前已接受的旧关系会幂等回填双向默认授权，以保持原有共享行为；新关系只使用接受预览中明示的分类。

`GET /api/v1/frogsleep/buddy/safety-baseline` 返回标准 Zook envelope，并提供 `schema_version: "1"`、`minimum_client_version: "1.0.0"`、ISO-8601 `server_time` 以及始终为 `true` 的 `safety_commands.decline`、`cancel`、`pause`、`revoke`、`block`。响应头固定为 `Cache-Control: private, max-age=300`。该接口不返回邀请、关系、授权或能力开关，且不受普通搭子增长能力开关影响；未携带 FrogSleep Bearer token 时返回现有 `401 AUTH_BEARER_REQUIRED` 错误 envelope。

`GET /api/v1/frogsleep/buddy/capabilities` 返回标准 Zook envelope，并提供 `schema_version: "1"`、`buddy_api_version: "1"`、`minimum_client_version: "1.0.0"`、最多五分钟后过期的 ISO-8601 `expires_at`，以及 `commands.create`、`accept`、`activity`、`share` 四个显式布尔值。`create` 与 `accept` 仅在普通邀请收件箱和显式邀请同意能力均启用时为 `true`；`activity` 与 `share` 仅在结构化互动能力启用时为 `true`。响应头固定为 `Cache-Control: private, max-age=300`，未携带 FrogSleep Bearer token 时返回现有 `401 AUTH_BEARER_REQUIRED` 错误 envelope。此普通能力文档不返回安全命令、邀请、关系、授权、账户或功能开关元数据；它可以全部为 `false`，而独立的 safety baseline 仍保持可用。

`POST /api/v1/frogsleep/buddy/invitation-receipts` 要求 FrogSleep Bearer 鉴权和普通 `create` 能力。请求体只接受邮箱语法合法的 `email` 与非空、不重复的 `domains`（`sleep`、`focus`）；邮箱会先 `trim().toLowerCase()`，服务端仅保存其 SHA-256 小写十六进制哈希。响应为标准 envelope，`data` 只含不透明 `receipt_id`、固定 `status: "recorded"` 和七天后过期的 ISO-8601 `expires_at`。同一邀请人、规范化邮箱和领域集合重复提交会返回原回执。已注册且合格的账户会在内部绑定不可变用户 ID；未注册、本人或不合格目标会记录同形 decoy 回执。该命令不泄露账户、投递或领域信息，当前只记录邀请回执，不代表已经投递、接受、创建邀请、关系、通知、定位器或分享链接。

`POST /api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/accept` 要求 FrogSleep Bearer 鉴权和普通 `accept` 能力，`domain` 仅支持 `sleep`、`focus`。请求体必须包含 JSON number 类型的正整数 `expected_version` 和非空 `idempotency_key`；字符串或布尔型版本不会被转换。调用者必须是邀请创建时绑定的被邀请用户，且该领域必须属于邀请；错误账户或不存在的邀请统一返回 `404 REQ_ROUTE_NOT_FOUND`。成功只接受指定领域，在一个事务中创建该领域关系、占用双方领域 slot、递增该领域 decision 版本，并向邀请人写入一条去重 outbox 事件；不修改组合邀请、另一领域、旧子邀请或旧关系，也不会隐式开启任何分享授权。

`POST /api/v1/frogsleep/buddy/invitations/{inviteId}/domains/{domain}/decline` 与 `/cancel` 是始终可用的安全命令：均要求 FrogSleep Bearer 鉴权，但不受普通搭子能力、邀请收件箱、显式同意或双向 block 影响。`domain` 仅支持 `sleep`、`focus`，请求体使用与单领域 accept 相同的正整数 JSON `expected_version` 和非空 `idempotency_key`。`decline` 仅允许邀请时绑定的被邀请用户，`cancel` 仅允许邀请人；错误账户或不存在的邀请统一返回 `404 REQ_ROUTE_NOT_FOUND`。成功时只更新指定领域 decision（分别为 `declined` 或 `cancelled`）并向对方写入一条去重 outbox 事件，不修改组合邀请、其它领域、slot、关系、授权、回执或旧邀请记录。相同行为和 idempotency key 可在组合邀请过期或终态后无写入重放；不同 key 或冲突版本返回现有 `409` 冲突响应。安全命令的成功响应 `data` **只**包含 `invitation_id`、`domain`、`decision_status`、`decision_version`。

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

专注 session 上报会校验 `started_at`、`ended_at` 为 ISO 时间，且 `ended_at >= started_at`；`planned_minutes`、`actual_minutes`、`interrupt_count` 必须是有限非负数，超出范围返回 `400 REQ_INVALID_BODY`。`status` 支持完成态 `completed`、`abandoned`、`interrupted`、`cancelled`，以及 presence 推导使用的进行态 `active`、`in_progress`、`focusing`。`GET /api/v1/frogsleep/focus-buddy/sessions`、`GET /api/v1/frogsleep/focus-buddy/achievements`、`GET /api/v1/frogsleep/focus-buddy/messages`、`GET /api/v1/frogsleep/focus-buddy/shared` 支持 `limit`、`cursor`，响应保留原列表容器字段并额外返回 `pagination = { limit, next_cursor, has_more }`。`limit` 默认 50，最大 100。

专注匹配搜索只返回已开启 `matching_consent`、仍有公开资料、与当前用户匹配条件兼容、且未与当前用户存在 pending / accepted 专注关系的候选人。候选响应除 `score`、`matched_scenes`、`matched_study_types`、`explanation` 外，还会带 `recommendation_type = "controlled_focus_partner"`、`privacy_note_key = "buddy_match.privacy.summary_only"`、`why_recommended`、`invite_prompt_key = "buddy_match.invite.controlled_prompt"`，用于客户端展示受控推荐理由和隐私边界。如果当前用户已有未过期的 outgoing pending 专注邀请，`/api/v1/frogsleep/focus-buddy/matches/search` 会直接返回空候选，并在 `empty_state` 中给出 `reason = "pending_invites"`、`title_key`、`subtitle_key`、`pending_relationship_id`、`pending_user_id`，客户端应引导用户回到待处理邀请状态；如果关联邀请已过期，搜索会先刷新过期状态，不继续卡住匹配。`dismiss` 与 `report` 都是当前用户维度的匹配反馈：请求体可传 `reason`、`note`，成功后该候选人会从当前用户后续匹配搜索中排除；不能对自己执行 dismiss / report。搜索内部会批量读取当前用户的 dismiss/report 反馈，避免按候选逐个查询。

专注搭子邀请响应同时包含 `share_link` / `expires_at` 与 iOS 读取的 `invite_link` / `invite_expires_at`。`GET /api/v1/frogsleep/focus-buddy/invites/preview?token=...` 或 `?code=...` 需要 FrogSleep Bearer 鉴权，只用于登录后恢复邀请上下文，不会创建关系、不会消耗邀请。响应包含 `invite.domain = "focus"`、`invite_id`、`raw_invite_id`、`status`、`inviter_user_id`、`invitee_user_id`、`viewer_can_accept`、`accept_method`、`expires_at`、`share_title`、`share_subtitle`。接受成功后，关系响应会带回 `source_invite_id`、`accept_source`、`accepted_at`；邀请内部会记录 `accepted_by_user_id`，便于统计邀请转化。

专注关系 `revoked` 是终态，不能再次 accept/decline/revoke，也不能用于消息、presence、共同专注时刻等搭子互动。搭子消息请求必须包含 `receiver_user_id` 以及 `template_key` 或 `custom_text`，`custom_text` 最大 280 字符；响应保留 snake_case 字段 `sender_user_id`、`receiver_user_id`、`template_key`、`custom_text`、`sent_at`，并提供 `senderUserId`、`receiverUserId`、`templateKey`、`customText`、`context`、`sentAt`、`readAt` camelCase alias。查询消息支持 `receiver_user_id` / `receiverUserId` 和 `since`，后端会先按指定搭子与时间过滤，再分页；非法 `since` 返回 `400 REQ_INVALID_BODY`。presence 需要 `buddy_user_id` / `buddyUserId`，仅接受已建立的专注搭子关系，状态由最近 session、消息和共同专注时刻推导，可能返回 `focusing`、`recently_active`、`idle`、`stale`，并保留 `buddy_user_id`、`status`、`updated_at`，可选返回 `active_session_id`、`goal_tag`、`started_at`、`ends_at`。comparison 支持 `week_start=YYYY-MM-DD` 或 ISO 时间，缺省使用服务端当前 UTC 周；shared moments 支持 `room_id` / `roomId`、`from`、`to`，非法时间或 `from > to` 返回 `400 REQ_INVALID_BODY`。`GET /api/v1/frogsleep/focus-buddy/achievements` 返回的每个成就包含 `id`、`milestone_id`、`type`、`title`、`description`、`earned_at`、`notified`、`unlocked`、`metadata`。

### 8.4 FrogSleep 云端产品数据

这些接口只保存需要跨设备同步、重装恢复或服务端校验的派生数据；实时音频/噪声采集、Screen Time shield、Widget、Watch、Live Activity 运行态仍由本地系统能力负责。

| 方法 | Path | 说明 |
| ---- | ---- | ---- |
| `POST` | `/api/v1/frogsleep/product-data/sleep-reports` | 保存睡眠报告快照 |
| `GET` | `/api/v1/frogsleep/product-data/sleep-reports` | 查询当前用户睡眠报告快照 |
| `PUT/PATCH` | `/api/v1/frogsleep/product-data/progress/{namespace}` | upsert 当前用户进度快照 |
| `GET` | `/api/v1/frogsleep/product-data/progress/{namespace}` | 查询当前用户进度快照 |
| `GET` | `/api/v1/frogsleep/product-data/entitlements/current` | 查询当前 FrogSleep 权益状态 |

睡眠报告请求必须包含 `snapshot_id`（或 `report_id` / `id`）、`schema_version`（或 `version`）、`recorded_at` ISO 时间和对象型 `data`。响应会把报告内容放在 `snapshot_data`，避免覆盖 Zook envelope 的 `data`。列表响应返回 `sleep_reports`、兼容 alias `reports` 与 `pagination`。

进度快照 `namespace` 当前支持 `habit_progress`、`companion_state`、`cat_state`、`onboarding`、`report_preferences`。请求必须包含 `schema_version`（或 `version`）和对象型 `state`（或 `data`）；未知 namespace 返回 `400 REQ_INVALID_BODY`。权益查询返回当前 app-scoped entitlement；无记录时返回 `{ state: "unknown", plan: "free", source: "none" }`。FrogSleep logout 只注销 App 登录态，不删除报告、进度、权益记录，也不删除 Zook 全局账号。

### 8.5 FrogSleep 邀请链接与推送

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
