# FrogSleep 私人同步 API

Canonical 合同：`api-contracts/openapi/frogsleep/api.yaml`；运行时只使用 `src/generated/openapi/**`。个人同步范围是私人原始终态睡眠记录、报告摘要与 `report_preferences`；支持受限云游客身份，不恢复活动设备锁或计时状态。私人数据不经 Buddy 授权接口共享。

| 方法与路径（前缀 `/api/v1/frogsleep/product-data`） | 行为 |
|---|---|
| `POST /sleep-reports` | 以稳定 `snapshot_id` 首次保存或幂等重放；同内容不增加修订/统计 |
| `GET /sleep-reports` | `limit=1..100,cursor`；数据库分页覆盖全部报告，固定历史边界，保留 recorded_at/ID 降序浏览 |
| `GET /sleep-reports/{snapshotId}` | 本人当前报告；墓碑返回404 |
| `PUT /sleep-reports/{snapshotId}` | 正文 `snapshot_id` 与路径一致；修改要求当前 `If-Match` |
| `DELETE /sleep-reports/{snapshotId}` | 当前修订删除，原子写入墓碑与变更；重复删除幂等 |
| `GET /progress/report_preferences` | 当前偏好；不存在/已删除时保持旧 `progress:null` 兼容 |
| `PUT/PATCH /progress/report_preferences` | 首次创建或带修订修改偏好，响应增加 revision/epoch |
| `DELETE /progress/report_preferences` | 原子删除该偏好；不扩展到其他进度 namespace |
| `GET /personal-sync/state` | `sync_epoch,sequence,capabilities` |
| `GET /personal-sync/restore` | 固定提交边界的本人原始睡眠/报告/偏好历史视图，含墓碑 |
| `GET /personal-sync/changes` | 提交有序的本人变更（含墓碑），从 opaque cursor 继续 |

写入头：`X-Sync-Epoch` 当前账号 epoch；`Idempotency-Key` 1..200字符稳定操作 ID；`If-Match` 裸数字或双引号数字的当前 revision。新资源支持缺省或0；修改、删除已有资源必须匹配。scope 仅来自 Bearer token，不能用正文覆盖归属；用户断言必须匹配本人，owner/app 覆盖被拒绝。每账号、资源种类和逻辑 ID 独立；操作 key 在账号内唯一，重用不同正文返回409。相同正文的新 key 也保存回执，不增加 sequence。

报告 wire 响应保留 `snapshot_id,report_id,schema_version,recorded_at,date_anchor,report_type,snapshot_data,created_at,updated_at`，新增稳定逻辑 `id,revision,sequence,sync_epoch`。`id` 是不透明字符串，客户端不得强制转 UUID 或将不同账号相同 ID 混为同一记录。

恢复顺序：先读取 state，再完成 restore 所有 `pagination.next_cursor` 页，最后使用返回的 `changes_cursor` 追增量。恢复期间更新、删除、新建不会改变已固定视图；完成后必须应用增量墓碑，禁止把恢复结果当新上传。增量页的 `next_cursor` 继续当前批次；没有更多页时继续保存 `changes_cursor`，供下一次轮询。游标由持久化账号秘密签名，绑定账号、epoch、模式和资源筛选；首次签发后7天失效，过期需完整恢复。

| 错误 | HTTP | 客户端处理 |
|---|---|---|
| `FROGSLEEP_SYNC_IDEMPOTENCY_CONFLICT` |409|同操作 key 内容改变；保留本机候选并人工/产品规则消歧 |
| `FROGSLEEP_SYNC_REVISION_CONFLICT` |409|读取当前修订，禁止无条件覆盖 |
| `FROGSLEEP_SYNC_EPOCH_MISMATCH` |409|暂停旧队列、恢复当前账号，禁止自动给旧请求补新epoch |
| `FROGSLEEP_SYNC_CURSOR_INVALID` |409|跨账号/模式/筛选、篡改或过期；重新恢复 |
| `FROGSLEEP_SYNC_RESOURCE_NOT_FOUND` |404|不存在或当前已删除 |
| `FROGSLEEP_SYNC_RESOURCE_DELETED` |410|旧写入/重放不可复活墓碑 |
| `FROGSLEEP_SYNC_DISABLED` |503|保持本机流程与待同步状态 |

## 迁移、保留和回滚

070扩展 sync state、不可变 versions、幂等 receipts；主键/索引按 app/user/kind/resource/sequence。账号行事务锁持有到提交，资源修订、事件、回执同事务，sequence 不是 bigserial 或业务 recorded_at。071在同一迁移事务锁定账号状态、回填、更新位点，避免在线写入期间倒退。

071建立旧 row ID alias 审计映射；同snapshot+同正文合并为一条；不同正文保留为独立 `__legacy_conflict__:<old_id>` 资源，原 snapshot_id 仍保留在 data，客户端以 resource `id` 区分并提示消歧，不自行覆盖。旧表在扩展阶段保留；report_preferences 取最近 updated_at/ID 的状态，不上传累计进度 namespace。

本批**不自动压缩**版本、墓碑、变更或回执，账号存在期间持续保留。因此旧 tombstone/操作 key 不因超时失去保护，固定视图可回放。启用压缩前须另开任务：先旋转epoch、拒绝旧请求、使旧游标失效，再清理保留范围；不能直接删除墓碑。报告删除是逻辑删除，恢复中的历史视图仍可能含旧正文；随后增量墓碑负责删除本机恢复副本。账号删除在既有 app-scoped 事务清除全部版本、回执、alias 与旧产品记录，保留最小 epoch guard、禁止旧无epoch写入；其他 App 数据不受影响。重新激活会员后，读取新epoch并显式确认新的保存意图才可写入。

首代账号允许旧客户端不带 epoch；账号删除后此兼容永久关闭。既有修改遇409必须升级/处理冲突，不再随机插入重复快照。`FROGSLEEP_PERSONAL_SYNC_READ_ENABLED` 与 `FROGSLEEP_PERSONAL_SYNC_WRITE_ENABLED` 独立控制，缺省启用；置 `false` 关闭。回滚优先关闭写入，保留读取和墓碑；不得回滚到继续随机插入旧表的写端。先部署API/扩展迁移，再发布接入客户端，当前dev双设备/真实provider/上线仍是单独门槛。

共享样本：`test/fixtures/frogsleep-personal-sync.json`，其中游标为不可执行的 wire 示例。后端现已提供原始历史与凭据升级；客户端2B持久化恢复、确认界面及两平台发布仍需单独验收。


## 2026-10-18 整合说明

报告列表兼容 `since` ISO时间，严格筛选 `recorded_at > since`；分页继续使用相同筛选值，游标绑定规范化的时间和固定sequence边界。非法时间400，改变筛选的游标409。该参数不能追踪过去报告的修订和删除；请使用提交有序的changes及墓碑协议。绑定上传校验owner来自认证主体，其他账号owner返回403；app覆盖返回400。云游客使用独立凭据和正式目标账号鉴权原子升级；仅设备ID的旧请求仍409。本地确认导入仍通过标准上传入口。

## 原始终态睡眠记录

迁移072把 `sleep_session` 纳入同一版本、墓碑、epoch、restore/changes 和删号协议。原始资源私有，不与搭子共享；云游客也可使用，但须遵守 [游客凭据与升级协议](public-frogsleep-guest-upgrade.md)。

| 方法与路径（同 product-data 前缀） | 行为 |
| --- | --- |
| `POST /sleep-sessions` | 以稳定 `session_id` 创建终态记录或幂等重试 |
| `GET /sleep-sessions` | `limit,cursor` 固定边界分页，按提交 sequence 升序，含最新墓碑；返回标准 `items` 页 |
| `GET /sleep-sessions/{sessionId}` | 当前本人记录，已删除404 |
| `PUT/PATCH /sleep-sessions/{sessionId}` | 完整替换请求；路径 ID 必须匹配，修正内容需当前 If-Match |
| `DELETE /sleep-sessions/{sessionId}` | 当前修订写入墓碑，旧上传不能复活 |

所有原始写入和删除均必填 `X-Sync-Epoch` 与 `Idempotency-Key`。响应 `data.sleep_session` 为 `{kind:"sleep_session",id,revision,sequence,deleted,data,created_at,updated_at,sync_epoch}`；其中内层 `data` 保存下列规范化原始正文，避免覆盖 Zook envelope 的 data。列表的 changes_cursor 可直接在统一 personal-sync/changes 使用，包含账号的全部资源种类；客户端按 kind 分发。

```json
{
  "session_id": "night-2026-10-17-device-a",
  "schema_version": "1",
  "status": "completed",
  "started_at": "2026-10-17T22:00:00+08:00",
  "ended_at": "2026-10-18T06:00:00+08:00",
  "scheduled_wake_at": "2026-10-18T06:30:00+08:00",
  "timezone": "Asia/Shanghai",
  "sleep_intent": "night_sleep",
  "data": {"break_count":1,"ritual_mode":"locking","track_name":"rain"},
  "events": [{"event_id":"break-1","type":"paused","occurred_at":"2026-10-17T23:00:00+08:00","data":{"reason":"water"}}]
}
```

schema_version 仅 `"1"`；status 仅 `completed,cancelled,interrupted`；sleep_intent 仅 `night_sleep,daytime_nap,catch_up_sleep`。时间需带时区，服务端统一 UTC；ended_at 和可选 scheduled_wake_at 不早于 started_at。timezone 为有效 IANA 时区。data 为必填 JSON 对象，可保留双端历史模型字段；events 可省略（规范化为空数组），最多512条，event_id 在会话内唯一、1..200字符，type 为小写字母开头的字母/数字/下划线（最多64字符），每条必填 data 对象和会话起止范围内 occurred_at。整个 UTF-8 JSON 请求最多128 KiB，嵌套深度最多32层，数值必须有限；额外顶层字段、无效类型和越界时间返回400。可选 user_id/owner_user_id 只作本人断言，跨账号403；owner/app 覆盖400。

不接收 active 状态。恢复的设备锁、暂停计时、后台状态只作为历史 data，客户端不得据此启动锁定或恢复运行中流程。该能力保存客户端提供的历史，不自动计算睡眠阶段、诊断或生成报告；也不自动把 shared-session 关系数据导入私人原始空间。

报告和 report_preferences 的 DELETE 响应将完整墓碑回执放在 `data.resource`（含 revision、sequence、sync_epoch），同时保留顶层 metadata 兼容字段；内层私有 data 不再覆盖标准 envelope.data。原始睡眠 DELETE 使用 `data.sleep_session`。
