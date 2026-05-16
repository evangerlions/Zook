# QR Login Public API Spec

## 1. 文档说明

本文档说明平台公共扫码登录接口的用途、调用顺序和接入方式。

适用场景：

1. PC 或 Web 端希望通过移动端已登录账号完成免密码登录。
2. 外部业务方需要对接统一账号体系的扫码登录能力。
3. 前端需要明确二维码内容、轮询方式和确认动作的配合关系。

本组接口属于平台公共认证能力，统一挂在：

```text
/api/v1/auth/...
```

## 2. 接口用途

扫码登录一共解决三件事：

1. PC 端创建一次性登录会话，并拿到可渲染二维码的内容。
2. 移动端用户扫描二维码后，用自己当前已登录的账号确认本次登录。
3. PC 端轮询登录结果，确认成功后拿到 Access Token，并由服务端写入 Web 端 Refresh Token Cookie。

这不是“扫码后直接把移动端 token 透传给 PC”，而是由服务端为 PC 会话重新签发一组新的登录凭证。

## 3. 接入流程

```text
PC/Web                             Backend                             Mobile App
  |                                  |                                    |
  |-- POST /api/v1/auth/qr-logins -->|                                    |
  |<-- loginId + qrContent + pollToken -----------------------------------|
  |                                  |                                    |
  |---------------------- 展示二维码 -----------------------> 用户扫码      |
  |                                  |<-- POST /api/v1/auth/qr-logins/{id}/confirm
  |                                  |    Authorization: Bearer {token}   |
  |                                  |--> confirmed                        |
  |-- GET /api/v1/auth/qr-logins/{id}?appId=...&pollToken=... ----------->|
  |<-- PENDING 或 CONFIRMED + accessToken + Set-Cookie --------------------|
```

推荐轮询策略：

1. 创建会话后立刻开始轮询。
2. 轮询间隔按接口返回的 `pollIntervalMs` 执行。
3. 一旦拿到 `CONFIRMED`，立即停止轮询。
4. 如果返回 `AUTH_QR_LOGIN_EXPIRED`，提示用户刷新二维码重新发起。

## 4. 通用约定

### 4.1 appId 传递方式

未登录接口需要明确传递 `appId`。当前实现支持以下方式之一：

1. 请求体中的 `appId`
2. 查询参数中的 `appId`
3. 受信代理透传的 `X-App-Id`

最简单的接入方式是：

1. `POST` 请求在 JSON body 里传 `appId`
2. `GET` 轮询请求在 query 里传 `appId`

### 4.2 统一响应格式

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
  "code": "AUTH_QR_LOGIN_EXPIRED",
  "message": "QR login session is expired.",
  "data": null,
  "requestId": "req_xxx"
}
```

## 5. API 说明

### 5.1 创建扫码登录会话

`POST /api/v1/auth/qr-logins`

用途：

1. 由 PC/Web 端调用
2. 创建一次性扫码登录会话
3. 返回二维码内容和轮询凭证

请求示例：

```http
POST /api/v1/auth/qr-logins
Content-Type: application/json

{
  "appId": "app_a"
}
```

成功响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "loginId": "qr_login_xxx",
    "qrContent": "zook://auth/qr-login?appId=app_a&loginId=qr_login_xxx&scanToken=qrs_xxx",
    "pollToken": "qrp_xxx",
    "expiresInSeconds": 120,
    "pollIntervalMs": 2000
  },
  "requestId": "req_xxx"
}
```

字段说明：

1. `loginId` 是本次扫码登录会话 ID。
2. `qrContent` 是要交给前端二维码组件渲染的内容，不是图片 URL。
3. `pollToken` 只给 PC/Web 端保存，用于后续轮询。
4. `expiresInSeconds` 表示二维码剩余有效期，当前实现为 120 秒。
5. `pollIntervalMs` 是建议轮询间隔，当前实现为 2000 毫秒。

### 5.2 移动端确认扫码登录

`POST /api/v1/auth/qr-logins/{loginId}/confirm`

用途：

1. 由移动端调用
2. 用户已登录的前提下，确认这次扫码登录
3. 确认成功后，PC/Web 端下一次轮询即可拿到登录结果

请求要求：

1. 必须带移动端当前账号的 Bearer Token
2. `appId` 必须与 Bearer Token 的 `app_id` 作用域一致
3. `scanToken` 必须来自二维码内容

请求示例：

```http
POST /api/v1/auth/qr-logins/qr_login_xxx/confirm
Authorization: Bearer {mobile_access_token}
Content-Type: application/json

{
  "appId": "app_a",
  "scanToken": "qrs_xxx"
}
```

成功响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "confirmed": true
  },
  "requestId": "req_xxx"
}
```

### 5.3 PC/Web 端轮询登录结果

`GET /api/v1/auth/qr-logins/{loginId}?appId={appId}&pollToken={pollToken}`

用途：

1. 由 PC/Web 端轮询本次扫码登录状态
2. 未确认时返回 `PENDING`
3. 已确认时返回 `CONFIRMED` 和 Access Token，同时写入 Web 端 Refresh Token Cookie

请求示例：

```http
GET /api/v1/auth/qr-logins/qr_login_xxx?appId=app_a&pollToken=qrp_xxx
```

等待确认时响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "status": "PENDING",
    "expiresInSeconds": 96,
    "pollIntervalMs": 2000
  },
  "requestId": "req_xxx"
}
```

确认成功时响应示例：

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "status": "CONFIRMED",
    "accessToken": "eyJ...",
    "expiresIn": 3600
  },
  "requestId": "req_xxx"
}
```

同时响应头会包含：

```http
Set-Cookie: refreshToken=...; HttpOnly; Path=/api/v1/auth; SameSite=Lax; Max-Age=2592000
```

说明：

1. `refreshToken` 不会出现在响应 body 中，而是只通过 Cookie 返回给 Web 端。
2. `CONFIRMED` 结果只能成功领取一次。
3. PC/Web 端拿到 `CONFIRMED` 后应立即停止轮询并进入已登录状态。

## 6. 常见错误码

| HTTP Status | code | 含义 | 常见处理方式 |
| --- | --- | --- | --- |
| `400` | `REQ_INVALID_BODY` | 请求体缺字段或字段类型错误 | 修正入参 |
| `400` | `REQ_INVALID_QUERY` | 轮询 query 缺字段 | 修正 query |
| `401` | `AUTH_BEARER_REQUIRED` | 确认接口未携带 Bearer Token | 先让移动端登录 |
| `401` | `AUTH_INVALID_TOKEN` | 移动端登录态无效 | 重新登录移动端 |
| `401` | `AUTH_QR_LOGIN_TOKEN_REQUIRED` | 缺失 `scanToken` 或 `pollToken` | 补齐一次性 token |
| `401` | `AUTH_QR_LOGIN_INVALID` | 会话不存在或 token 不匹配 | 刷新二维码重新开始 |
| `401` | `AUTH_QR_LOGIN_EXPIRED` | 二维码已过期 | 重新创建扫码会话 |
| `403` | `AUTH_APP_SCOPE_MISMATCH` | `appId` 与移动端 token 作用域不一致 | 使用同一 App 的登录态确认 |
| `409` | `AUTH_QR_LOGIN_ALREADY_USED` | 会话已经确认过或结果已被领取 | 重新发起扫码登录 |

## 7. 安全说明

当前实现包含以下保护：

1. 二维码会话有过期时间，当前为 120 秒。
2. `scanToken` 和 `pollToken` 分离，分别用于移动端确认和 PC/Web 轮询。
3. 服务端只存 token 哈希值，不直接持久化明文。
4. 确认成功后，登录结果只能被领取一次。
5. 重复确认和重复领取都会被拒绝。
6. 移动端确认时，必须使用与目标 `appId` 一致的登录态。

接入建议：

1. 不要把 `qrContent`、`scanToken`、`pollToken` 打到前端埋点或服务端业务日志里。
2. 轮询页面关闭、路由离开或登录成功后，要立即停止轮询。
3. 二维码过期后，前端应主动刷新二维码，不要无限重试旧会话。

## 8. 推荐前端接入方式

PC/Web 端：

1. 页面加载时调用创建接口，拿到 `qrContent` 和 `pollToken`
2. 把 `qrContent` 渲染成二维码
3. 每隔 `pollIntervalMs` 调用一次轮询接口
4. 轮询返回 `CONFIRMED` 后保存 `accessToken`，并依赖浏览器自动接收 `refreshToken` Cookie

移动端：

1. 解析二维码内容，得到 `appId`、`loginId`、`scanToken`
2. 提示当前用户确认是否允许这台 PC/Web 登录
3. 用户确认后调用确认接口
4. 成功后提示“登录已确认，请返回电脑端查看”
