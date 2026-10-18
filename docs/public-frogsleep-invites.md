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
    "invite_link": "frogsleep://sleep-buddy-invite?mode=preview&token=sleep_invite_token_xxx&code=ABCD12",
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
frogsleep://sleep-buddy-invite?mode=preview&token={shareToken}&code={shareCode}
frogsleep://focus-invite?mode=preview&token={shareToken}&code={shareCode}
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

`mode=preview` 是显式安全契约：链接只定位预览，不代表用户同意。preview 接口需要 FrogSleep Bearer token，但不会接受邀请、不会创建关系、不会消耗邀请。典型响应：

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

## 9. 统一搭子邀请闭环（当前推荐）

新版本只使用 `/api/v1/frogsleep/buddy/invitations`。发起方选择 `sleep`、`focus` 或两者并填写邮箱；服务端在一个写入边界内生成邀请、8 位通用码、不可猜 token、HTTPS handoff、站内事件与邮件 outbox。邮箱尚未注册时邀请保持未绑定，之后仅允许验证了同一邮箱的账号认领。

接收方有四种等价入口：

1. 邮件中的 HTTPS link；
2. `frogsleep://buddy-invitation` 自定义 Scheme；
3. 搭子中心手工输入 `share_code`；
4. 站内/APNs 通知携带的邀请 ID。

所有入口都只调用 preview。未登录时 iOS 持久化 locator；登录、注册验证完成或 App 重启后恢复同一个预览，不自动接受。用户查看拟共享类别并明确接受后，服务端原子绑定收件账号，并分别创建 sleep/focus 关系；组合邀请允许每个领域返回独立结果。

邮件投递状态与邀请状态彼此独立：`bounced`、`suppressed`、`retryable_failed`、`dead_letter` 时仍可用 code/link。发起方可调用 `GET /api/v1/frogsleep/buddy/invitations/{id}/delivery` 刷新真实状态。

双账号验收顺序：

1. A 登录并邀请 B 邮箱，选择 sleep + focus；
2. 验证 A 能看到 code、HTTPS link 和邮件状态；
3. B 用 code 或 link 预览，错误邮箱账号必须得到隐私安全的不可用响应；
4. B 明确同意，确认两个 domain result 均为 `accepted`；
5. A、B 的邀请列表及睡眠/专注当前关系均指向同一对账号；
6. 重放同一幂等键不得重复创建关系。

旧 sleep/focus invite 路径仅用于兼容已发布客户端；新客户端不得继续生成旧领域邀请。

## 10. 2A 独立域决策与重试

新客户端将 §9 的预览结果作为唯一待处理入口：每个 `domain_results` 的 `decision_version` 是该域的 CAS 版本，`viewer_actions` 是当前账号可执行的操作；整单 `version/status` 是兼容聚合字段，不代表两个域已经作出相同决定。客户端展示每个域的真实状态，并可按终态结果派生展示标题。

1. 从 token/code/id 打开只读预览；未登录或错误账号返回中性 unavailable，保留定位信息并进入账号管理入口，不暴露收件邮箱或邀请人私人信息。
2. 登录/切换到正确账号后重新 GET 预览。登录、邮件打开及 App 重启均不自动 POST 决策。
3. 用户逐域选择 accept、decline 或（邀请人）cancel，调用 `/api/v1/frogsleep/buddy/invitations/{id}/domains/{sleep|focus}/{action}`。
4. 发送前持久化本次 actor、invitation、domain、action、expected_version、idempotency_key。响应丢失时只重试原命令；当前账号的一个未知结果未确认前，不用另一个域/动作覆盖它。账号切换清掉旧账号待确认命令，但保留 locator 供重新预览。
5. 部分完成后保留邀请及另一域按钮；全部终态后清 continuation。整单兼容接口返回部分冲突时也不显示整单成功。

接受只建立该域关系，不自动授权 presence、摘要或其他数据。两端 slot、决策 CAS、原关系回执和邀请事件在一个事务内提交。拒绝/取消不创建关系或 slot，在普通能力关闭时仍可执行；错误角色（包括拿到同 key 的邀请人回放收件人接受）不能获取回执。

原版本和同 key 的回放返回同一决策；accept 返回首次决定时的关系 ID 及它现在的 active/paused/revoked 状态。解除后更换当前搭子不会改变旧回执或产生新关系。不同 key 的终态操作、错误版本、pending 邀请过期和域占位冲突返回 409。新旧接受共享确定顺序的 slot 锁，整单兼容操作不能覆盖已由新协议决定的域；旧 child invitation 被同步为终态，避免继续显示待处理按钮。

022 迁移只在关系身份和创建时间都唯一匹配时回填旧回执；多候选或缺失记录保持不可猜测状态。当前验证为本机 API / PostgreSQL / iOS Simulator；真实邮箱、dev 双/第三账号和设备 deep link 仍须补证据，见 [本机验证记录](frogsleep-phase2a-invitation-closeout-verification-2026-10-11.md)。


## 11. 2A 接受后的独立授权与生命周期

新域关系不附带共享授权。接受后客户端通过统一关系列表/详情进入设置，GET grants 只依据服务端 `viewer_user_id` 选择本人方向，另一方向只读；同类别双方版本不得混用。PUT 一次提交四类原版本与本人选择，零版本为不存在的默认 revoked 项，批次具备事务原子性。请求和返回固定于同一登录身份。

关系 pause/resume/revoke/mute/unmute 命令带 `expected_version`。每个参与人独立暂停，恢复只解除本人暂停；静默只影响本人的关系通知。解除与拉黑撤销共享并释放仍指向原关系的 slot，旧邀请接受回放始终指向已终止的原关系，不能复活它或覆盖当前搭子。paused 不释放槽位，历史没有操作人信息的暂停按双方暂停处理。pending 兼容 Focus 邀请不能经暂停/恢复绕过收件人接受。

客户端在授权/生命周期操作前后清掉共享会话、摘要、共同目标/周报、presence、比较、消息缓存与待路由，取消或以 generation 拒绝延迟响应；私人计时与历史保留。恢复后从服务端重新加载，不复用已关闭会话。通知 route 每次打开重新检查真实目标、关系与当前方向授权，标记已读的异步间隙也不能重新放行失效路由。旧睡眠通知打开同样先重新获取 status snapshot。

详见 [接口说明](../README_API.md) 和 [本机验证记录](frogsleep-phase2a-lifecycle-closeout-verification-2026-10-11.md)。完整 dev 两账号/第三账号旅程、provider 与真机通知门槛仍待补证据。


## 12. 双账号从接受到个人/共享完成

双方独立登录，逐域接受后分别显式授权。canonical Focus 关系可直接读取current、比较及共享时刻；完成各自私人专注后固定owner队列上传，回放和并发不会重复个人统计或共同记录。shared moment返回稳定身份及以当前查看者为准的个人client session引用，旧server引用字段继续保留。

共同守护使用服务端确认的session，不用本地临时UUID显示成功。用户开始时才接受本人invited协调状态，后台刷新不自动代替用户确认。开始/仪式完成事件对应sleep_started/ritual_completed；断网重试原请求与原发生时刻，飞行中撤权/账号失效的旧响应不得回填缓存。A的morning_completed不能提前完成B的晨间状态；每人一份summary/recap，双方完成后共享session终态，同类重试幂等。

token失效提示重新登录并保留本人待上传队列；搭子暂停/解除/拉黑或撤回摘要授权时共享内容重新验权并清缓存，本人专注/睡眠与晨报仍继续。旧单主回顾重投影为查看者视角，缺失上下文及redacted占位不作为完成结果展示。本批覆盖本机真实HTTP与PG；dev、第三/可删除账号、真实通知/邮箱和设备仍待验收，见[旅程验证记录](frogsleep-phase2a-two-account-journey-verification-2026-10-11.md)。


## 13. 邀请通知与失败回退

邀请邮件provider接受不是送达，callback才能成为delivered。重试重验邀请、开关、已绑定收件人的类别偏好/拉黑；终态、失效、禁用不发送。processing超过15分钟或传输响应未知进入结果未知死信供核查，不能自动再发一封来假装恰好一次。已知provider失败有5次边界与退避，接受回执与并发claim保留。

站内通知与Push用同一notification ID，Sleep搭子中心可直接查看站内动态，不依赖Push权限、设备或provider是否可用。打开及已读后重新resolve当前权限，重复操作/账号切换不会沿旧路由继续。outbox到通用Push队列后每次发送仍检查权限和静默；确认成功设备保留回执，部分失败只重试失败设备。无设备终止Push而保留站内入口，响应未知保留待核查状态，不报设备送达。

同app/platform/token只保留当前注册人；换账号再次注册后旧账号任务不能向新主设备发送。升级迁移只处理已有显式设备注册，保留最近活跃记录并软删除旧重复。详见[API说明](../README_API.md)和[本机通知验证记录](frogsleep-phase2a-notification-closeout-verification-2026-10-11.md)。真实provider和设备证据继续单列，不能以测试sender代替。

设备历史若最新注册时间并列，069停止这些冲突token的活跃绑定，等待当前账号显式重新注册；不通过随机ID猜当前使用人。PG已验证并列停用、重新注册与旧主不能删除新主。
