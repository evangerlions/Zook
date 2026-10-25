# LightTick 共享行动计划

业务 API 的唯一合同源为 `api-contracts/openapi/lighttick/api.yaml`，运行时使用同步生成的 `src/generated/openapi/**`。P0 v2 运行时和原生消费者已在本地整合候选中实施。连接写入、新连接码与完整 v2 接管默认关闭；本页 2026-10-25 节说明单独启用条件。迁移074的账号 JSONB workspace 与事务锁继续使用，不新增第二套行动表，也不修改已有 goal/plan/task。

必须同时开启 LightTick 与 `LIGHTTICK_ACTIONS_ENABLED=1` 才提供读取；该既有开关不能打开P0写入；还需显式 `LIGHTTICK_ACTIONS_V2_ENABLED=1`。正式账号使用公共登录 Bearer 和 `X-App-Id: lighttick`，游客拒绝访问。

## HTTP 接口

以下均在 `/api/v1/lighttick` 下，标准 envelope 的 data 为业务结果，禁止缓存。

| 方法与路径 | 含义 |
| --- | --- |
| GET/POST `/action-plans` | 全量计划快照/内部创建合同；默认关闭，需v2开关及版本头 |
| POST `/action-plans/schedules` | 内容安排与来源/日期去重合同；默认关闭，需v2开关及版本头 |
| POST `/action-plans/{id}/operations` | edit/pause/resume/archive/cancel/complete/start/finish/snooze/reschedule/complete-time/reopen/reconcile-content；revision与key必填；默认关闭，需v2开关及版本头 |
| GET `/action-plans/requests/{key}` | 查询提交回执，处理丢失响应 |
| GET `/action-plans/records?page=1` | 每页30条，可加 plan_id |
| GET `/action-plans/reviews?plan_id=...&page=1` | 每页20条手动复盘和AI历史，各自总数 |
| POST `/action-plans/reviews` | 日期、plan_id、worked/obstacles/next_action 和 key |
| POST `/action-plans/reviews/preview` | 精确预览日期范围，include_notes/include_review 默认关闭；返回 snapshot_hash |
| POST `/action-plans/reviews/generate` | 同范围、snapshot_hash、consent=true、个人 ai_config 和 key；异步生成 |
| POST `/action-plans/{id}/reminder-claim` | 内部资格与设备去重合同；默认关闭，需v2开关及版本头 |
| GET `/action-plans/{id}/calendar.ics` | data 为 ICS 字符串，仅待执行日行动 |
| POST `/action-link-tickets` | 需v2开关及版本头；五分钟一次性连接码 |
| POST `/grow-bridge` | 保留受信签名读取/预览；claim/import及转发写入默认关闭，显式v2开关开启后可用，禁止浏览器直连 |

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

**2026-10-20 内部切片的原边界（后续 C2/C3 和下述 2026-10-25 接入已扩展）：** 运行时只消费内部受信数据，测试在隔离仓库明确装载这些数据；真实Grow来源证明、可靠投递和账号绑定校验属于下一阶段，不能把内部测试通过当作已接入来源。读取能力返回 `action_schema_version:2`，但 `content_receipts:[]`、`connection_write_enabled:false`、`source_delivery_enabled:false`、`v2_import_enabled:false`。

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

## C2 私有来源通道（2026-10-21）

已生效绑定可以使用原 `POST /api/v1/lighttick/grow-bridge` 投递 Grow 服务端证明的来源确认。它不是通用行动命令入口：所有原生/普通 action POST、桥接 action request POST（只读 review preview 除外）、新配对和 v2 import 继续拒绝。公共能力开关保持关闭；私有投递可用不等于消费者可以开启连接写入。

四类消息均要求原有 HMAC 头、`action_schema_version:2`、匹配的 `binding_id`、active 绑定与 active 注册会员：

| action | 输入 | 输出/影响 |
| --- | --- | --- |
| source-context | normalized_target、origin_action_id | 已有 v2 content 行动的签名上下文；只读，不登记来源/生成完成 |
| source-confirmation | event | 持久收件与合格行动匹配；来源、事实、绑定和操作回执同事务 |
| source-receipt | event_id | 纯读当前持久回执；不消耗事件 |
| source-reconcile | event_id | 再核对同一事件，不能选择另一 target/action 或结束 session |

事件最小形状为 `event_id:source-<32hex>`、article/plan 的严格归一化 `normalized_target`、UTC `confirmed_at`、`source_proof:{version:1,confirmation:article_read|lesson_completed}`。可选 origin_action_id 非空时必须带 Zook 签发的 origin_context；证明覆盖绑定、来源、行动、原计划日期/时区和七日确认窗口，延迟投递不因七日到期丢失有效确认。来源成功后才由 Grow 的私有 journal 持久 outbox；客户端不能仅凭 target、已读位或笔记制造证明。传输不包含正文、标题、评论、笔记、AI 凭证或 Grow schema。

回执包含 accepted、binding_id、target_user_id、event_id、payload_hash、status、completed_arrangements（最多一项）、record_id 和 reason。`accepted:true/status:pending` 只表示已收件；`completed` 才表示已生成完成事实。来源确认对 running 返回 pending/RUNNING_CONFLICT，不改变真实会话；保存投入后 source-reconcile 可恢复。无 origin 只匹配确认日；未来/未安排/暂停或祖先阻断不因重试被绕过。完成日期使用原确认时刻，分钟为零。

同 event ID + canonical event SHA256 返回原事件当前结果；载荷变化返回 `409 SOURCE_EVENT_CONFLICT`。错误绑定/未连接返回 404；会员无效/签名无效返回 403；伪造上下文为 `SOURCE_PROOF_INVALID`，缺失/类型不合法为 422 VALIDATION_ERROR；未配置为 503 SOURCE_DELIVERY_UNAVAILABLE（可重试）。5xx、断网和丢响应重试原事件并重新签传输 timestamp/nonce，禁止换 event ID 猜测重建。接收后事务失败不保留半条 inbox、来源登记、事实或回执。

Grow 使用租户私表 action_source_contexts/action_source_outbox，启动即扫描、每 30 秒恢复，退避上限一小时。`GET /api/action-link/source-deliveries` 查看本账号状态；同源 `POST /api/action-link/source-deliveries/retry` 触发最多三条安全重试。缺少上下文时来源仍成功，事件 blocked/ORIGIN_CONTEXT_REQUIRED，须恢复连接后重新打开来源明确确认；不能事后补造旧快照。后台扫描仅使用服务端账号身份，不接收请求里的账号/schema。

该 C2 阶段尚未实施 C3；后续内部 C3 结果见下节，消费者放行仍未执行；没有真实配对、原生接入、部署或生产数据迁移。验证证据见 `docs/verification/lighttick-source-delivery/README.md`。

### C2 验收后的合同维护

2026-10-21 补齐 P0 条件分支中已被 required 引用的 properties 声明，保留外层原有字段约束、null/省略语义及所有写入门禁。此变更不新增字段或放宽输入验证；生成合同同步更新，空声明归一化对比及 AJV 合同测试见 `docs/verification/lighttick-source-repair/`。

## C3 内部快照 v2（2026-10-21，公开接管仍关闭）

新增唯一合同 `LightTickActionHandoffSnapshot/Event`，供受信任 Grow 导出与内部 `ActionHandoffService` 验收使用。`snapshot_version=2` 包含八类数据：plans、records、reviews、reports、operations、claims、content_sources、content_events；规范 JSON SHA-256、4 MiB 上限。混合 v1/v2 的原始行动与历史事实保留；不重算历史复盘。事件携带明确确认、源请求 key/hash 和消费绑定，Zook 从已绑定来源身份映射 owner_id，保留 handoff_source 审计信息；不接受客户端自填 owner、source_result、正文或来源反馈库存。

内部 `preflight(source,input)` 在账号事务锁中只读校验整个合并图，返回 binding_id、target_user_id、snapshot_hash、八类 source_counts、target_version；`import(source,{...input,target_version})` 重新验证，要求目标版本未变化，工作区和接管回执同事务提交。保存回执失败会回滚；相同 binding/hash 重试直接返回持久回执，不因目标后续版本变化重复导入；另一个快照拒绝覆盖。目标已有其他来源事件、重复对象/消费、断裂完成/撤销引用、运行冲突、旧请求 key 冲突、生成中报告均被拒绝。

现有 grow-bridge 的 v2 import 输入合同引用该 schema；**运行时仍无条件通过 CONNECTION_WRITES_DISABLED 拒绝公开 import/claim/普通行动写入，未增加预检 HTTP 路由或新开关**。Grow 私有协调器已实现预检后重核摘要、来源发布屏障、原子封存备份/冻结、幂等导入及回执核对后激活；pending 新来源确认在发布前暂停，未完成发布日志阻断预检与冻结。迁移来源事件的持久核对回执与目标图同事务提交，Grow 的 C2 outbox 与本地激活同事务提交。目标版本变化返回 REVISION_CONFLICT / HANDOFF_TARGET_VERSION_CHANGED，只允许用同一冻结备份重预检。原生 C4/C5、真实账号和公开放行仍未完成。最新证据见 `docs/verification/lighttick-handoff-cutover/README.md`，历史基础设施报告保留。

Grow 的 GET `/api/action-plans/requests/{key}` 现在优先查询当前账号已有本地回执；active 下本地未知 key 查询 Zook；pending 下未知 key 返回 503，表示结果未确认。远端失败或非法回执不返回伪造的 found=false。写入能力检查同时要求版本、nullable、三种模式、实际日期、文章/课程来源回执和显式写入开关；当前公开能力仍关闭。

`LightTickActionHandoffReceipt` 定义八类非负整数 source_counts、绑定/目标身份、hash 和 target_version；预检 validated=true 与导入 imported_at 为互斥阶段。导入事件使用完整快照的可信来源证明，生成与 C2 相同的持久 receipt；未消费事件后续仅走 source-reconcile，不伪造新的来源确认。只在测试 fixture 暴露带测试 token + Grow HMAC 的 localhost HTTP 驱动，生产路由没有预检动作。


## 2026-10-25 原生执行及学习计划进度

H5 制订、完善和发布计划，手机查看/执行、学习、记录及通知；手机可改期、暂停和完成确认，不另建复杂规划编辑器。App 的本机空间免登录；以下私人云端 API 仍要求正式账户。

- 同时启用 LightTick、`LIGHTTICK_ACTIONS_ENABLED=1` 和独立的 `LIGHTTICK_ACTIONS_V2_ENABLED=1` 才开放公共行动写入/新连接/v2 import。未启用时保持原默认拒写结果；旧版本头仍拒绝，不会把 content/check 转成 time。客户端按 `action_schema_version:2` 与 capabilities 判断可写范围。
- `grow-bridge` 新支持已签名的 `import-preflight`/`import`，只允许同一 staged binding 的完整八类 v2 快照；预检不冻结源，源在明确 consent 后保存不可变备份并冻结，核对回执才 active。含日常节奏的源账号仍拒绝接管，R20 没有借此放行。
- `GET /api/v1/lighttick/action-plans/learning-progress` 返回 `{progress:null}` 或 `LightTickLearningProgress`：`source_revision`、`observed_at`、`received_at`、配置的 `web_url`、至多100个正式计划及每个至多100个阶段的总课数/发布数/本人学完数/百分比。私人笔记、反馈正文、课程正文和 GitHub 凭证不传输。它是最近同步的来源快照，不声称是实时课程编辑器。
- Grow 服务端通过签名 bridge `action=learning-progress` 推送：必须同一 active binding，`action_schema_version=2`、`source_revision>=1`、有效带时区 `observed_at`、HTTPS `web_url`（仅测试允许localhost HTTP）、`plans`。目标在 owner 锁内校验版本和数量；同版本相同内容返回原回执，同版本不同内容或倒退拒绝。回执含 `accepted/binding_id/target_user_id/source_revision/payload_hash`。
- Grow 配置 `GROW_PUBLIC_URL` 后，既有来源 worker 每30秒检查新进度。来源持久保存待发快照与修订，丢响应重发同一包，收到匹配回执才标已送达；新进度不覆盖新账户。旧 v1 绑定不自动获得进度同步范围。
- 原生只构造同一配置来源的 `#plans/detail/{planId}` 和 `#mobile/action/{actionId}`；不在 URL 放 token。Grow 仍核对自己的会话与对象权限，登录可保留上述受限片段。打开来源不自动确认学完。
- time 累计已确认 session；check 产生零分钟完成/撤销事实；content 的 session 只记录投入，学完依赖绑定来源证明。未安排日期的行动保持未安排，手机可本人改期。分钟和勾选不计入课程阶段进度。

验证使用合成账号、一次性localhost PostgreSQL和真实HTTP；生产发布、私人账号接管、真机/读屏及真实后台通知仍独立验收。

## 2026-10-25 原生课程阅读

另行确认的 reading scope 使用独立课程镜像，不扩大既有行动/记录 consent，不写另一份课程完成账。接口、限额、撤回与缓存规则见 README_API.md 的“Grow 原生课程只读接入”。
