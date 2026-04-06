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
| `POST` | `/api/v1/auth/password/reset` | 使用邮箱验证码重置密码 |
| `POST` | `/api/v1/auth/password/change` | 已登录用户修改密码 |
| `POST` | `/api/v1/auth/register/email-code` | 发送注册邮箱验证码 |
| `POST` | `/api/v1/auth/register` | 邮箱注册 |
| `POST` | `/api/v1/auth/qr-logins` | 创建扫码登录会话 |
| `POST` | `/api/v1/auth/qr-logins/{loginId}/confirm` | 移动端确认扫码登录 |
| `GET` | `/api/v1/auth/qr-logins/{loginId}` | PC/Web 轮询扫码登录结果 |
| `POST` | `/api/v1/auth/refresh` | 刷新 Access Token |
| `POST` | `/api/v1/auth/logout` | 登出 |
| `GET` | `/api/v1/users/me` | 获取当前用户信息 |
| `POST` | `/api/v1/analytics/events/batch` | 行为事件上报 |
| `POST` | `/api/v1/files/presign` | 获取上传预签名 |
| `POST` | `/api/v1/files/confirm` | 确认上传完成 |
| `POST` | `/api/v1/notifications/send` | 发送通知任务 |
| `GET` | `/api/v1/{productKey}/public/config` | 获取产品公开配置，当前数据来源于后台维护的 `admin.delivery_config` |
| `POST` | `/api/v1/ai_novel/ai/chat-completions` | AI Novel chat 薄代理 |
| `POST` | `/api/v1/ai_novel/ai/embeddings` | AI Novel embeddings 薄代理 |
| `GET` | `/api/v1/logs/pull-task` | 拉取客户端日志上传任务 |
| `POST` | `/api/v1/logs/upload` | 上传客户端日志 |

说明：

1. 当前仓库已经挂出一个产品级薄代理示例：`ai_novel`
2. 其余 `novel`、`pomodoro`、`ppt`、`my-todo` 等产品业务路由仍需按规范自行接入
3. 扫码登录的详细对外接入说明见 [docs/public-qr-login-spec.md](docs/public-qr-login-spec.md)
4. `GET /api/v1/{productKey}/public/config` 当前会读取对应 app 在后台配置的 `admin.delivery_config`

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
