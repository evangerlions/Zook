# LightTick 共享行动计划

新增业务 API 的合同源为 `api-contracts/openapi/lighttick/api.yaml`。迁移074为新增表，不改变现有 goal/plan/task。必须同时开启 LightTick 与 `LIGHTTICK_ACTIONS_ENABLED=1`，正式账号通过公共登录 Bearer 和 `X-App-Id: lighttick` 使用；游客拒绝访问。

## HTTP 接口

以下均在 `/api/v1/lighttick` 下，标准 envelope 的 data 为业务结果，禁止缓存。

| 方法与路径 | 含义 |
| --- | --- |
| GET/POST `/action-plans` | 全量计划快照/创建年、月、周、日计划；创建包含唯一 key |
| POST `/action-plans/{id}/operations` | edit/pause/resume/archive/complete/start/finish/snooze；必须传 revision 与 key |
| GET `/action-plans/requests/{key}` | 查询提交回执，处理丢失响应 |
| GET `/action-plans/records?page=1` | 每页30条，可加 plan_id |
| GET `/action-plans/reviews?plan_id=...&page=1` | 每页20条手动复盘和AI历史，各自总数 |
| POST `/action-plans/reviews` | 日期、plan_id、worked/obstacles/next_action 和 key |
| POST `/action-plans/reviews/preview` | 精确预览日期范围，include_notes/include_review 默认关闭；返回 snapshot_hash |
| POST `/action-plans/reviews/generate` | 同范围、snapshot_hash、consent=true、个人 ai_config 和 key；异步生成 |
| POST `/action-plans/{id}/reminder-claim` | device_id/reminder_at 幂等领取，返回 notify |
| GET `/action-plans/{id}/calendar.ics` | data 为 ICS 字符串，仅待执行日行动 |
| POST `/action-link-tickets` | 五分钟有效连接码，仅存哈希，新码替换旧码 |
| POST `/grow-bridge` | 受信服务端 preview/claim/import/request，禁止浏览器直连 |

每账号最多一个进行中执行。起步、部分执行、中断和达标分别统计；上级累计下级事实，不写课程完成。执行业务日期按计划时区固定。冲突409、校验422、服务未开启503。客户端发出前持久化原请求和 key，未知结果重试原包，离线快照只读。

AI 配置只在已明确确认的请求内使用，不持久化凭据、不使用公共模型兜底；总结为建议，不自动修改计划。生成超过120秒未完成会标记中断，需主动重试。原生客户端查看历史，网页完成数据预览与生成确认。

## 接管与恢复

双方服务端配置同一 `GROW_ACTION_BRIDGE_SECRET`（至少32字符）。Grow 配置固定 `LIGHTTICK_BRIDGE_URL`（HTTPS，仅 localhost 允许 HTTP）。签名头 X-Grow-Account-Id/Timestamp/Nonce/Signature，对来源账号、秒时间戳、随机nonce、递归排序紧凑JSON用换行连接后做 HMAC-SHA256。来源账号必须来自服务器登录上下文，签名时间窗两分钟、连接码有效期五分钟。TLS与密钥保密是信任边界；nonce不是业务幂等键，写入使用请求 key。

先显示目标账号和精确计数，再由本人确认。Grow 在已有事务锁内冻结旧写入并保存私有不可变备份，导入后核对 snapshot_hash、source_counts、binding_id、target_user_id 才激活代理。响应丢失时保持只读，重试同一备份；不得回退为本地写入。来源和目标均一对一绑定，禁止新包覆盖已完成接管。首版上限4MiB/1000计划/10000执行/2000复盘。备份、连接码、凭据不得记入日志。

## 原生提醒边界

iOS 本地通知在回到前台时按最新快照重新安排；账号切换、暂停、完成会取消。App关闭期间网页变化无法保证立刻撤销系统已排定通知，点击仅打开计划并重新核对。Android WorkManager 送达前重新验证账号、来源和最新计划，受联网、系统省电与调度影响；不承诺精确闹钟。均遵守22:00–08:00免打扰，不通过提醒直接完成课程。

## 隔离验收

`test/support/serve-action-link-fixture.ts` 使用显式 localhost PostgreSQL，建立独立数据库、合成公共登录账号和真实产品持久层；退出清理。模型使用确定性返回，无外部模型调用。对应 Grow fixture 为 `server/tests/serve_action_link_fixture.py`，使用真实 cookie 登录和独立 PostgreSQL schema。禁止对生产环境运行 fixture，未迁移真实账号。
