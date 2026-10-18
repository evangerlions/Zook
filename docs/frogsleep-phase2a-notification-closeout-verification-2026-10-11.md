# Sleep 2A 通知投递与重试幂等验证（2026-10-11）

本批完成Zook任务2.3和Sleep新增本机任务4.6。客户端累计17/23（新增一项站内通知回退），后端10/17。实现与本机测试完成，未提交/推送/部署；dev、真实provider、设备与发布仍未验收。

## 候选和范围

- Sleep：`/Users/hao/Documents/project/sleep`，HEAD `097957f`及既有/本批WIP。
- Zook：`/Users/hao/Documents/project/Zook/.worktrees/sleep-phase2a-backend`，feature/sleep-phase2a-readiness；fetch后origin/main仍为`4599ef52ff6e017b39d01ceb8d4ea6830be78bb7`。
- 只收口FrogSleep通知链路、设备归属及相关合同/客户端站内入口。其他产品的注册兼容性与其他app数据保留，群组/匹配不启用，不改变私人计时或账号分区算法。

## 修复与行为

1. outbox原来只有list/update而没有跨worker互斥，通用入队每次随机新job；新增outbox/job session锁及稳定逻辑身份，重放和并发保留一个feed、一条in_app及逻辑Push记录。PG session锁允许设备回执逐次autocommit，不将provider请求和所有回执放在同一回滚事务；嵌套锁复用连接，避免pool占满后死锁。
2. 通用队列原来不重新验权且整批重发。现在每次实际发送、每个设备前检查当前membership、目标/关系/方向授权、静默、禁用/quiet hours/预算/开关和设备；偏好计算排除本条feed，重试也不跳过。确认成功设备持久化哈希回执，失败设备继续同job重试，每job最多一个failed_event及5次provider attempt。
3. 每设备先写processing再请求provider；响应丢失、处理被中断的恢复转outcome_unknown，停止自动重发，不伪造provider或设备成功。确认失败可重试，永久无效token仅清当前app/owner/device。job内部SENT是停止自动处理，须结合内部outcome；provider_accepted是接受，不是设备已展示。
4. 无有效设备收敛为NO_ACTIVE_DEVICES且没有失败循环，in_app/feed/route继续可用。缺provider不会logging-only报成功，已知拒绝与未知结果分开记录。
5. 邮件独占claim继续保留；每次尝试检查邀请终态/有效期、开关、已绑定收件人的禁用类别/拉黑。provider_accepted后不重发，SES callback才为delivered。processing过期15分钟、fetch/parse/abort结果未知进入PROVIDER_OUTCOME_UNKNOWN死信；已知可重试失败有5次边界和退避，永久配置失败停止。quiet hours是Push中断偏好，不自动延迟邮件。
6. 同一FrogSleep token原来可同时归属A/B，新增当前注册人绑定。068扩展provider_accepted状态；069仅对FrogSleep保留最近app/platform/token注册、软删除旧重复并建立live唯一索引。非FrogSleep app维持原app/user/token索引与upsert行为；旧主无法删除新主或向已转移设备投递。
7. Sleep Models定义站内通知及Repository协议，Data经正式API读取稳定身份/毫秒日期，Domain按ID去重、串行打开、generation拒绝旧结果。搭子中心提供独立于系统Push授权的站内入口与失败重试。打开resolve→read→再次resolve后才导航；撤权/身份变更和网络失败不改个人计时、历史与队列。

## 验证

| 检查 | 结果 | 证据边界 |
|---|---|---|
| iOS定向 | **74/74，0失败** | 新6个通知Domain、1个feed API解码；通知权限/生命周期/owner queue回归与6真实HTTP旅程 |
| 真实HTTP | **6/6，0跳过** | 新增无设备/Push关闭时读取稳定in_app、重复tick不增加通知、当前owner打开、另一owner404、失效token不影响个人专注；其他5项双账号旅程回归 |
| generic Simulator build | **BUILD SUCCEEDED** | app/扩展，两架构编译，站内入口与本地化接线 |
| 后端全量 | **1338/1338，0失败/跳过** | 比前批新增12个Push/通知行为、4个邮件故障；含原SES callback、APNs/FCM、非FrogSleep产品回归 |
| 新通知PG | **8/8** | 7行为子测试+父测试；独立连接/outbox并发、逐设备回执、当前设备归属、撤权、邮件claim/未知结果、旧重复token升级及068/069重复执行 |
| 既有相关PG串行回归 | **29/29** | 双账号4、生命周期8、邀请10、并发6、旧升级1；每文件使用重建的专用数据库。共**37/37**（含父测试） |
| canonical/generated | **通过** | check:api-contracts；typed notification feed与设备注册行为描述同步 |
| OpenAPI lint | **0 errors / 192 warnings** | 不声明零警告 |
| OpenSpec | **两端strict通过** | 只勾本机2.3/4.6，不替代dev/provider/真机任务 |
| source-line gate | **9处既有文件未通过** | 不新增超限文件；相关PG逻辑已按本批修改方法拆helper，现有大接口/非本任务文件继续保留 |

首次新增设备转移测试失败（旧upsert允许同token两账号），据此修复当前归属与升级约束，随后专项/全量/PG通过。迁移只收口FrogSleep；PG显式放入其他app的两账号同token，验证不会合并或改变其归属。网络响应丢失及崩溃状态为故障注入，不是向真实provider发送。

## 复现

Zook隔离worktree：

```sh
npm test
npm run check:api-contracts
npm run lint:api-contracts
node --experimental-transform-types test/helpers/frogsleep-journey-server.ts
```

最后一个命令启动仅127.0.0.1:3197监听、memory数据库、正式Application/router的fixture；邮件/Push/群组/匹配关闭。新增test-only通知tick仅物化站内数据，不访问provider，不属于公开API。iOS先校验fixture标识和memory后reset；缺fixture的XCTSkip不得算通过。

在Sleep `iOS项目`运行：

```sh
xcodebuild test -project FrogSleep.xcodeproj -scheme FrogSleepTests \
  -destination 'platform=iOS Simulator,id=0607FC75-6E08-450A-AA17-4715565FCAD8' \
  -derivedDataPath /tmp/sleep-phase2a-derived -parallel-testing-enabled NO \
  -only-testing:FrogSleepTests/BuddyNotificationCloseoutTests \
  -only-testing:FrogSleepTests/BuddyNotificationAPIRepositoryTests \
  -only-testing:FrogSleepTests/BuddyLifecycleCloseoutTests \
  -only-testing:FrogSleepTests/NotificationServiceTests \
  -only-testing:FrogSleepTests/AccountPartitionSyncTests \
  -only-testing:FrogSleepTests/TwoAccountLiveJourneyTests
xcodebuild build -project FrogSleep.xcodeproj -scheme FrogSleep \
  -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/sleep-phase2a-derived
```

PG每文件运行前重建可丢弃库sleep_phase2a_notification_20261011，设置FROGSLEEP_TEST_DATABASE_URL=postgresql://hao@localhost/sleep_phase2a_notification_20261011，逐个执行node --experimental-transform-types --test：

- test/integration/frogsleep-notification-closeout.postgres.test.ts
- test/integration/frogsleep-two-account-journey.postgres.test.ts
- test/integration/frogsleep-lifecycle-closeout.postgres.test.ts
- test/integration/frogsleep-invitation-closeout.postgres.test.ts
- test/integration/frogsleep-buddy-postgres-concurrency.test.ts
- test/integration/frogsleep-buddy-postgres-migration-upgrade.test.ts

日志：/tmp/sleep-notifications-{client,build,backend-full,postgres}.log、/tmp/sleep-notifications-regression-*.log、/tmp/sleep-notifications-contract-{check,lint}.log。iOS结果：/tmp/sleep-phase2a-derived/Logs/Test/Test-FrogSleepTests-2026.10.11_20-01-27-+0800.xcresult。测试fixture与专用PG库完成后关闭/删除。

## 未完成

Sleep4.1个人体验、4.5设备/无障碍、5.1 Android、5.2完整验收、5.3 dev/第三/可删除账号、5.4发布继续未勾选；两个前序v11夹具与v12不一致未改，不声称全iOS回归通过。Zook2.4其余审计、2.5完整grant迁移门槛及§3当前dev/SES真实送达/APNs/FCM真机/发布证据保留。外部已接受的通知不能撤回；未知结果不会自动重发来掩盖不确定性。此批不等于整个2A或二期完成。

设备历史若最新注册时间并列，069停止这些冲突token的活跃绑定，等待当前账号显式重新注册；不通过随机ID猜当前使用人。PG已验证并列停用、重新注册与旧主不能删除新主。
