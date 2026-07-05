# FrogSleep Invite Handoff

本文档面向 FrogSleep App / H5 / Web 接入方，说明 Zook 中 FrogSleep 邀请链接的公开 handoff 行为。

## 1. 适用范围

当前包含两类邀请：

1. 睡眠搭子邀请：由 `/v1/relationships/invites` 创建。
2. 专注搭子邀请：由 `/v1/focus/matches/{userId}/invite` 或 `/v1/focus/buddy/invites` 创建。

两类邀请都属于 Zook app `frogsleep`，但为了兼容旧客户端，公开业务路径仍保留在 `/v1/*`。

## 2. API 响应字段

创建邀请成功后，服务端会返回 canonical 分享字段。睡眠搭子邀请响应示例：

```json
{
  "invite": {
    "invite_id": "sleep_invite_xxx",
    "invite_code": "ABCD12",
    "invite_token": "sleep_invite_token_xxx",
    "invite_link": "frogsleep://sleep-buddy-invite?token=sleep_invite_token_xxx&code=ABCD12",
    "invitee_email_snapshot": "partner@example.com",
    "status": "pending",
    "expires_at": "2026-07-12T12:00:00.000Z",
    "share_title": "睡眠搭子邀请",
    "share_subtitle": "一起守住今晚的睡眠节奏"
  }
}
```

迁移期服务端仍保留旧 alias，例如 `id`、`code`、`token`、`share_link`。客户端应优先读取 canonical 字段，再兼容旧 alias。

## 3. 配置来源

链接 base URL 从 `frogsleep` app 的 `admin.delivery_config.inviteLinks` 读取：

```json
{
  "inviteLinks": {
    "sleepBuddyBaseUrl": "frogsleep://sleep-buddy-invite",
    "focusBuddyBaseUrl": "frogsleep://focus-invite"
  }
}
```

如果配置缺失或 JSON 解析失败，服务端使用默认 deep link：

```text
frogsleep://sleep-buddy-invite
frogsleep://focus-invite
```

## 4. 浏览器中转

当分享载体需要 HTTP URL 时，Zook 提供两个浏览器中转端点：

```text
GET /frogsleep/sleep-buddy-invite?token={shareToken}&code={shareCode}
GET /frogsleep/focus-invite?token={shareToken}&code={shareCode}
```

响应为 `302`，`Location` 分别指向：

```text
frogsleep://sleep-buddy-invite?token={shareToken}&code={shareCode}
frogsleep://focus-invite?token={shareToken}&code={shareCode}
```

中转接口不消费邀请，也不要求登录；真正的接受动作必须由已登录 FrogSleep 用户调用：

```text
POST /v1/relationships/invites/accept-code
POST /v1/relationships/invites/accept-token
POST /v1/focus/buddy/invites/accept-code
POST /v1/focus/buddy/invites/accept-token
```

## 5. 客户端处理建议

1. App 已安装：直接打开 deep link，并把 `token` 或 `code` 带入接受邀请流程。
2. App 未安装：H5 可以展示下载页；当前 Zook 仅提供 302 中转，不托管下载落地页。
3. 用户未登录：客户端应先完成 FrogSleep 登录，再调用对应接受邀请接口。
4. 接受失败：根据统一错误码处理，例如邀请过期、已取消、关系冲突或 token 不合法。

## 6. 安全边界

1. `shareCode` 和 `shareToken` 只用于定位邀请，不代表登录凭证。
2. 接受邀请必须使用 active FrogSleep Bearer token，且当前用户必须仍是 active FrogSleep member；其他 app token 返回 `403 AUTH_APP_SCOPE_MISMATCH`，已删除或封禁的 FrogSleep membership 会被拒绝。
3. 睡眠搭子邮箱邀请接受时，服务端会校验当前登录用户的已验证邮箱与 `invitee_email_snapshot` 一致；不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`，且不会创建关系。
4. 服务端所有邀请、关系、session 查询都带 `appId=frogsleep` 作用域。
