# BodyLog 账号资料上线与回滚 Runbook

## 范围

本次能力只包含共享邮箱验证码登录和 BodyLog app-scoped 用户资料。服务端不接收习惯名称、
打卡明细，不承担云同步或设备迁移。

## 上线前

1. 通过 `POST /api/v1/admin/apps` 创建 `id/code = bodylog` 的 active app，入组模式使用 `AUTO`。
2. 配置中文名和英文名均为 `BodyLog`，并创建默认 `member` 角色与
   `auth.default_role_code = member`。
3. 确认 Common 邮件配置已启用 Tencent SES，发件域名、模板、Secret 引用和中国内地/海外
   region 均有效。
4. 在部署数据库执行 migrations，确认 `021_bodylog_profiles.sql` 已记录在
   `zook_schema_migrations`。
5. 保持 iOS 账号功能开关关闭，先完成服务端验证。

## 冒烟验证

1. 调用 `GET /api/health`，确认状态为 `ok`。
2. 使用非生产测试邮箱调用 `/api/v1/auth/login/email-code`，请求体中的 `appId` 为
   `bodylog`，确认邮件可达。
3. 调用 `/api/v1/auth/login/email` 完成登录，保存 BodyLog access token。
4. 携带 `Authorization: Bearer ...` 和 `X-App-Id: bodylog` 调用
   `GET /api/v1/bodylog/profile`，确认 `profileCompleted = false`。
5. 调用 `PUT /api/v1/bodylog/profile` 更新允许的昵称和预设头像，再次读取并比对。
6. 用其他 app token 调用资料接口，确认返回 `403 AUTH_APP_SCOPE_MISMATCH`。
7. 确认日志、审计和内容安全记录中没有保存 access token、验证码或额外打卡数据。

## 监控

- 观察邮箱验证码发送失败率、认证 4xx/5xx 和资料接口 5xx。
- 关注 `BODYLOG_PROFILE_UNSAFE` 数量；它是正常内容安全拒绝，不应计为服务故障。
- 核对 `zook_bodylog_profiles` 增长量与 BodyLog 新登录用户量级一致。

## 回滚

1. 先关闭 iOS 账号功能开关，客户端继续使用本地打卡能力。
2. 回滚 API 版本；保留 `zook_bodylog_profiles` 表，避免破坏用户资料和阻塞旧实例。
3. 如需暂停 BodyLog 登录，将 app 状态或入口开关关闭；不要删除共享 Zook 用户。
4. 不在紧急回滚中删除 migration 或表。确认不再需要数据后另行走数据清理审批。
