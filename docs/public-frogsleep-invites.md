# FrogSleep Invite Handoff

本文档面向 FrogSleep App / H5 / Web 接入方，说明 Zook 中 FrogSleep 邀请链接的公开 handoff 行为。

## 1. 适用范围

当前包含两类邀请：

1. 睡眠搭子邀请：由 `/api/v1/frogsleep/sleep-buddy/invites` 创建。
2. 专注搭子邀请：由 `/api/v1/frogsleep/focus-buddy/matches/{userId}/invite` 或 `/api/v1/frogsleep/focus-buddy/invites` 创建。

两类邀请都属于 Zook app `frogsleep`，公开业务路径统一使用 `/api/v1/frogsleep/*`。`/v1/*` 不属于 FrogSleep 外部 API，客户端必须使用本文档中的 canonical path。

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
POST /api/v1/frogsleep/sleep-buddy/invites/accept-code
POST /api/v1/frogsleep/sleep-buddy/invites/accept-token
POST /api/v1/frogsleep/focus-buddy/invites/accept-code
POST /api/v1/frogsleep/focus-buddy/invites/accept-token
```

服务端会尽力把中转打开行为记录到邀请 payload：

```json
{
  "first_opened_at": "2026-07-05T12:00:00.000Z",
  "last_opened_at": "2026-07-05T12:10:00.000Z",
  "open_count": 2,
  "last_open_source": "redirect",
  "last_open_user_agent": "..."
}
```

该记录仅用于转化分析；即使写入失败，中转端点仍返回 302。

## 5. 登录后预览与恢复

如果用户打开邀请时尚未登录，客户端应先在本地暂存 deep link 中的 `token` 或 `code`。登录成功后先调用对应 preview 接口恢复上下文：

```text
GET /api/v1/frogsleep/sleep-buddy/invites/preview?token={shareToken}
GET /api/v1/frogsleep/sleep-buddy/invites/preview?code={shareCode}
GET /api/v1/frogsleep/focus-buddy/invites/preview?token={shareToken}
GET /api/v1/frogsleep/focus-buddy/invites/preview?code={shareCode}
```

preview 接口需要 FrogSleep Bearer token，但不会接受邀请、不会创建关系、不会消耗邀请。典型响应：

```json
{
  "invite": {
    "domain": "focus",
    "invite_id": "focus_relationship_xxx",
    "raw_invite_id": "focus_invite_xxx",
    "status": "pending",
    "inviter_user_id": "user_alice",
    "invitee_user_id": "user_bob",
    "viewer_can_accept": true,
    "accept_method": "token",
    "expires_at": "2026-07-12T12:00:00.000Z",
    "share_title": "专注搭子邀请",
    "share_subtitle": "一起完成下一次专注"
  }
}
```

客户端应根据 `domain` 选择睡眠或专注确认页，根据 `viewer_can_accept` 决定是否展示接受按钮。用户确认后再调用对应 accept 接口。

接受成功后，关系响应会带回邀请转化字段：

```json
{
  "relationship": {
    "source_invite_id": "focus_invite_xxx",
    "accept_source": "token",
    "accepted_at": "2026-07-05T12:12:00.000Z"
  }
}
```

服务端同时会在邀请内部记录 `accepted_by_user_id`、`accepted_at`、`accept_source`，供后续邀请转化统计使用。

## 6. 拒绝与取消

睡眠搭子邀请支持登录后的 decline / cancel：

```text
POST /api/v1/frogsleep/sleep-buddy/invites/{inviteId}/decline
POST /api/v1/frogsleep/sleep-buddy/invites/{inviteId}/cancel
```

`cancel` 仅邀请发起人可调用。`decline` 仅指定 `invitee_user_id` 或邮箱快照匹配当前登录账号的用户可调用；无指定目标的公开/纸条邀请不能被任意登录用户 decline，应由发起人 cancel。未授权操作返回 `403 AUTH_APP_SCOPE_MISMATCH`，不会改变邀请状态。

## 7. 客户端处理建议

1. App 已安装：直接打开 deep link，并把 `token` 或 `code` 带入接受邀请流程。
2. App 未安装：H5 可以展示下载页；当前 Zook 仅提供 302 中转，不托管下载落地页。
3. 用户未登录：客户端应暂存 `token` 或 `code`，完成 FrogSleep 登录后先调用 preview 恢复邀请，再调用对应接受邀请接口。
4. 接受失败：根据统一错误码处理，例如邀请过期、已取消、关系冲突或 token 不合法。

## 8. 安全边界

1. `shareCode` 和 `shareToken` 只用于定位邀请，不代表登录凭证。
2. 接受邀请必须使用 active FrogSleep Bearer token，且当前用户必须仍是 active FrogSleep member；其他 app token 返回 `403 AUTH_APP_SCOPE_MISMATCH`，已删除或封禁的 FrogSleep membership 会被拒绝。
3. 睡眠搭子邮箱邀请接受时，服务端会校验当前登录用户的已验证邮箱与 `invitee_email_snapshot` 一致；不一致返回 `403 AUTH_APP_SCOPE_MISMATCH`，且不会创建关系。
4. 服务端所有邀请、关系、session 查询都带 `appId=frogsleep` 作用域。
