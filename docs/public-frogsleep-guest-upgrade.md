# FrogSleep 云游客与安全升级

Canonical 前缀 `/api/v1/frogsleep`。仅用于新建的云游客；历史设备 ID 或本地离线记录没有云归属凭据，不能用来认领他人数据。OpenAPI 唯一来源为 `api-contracts/openapi/frogsleep/api.yaml`。

| 方法与路径 | 鉴权与用途 |
| --- | --- |
| `POST /account/guest-sessions` | 无 Bearer；以独立设备密钥创建或恢复受限游客 |
| `GET /me` | 游客 Bearer；返回本人资料及 `is_guest,guest_expires_at` |
| `POST /auth/token/refresh` | 常规 refresh token；不延长游客身份有效期 |
| `POST /account/upgrade` | 已注册目标账号 Bearer；证明来源所有权并原子迁移 |

创建正文：`{"device_id":"client-random-id","device_secret":"<32字节以上安全随机数的base64url>","platform":"ios"}`，platform 也支持 android。必填 `Idempotency-Key`（1..200字符，随机且发送前持久化）。不得将设备硬件 ID、用户名、密码或可预测值作为 device_secret。密钥与后续升级凭据存入 Keychain/Keystore，不能进日志、分析事件、分享链接或备份明文。

响应 `data` 含常规 `access_token,refresh_token,user_id,app_id`，以及 `guest_user_id,guest_upgrade_token,guest_expires_at,is_guest:true`；顶层保留 FrogSleep 兼容别名。服务器仅保存设备/密钥/升级凭据哈希。相同 device_id + device_secret 恢复同一个未过期、未转移的身份和升级凭据；相同 key 改正文返回409。设备 ID 相同但密钥不同不会恢复旧身份。创建响应丢失时复用原 key 和正文；凭据丢失不能靠设备 ID 找回数据。

游客身份有效期固定30天，refresh 和恢复不续期；过期/已删除/已升级身份返回401，重新开始需生成新设备随机 ID 和新密钥。数据不因凭据到期自动压缩或删除；主动清理用 `DELETE /me/account`。匿名创建/恢复含重试按来源 IP 每 UTC 小时最多30次，超限429 `FROGSLEEP_GUEST_RATE_LIMITED`。

游客仅允许私人的 `product-data/sleep-sessions`、`sleep-reports`、`progress/report_preferences`、`personal-sync/{state,restore,changes}`，以及本人 me、logout、account-delete。中央鉴权同时限制公共平台接口；不能绑定邮箱/手机、改密码、管理推送设备、访问搭子、专注、权益或其他产品。访问限制返回403 `FROGSLEEP_GUEST_SCOPE_FORBIDDEN`；过期/被转移的会话返回401。原始会话和报告按 [私人同步协议](public-frogsleep-personal-sync.md) 上报。

升级顺序：

1. 暂停游客上传队列，保留游客 ID、升级凭据及设备 ID；用户登录或注册正式 FrogSleep 账号。
2. 用正式账号读取 `product-data/personal-sync/state`，恢复其已有数据，展示来源和目标并取得明确确认。
3. 正式账号 Bearer 调用 `POST /account/upgrade`；必填当前目标 `X-Sync-Epoch` 和持久化 `Idempotency-Key`，正文如下。
4. 成功后丢弃游客 access/refresh/升级凭据与旧同步队列，按目标 epoch 完成 restore/changes。不得把旧游客上传直接改成目标账号请求。

```json
{
  "guest_user_id": "sleep_guest_<opaque-id>",
  "guest_upgrade_token": "fs_upg_<secure-credential>",
  "device_id": "client-random-id",
  "confirmed": true
}
```

成功 `data`：`user_id,previous_guest_user_id,migrated_data_count,deduplicated_data_count,sync_epoch`。每个资源仅迁移最新修订，包括删除墓碑；目标生成自己的 revision/sequence，保留目标 epoch。迁移范围为私人原始睡眠记录、报告、报告偏好；不迁移运行中设备锁、搭子授权/关系、权益、推送设备或专注数据。迁入资源通过目标 changes 可见。目标同 kind/id、同正文或同墓碑去重；不同正文、活动记录与墓碑冲突均409 `FROGSLEEP_GUEST_DATA_CONFLICT`，整次迁移回滚，不覆盖或复活目标数据。

来源与目标 membership 行锁协调普通上传和删号，版本/回执/目标写入/来源清除/来源失效/审计同一数据库事务提交。来源旧 epoch 旋转，membership 标为删除；旧 access/refresh 随后撤销。KV 撤销暂时失败时，SQL membership 已阻断来源访问；请求可能返回5xx但迁移已提交，必须保留原请求并按原 key 重试，不能据此当作未迁移。

重试同时校验正式目标认证、来源凭据、设备 ID、原 key、完整正文和目标 epoch；完全一致才返回原计数并重试会话清理。换目标或换 key 返回409 `FROGSLEEP_GUEST_ALREADY_UPGRADED`。错误证明/失效来源统一401 `FROGSLEEP_GUEST_PROOF_INVALID`；非正式目标403 `FROGSLEEP_REGISTERED_ACCOUNT_REQUIRED`；缺确认/正文/头400；目标重建导致 epoch 改变返回409。原子迁移最多10,000个最新资源和32 MiB序列化版本，超限409 `FROGSLEEP_GUEST_TRANSFER_TOO_LARGE`，不截断、不部分迁移。来源封禁/删除/到期后不能首次迁移；已提交回执可用于原请求确认，但不能重新认领数据。

兼容旧正文 `{"guest_device_id":"..."}` 的升级请求仍在正式账号鉴权后返回409 `FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED`，不读取或迁移设备 ID 对应记录。历史本地游客可在真实用户确认后，通过标准登录账号上传报告、终态原始睡眠与终态专注记录；不要伪造云游客凭据。

迁移073保存游客身份哈希、创建幂等回执和一次升级回执。最小身份/回执随共享用户存在而保留，FrogSleep 删号会清除私人历史并撤销 membership，不会复活旧游客或影响其他产品；后续清理策略需保持防重放与不可恢复约束。客户端凭据存储、确认 UI、恢复和真机/dev验收仍须客户端单独落地。
