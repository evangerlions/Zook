# LightTick 共享行动计划

业务 API 的唯一合同源为 `api-contracts/openapi/lighttick/api.yaml`，运行时使用同步生成的 `src/generated/openapi/**`。P0 v2 内部运行时已实现；**连接写入、新连接码、claim/import 均保持关闭**，原生端未在本轮修改。迁移074的账号 JSONB workspace 与事务锁继续使用，不新增第二套行动表，也不修改已有 goal/plan/task。

必须同时开启 LightTick 与 `LIGHTTICK_ACTIONS_ENABLED=1` 才提供读取；该既有开关不能打开P0写入。正式账号使用公共登录 Bearer 和 `X-App-Id: lighttick`，游客拒绝访问。

## HTTP 接口

以下均在 `/api/v1/lighttick` 下，标准 envelope 的 data 为业务结果，禁止缓存。

| 方法与路径 | 含义 |
| --- | --- |
| GET/POST `/action-plans` | 全量计划快照/内部创建合同；公共POST保持关闭 |
| POST `/action-plans/schedules` | 内容安排与来源/日期去重合同；公共POST保持关闭 |
| POST `/action-plans/{id}/operations` | edit/pause/resume/archive/cancel/complete/start/finish/snooze/reschedule/complete-time/reopen/reconcile-content；revision与key必填；公共写入关闭 |
| GET `/action-plans/requests/{key}` | 查询提交回执，处理丢失响应 |
| GET `/action-plans/records?page=1` | 每页30条，可加 plan_id |
| GET `/action-plans/reviews?plan_id=...&page=1` | 每页20条手动复盘和AI历史，各自总数 |
| POST `/action-plans/reviews` | 日期、plan_id、worked/obstacles/next_action 和 key |
| POST `/action-plans/reviews/preview` | 精确预览日期范围，include_notes/include_review 默认关闭；返回 snapshot_hash |
| POST `/action-plans/reviews/generate` | 同范围、snapshot_hash、consent=true、个人 ai_config 和 key；异步生成 |
| POST `/action-plans/{id}/reminder-claim` | 内部资格与设备去重合同；公共领取保持关闭 |
| GET `/action-plans/{id}/calendar.ics` | data 为 ICS 字符串，仅待执行日行动 |
| POST `/action-link-tickets` | 新接管入口保持关闭 |
| POST `/grow-bridge` | 保留受信签名读取/预览；claim/import及转发写入关闭，禁止浏览器直连 |

所有行动POST声明 `X-Grow-Action-Schema: 2`；签名桥接的内层POST使用 `action_schema_version:2`。认证先于版本检查；版本头不代替鉴权，也不启用写入。缺失/不支持版本返回409/CONTRACT_UPGRADE_REQUIRED；版本正确的写请求仍返回相同code，`data.reason=CONNECTION_WRITES_DISABLED`，且不创建行动、事实、回执或接管关系。没有新增可绕过此限制的环境变量。

GET及 `/reviews/preview` 为只读；后者仍需版本头。读取旧回执及超时总结的展示适配不持久改写workspace。现有公共envelope保持 `{code,message,data,requestId}`；P0领域错误的data包含 `retryable:false`，只按需公开安全的reason/current_revision/existing_plan_id，不传私人笔记或完整服务端对象。

## P0字段、状态与完成规则

新计划和事实写 `schema_version:2`。普通事项用check，明确时长用time，具体文章/课程用content；API省略completion_mode仍按旧调用默认time，不改变历史口径。

| 字段 | P0规则 |
| --- | --- |
| start_date/end_date | day可同时null，或同一天；其他周期保留有界日期和原层级校验 |
| at/reminder_at | 可空；不生成21:00。提醒要求日期、具体时间且reminder=true |
| time | target_minutes为1–1440整数；minimum_minutes可空，非空不超过标准；累计确认达标；estimated_minutes为null |
| content | 必须是受信私人来源清单中的具体article或plan lesson；target/minimum分钟阈值为null；estimated_minutes只作预计 |
| check | target及完成分钟阈值为null；明确勾选完成，不计时 |
| 状态 | active/paused/completed/archived；running属于session，账号最多一个 |

运行中拒绝其他修改；有事实后锁定模式、来源和分钟阈值，编辑标题等仍需合法revision。完成/归档后只读，completed check的reopen例外。暂停/完成/归档上级时有运行后代则409；上级非active阻断子行动执行。未安排/未来行动必须先明确改期再执行，不自动顺延。

time的finish只确认本次分钟，累计由服务端计算。5+15分钟可共同达到20分钟；未达标分别记minimum/partial，中断即使累计达标也保持active，需要显式complete-time。墙钟、刷新和后台停留不自动完成。check完成写零分钟completion，撤销追加reversal引用原事实，不删历史；再次完成仍只有一项有效完成。

content的计时结束为recorded，只计投入；完成必须消费当前账号、相同归一化target、合法发生日期的持久来源事件。事件一次只绑定一项行动，过去安排需明确origin；无origin只匹配确认当日安排，未来/未安排不能核对完成。running不被来源确认静默结束，先结算投入再核对。延迟核对使用原confirmed_at，记录写入时间另存recorded_at。

**本轮不提供来源登记或事件注入的HTTP入口。** 运行时只消费内部受信数据，测试在隔离仓库明确装载这些数据；真实Grow来源证明、可靠投递和账号绑定校验属于下一阶段，不能把内部测试通过当作已接入来源。读取能力返回 `action_schema_version:2`，但 `content_receipts:[]`、`connection_write_enabled:false`、`source_delivery_enabled:false`、`v2_import_enabled:false`。

内容安排按账号、归一化来源、时区和日期桶（含null桶）去重；重复schedules返回同ID及existing=true，不覆盖已有配置/状态/revision。通用创建或改期冲突返回409/DUPLICATE_SCHEDULE；撤销日期清空时间与提醒，旧事实快照保留。

事实分session/completion/reversal；分钟只累计已结算session，完成按当前有效完成行动去重，minimum/partial/interrupted分开。v2 session日期按开始瞬间的行动时区，completion/reversal按确认时刻；原计划日另存planned_date。补做/跨午夜不移动旧投入，复盘可选实际发生范围，最大366天。v1原business_date与完成结论保留，读适配标legacy_planned，不重写旧快照。

| HTTP | 稳定P0 code |
| --- | --- |
| 422 | VALIDATION_ERROR、FUTURE_ACTION、UNSCHEDULED_ACTION |
| 409 | REVISION_CONFLICT、STATE_CONFLICT、RUNNING_CONFLICT、DUPLICATE_SCHEDULE、COMPLETION_EVIDENCE_MISSING、CONTRACT_UPGRADE_REQUIRED |
| 404 | 继续使用LIGHTTICK_RESOURCE_NOT_FOUND，不泄露外账号来源/事件/行动 |

幂等回执在行动事务内与事实共同提交；同key同payload重放原结果，不同payload409；不同key不取代来源业务去重。未知提交结果保留原包/key核对或重试，不能因为not found自动换key重建。

AI 配置只在已明确确认的请求内使用，不持久化凭据、不使用公共模型兜底；总结为建议，不自动修改计划。生成超过120秒未完成会标记中断，需主动重试。原生客户端查看历史，网页完成数据预览与生成确认。

## 接管与恢复

双方服务端配置同一 `GROW_ACTION_BRIDGE_SECRET`（至少32字符）。Grow 配置固定 `LIGHTTICK_BRIDGE_URL`（HTTPS，仅 localhost 允许 HTTP）。签名头 X-Grow-Account-Id/Timestamp/Nonce/Signature，对来源账号、秒时间戳、随机nonce、递归排序紧凑JSON用换行连接后做 HMAC-SHA256。来源账号必须来自服务器登录上下文，签名时间窗两分钟、连接码有效期五分钟。TLS与密钥保密是信任边界；nonce不是业务幂等键，写入使用请求 key。

既有v1接管函数仅为历史协议保留测试；公共接管当前关闭。旧导入器明确拒绝v2计划/事实/事件或未知快照版本，在写入前报CONTRACT_UPGRADE_REQUIRED，保持staged且不改workspace。后续v2接管必须包含事件、消耗关系、事实、旧key与claims的完整清单/哈希/计数，再独立做失败恢复验收，不能仅修改版本标记后复用旧包。

来源/目标一对一与签名校验保留；不回退Grow本地双写、不自动解绑。历史容量4MiB/1000计划/10000执行/2000复盘继续保留。备份、连接码、凭据不得写日志。

## 原生提醒边界

本轮未修改或验证原生消费者、系统通知与设备日历。内部运行时校验08:00–22:00窗口、日期/时间、状态/祖先、running及设备claim去重；无at不能生成假日历，有at但reminder=false可导出无alarm的文本。这些测试不代表实机已支持P0通知。

## 隔离验收

`test/support/serve-action-link-fixture.ts` 使用显式 localhost PostgreSQL，建立独立数据库、合成公共登录账号和真实产品持久层；退出清理。模型使用确定性返回，无外部模型调用。对应 Grow fixture 为 `server/tests/serve_action_link_fixture.py`，使用真实 cookie 登录和独立 PostgreSQL schema。禁止对生产环境运行 fixture，未迁移真实账号。


阶段验证、剩余阻塞和复现命令见 [P0 v2实施记录](verification/lighttick-p0-v2/README.md)。仍需完成来源投递、v2接管、原生消费者及真实双端验收，当前不得开放连接写入。
