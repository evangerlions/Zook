## 1. 2A当前main基线（先推进）

- [x] 1.1 fetch并固定origin/main，建立隔离feature worktree，保留94602cc数据归属分支。
- [x] 1.2 新增行为测试：所有Buddy flags关闭仍可login/me/refresh/logout，不误开关系能力。
- [x] 1.3 新增A/B私人专注数据隔离及跨app账号删除/旧token拒绝测试。
- [x] 1.4 执行账号、Focus/Sleep、统一邀请、方向授权和通知相关专项及check:api-contracts。
- [x] 1.5 记录本机结果与尚缺环境证据，不把本机通过当生产通过。

## 2. 关系与通知查漏

- [x] 2.1 审计统一邀请分域结果、邮箱定向错误账号、重复accept/cancel与并发slot。
- [x] 2.2 撤权/暂停/解除/拉黑后的session读写、共享摘要和通知route验权。
- [x] 2.3 outbox/邮件/Push重试幂等、禁用/静默/provider失败以及无设备回退。
- [x] 2.4 仅修复实际缺口，API变化同步OpenAPI/generated/README_API/专题/能力矩阵。
- [x] 2.5 PostgreSQL邀请/slot/grant迁移和并发专项通过。
- [x] 2.6 私人专注按(app_id,owner_user_id,client_session_id)实现上报幂等，补回放/并发/不同账号相同ID及统计不重复测试；API变化同步canonical合同。

- [x] 2.7 收口本机双账号私人专注/共同守护旅程，canonical关系接入既有Focus读端、共同记录与晨报幂等；覆盖断网/token失效/关系变更及独立PG连接，不影响个人流程。

## 3. 当前候选联调与发布门槛

- [ ] 3.1 联合客户端2A完成dev双账号、第三错误账号、可删除账号旅程。
- [ ] 3.2 SES queued→provider_accepted→delivered，邮件继续链接证据。
- [ ] 3.3 APNs/FCM当前配置与真机notification deep link、无权限回退证据。
- [ ] 3.4 保持群组/陌生匹配默认关闭，验证能力开关及回滚负责人。
- [ ] 3.5 合并main后复验；同一main SHA依次dev/online门槛。本change完成不代表自动部署授权。

任务2.6本机证据：`docs/frogsleep-phase2a-focus-idempotency-verification-2026-10-11.md`。只有本批私人专注合同/迁移/API与PG验证完成；2.4其余协议审计、2.5完整邀请/grant gate和§3 dev/发布证据仍保持未完成。

任务2.1本机收口：独立preview/认领/accept/decline/cancel、同键原版本回放、原关系receipt和新旧接受共用slot锁已实现；1306单测、10新增PG及6+1既有PG回归通过，合同/generated/文档同步。证据：`docs/frogsleep-phase2a-invitation-closeout-verification-2026-10-11.md`。累计7/16；2.4其余协议、2.5完整grant gate和§3环境发布仍未完成。


任务2.2本机收口：新/旧关系统一方向授权与生命周期、本人暂停/静默、解除/双域拉黑、原slot释放与共享会话终止、通知route与worker每次尝试重新验权已实现；11新增行为测试纳入1317全量单测通过，8新增PG及17既有PG串行回归通过，canonical/generated/README_API/专题/能力矩阵同步。证据：`docs/frogsleep-phase2a-lifecycle-closeout-verification-2026-10-11.md`。当前8/16；2.3完整provider/通用Push投递、2.4其余审计、2.5完整grant gate和§3当前环境发布保持未完成。

任务2.7本机收口：canonical Focus读取/独立私人持久化/授权派生去重、稳定viewer时刻、分人共享晨间完成/事件幂等与viewer摘要回顾完成；1322后端、29 PG串行且按文件隔离数据库、78客户端（含5真实HTTP无跳过）及generic build通过；canonical/generated/README_API/专题/能力矩阵同步。证据：`docs/frogsleep-phase2a-two-account-journey-verification-2026-10-11.md`。新增本机任务使总数变为17，当前9/17；2.3–2.5及§3环境/provider/发布门槛保留未完成。

任务2.3本机收口：稳定outbox/job/设备回执与跨进程锁、通用Push发送/重试重新验权、静默/禁用/quiet hours、部分provider失败及未知结果、无设备站内回退、邮件独占claim/终态/禁用/未知处理，以及068/069当前FrogSleep设备归属迁移完成。1338后端、37 PG、74 iOS（含6真实HTTP无跳过）、generic build与canonical/generated/lint通过。证据：`docs/frogsleep-phase2a-notification-closeout-verification-2026-10-11.md`。当前10/17，真实provider/设备和§3发布仍未验收；2.4/2.5余项保留。

2026-10-11 API/后台批次：2.4合同/运行时/API文档/能力矩阵同步、2.5邀请/slot/grant迁移与PG并发复验完成，当前12/17。五项§3门槛均未勾选；当前dev、真实provider/真机和main发布未完成。个人同步后端19/20，管理接入7/8；证据 `docs/frogsleep-api-admin-verification-2026-10-11.md`。
