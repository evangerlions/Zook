# Sleep 2A 双账号专注与共同守护旅程验证（2026-10-11）

本批完成客户端4.4及Zook新增本机旅程2.7。客户端累计16/22，后端9/17（新增2.7使原16项变为17项）。这是本机正式HTTP路由与Simulator/PG证据，不代表dev、online、真机或provider验收；未提交、推送或部署。

## 候选与范围

- Sleep工作区：`/Users/hao/Documents/project/sleep`，HEAD `097957f` 加既有WIP与本批修改。
- Zook工作区：`/Users/hao/Documents/project/Zook/.worktrees/sleep-phase2a-backend`，`feature/sleep-phase2a-readiness`，main基线 `4599ef52ff6e017b39d01ceb8d4ea6830be78bb7` 加前序与本批修改。
- 保留账号分区/v12/邀请/生命周期与其他既有WIP，不改旧个人计时算法、不启用群组/匹配/邮件/Push。

## 实现结果

客户端通过Models定义凭据和共同守护Repository协议，Data凭据仓库可按端注入，Domain共同守护协调器独立于个人服务和队列。只有服务端确认的shared session可显示；断网不生成临时成功session，同进程重试固定原session/事件时间。等待begin时的共享事件在确认后按序发送。用户明确开始时才accept本人invited状态，status刷新不自动接受。

401/403/404/409清掉共享操作和缓存，并通过generation拒绝晚到响应；私人Focus/Sleep仍能完成，历史和固定owner待同步队列保留。同一owner重新登录后队列可补传。共享中心展示离线、重新登录、关系不可用及重试提示。客户端日期兼容毫秒/整秒ISO与日历日期，不透明ID稳定映射；redacted摘要/回顾不解码成普通完成结果。

Zook将canonical Focus事实投影到既有current/比较/共同记录读端，不复制旧关系。私人专注先原子持久化，再按共同slot锁与双方shared_activity授权生成派生记录；派生查询失败不反转个人成功。以关系及两条服务端session为唯一pair，兼容旧随机ID记录去重；回放可补派生。稳定moment_id与按viewer排列的client session引用避免双账号归属颠倒，原server引用保持兼容。

共同守护逐人记录晨间结果，一个人完成后整体保持active，双方完成才completed；暂停当晚终止协调。相同actor/type/规范化occurred_at重试不重复事件，重复morning/pause终态ack返回原状态，其余终态事件409。每个session每人一份summary/recap，原位更新；旧单主recap根据participant_states按viewer重投影，缺失viewer上下文隐藏。摘要读取每次验权，撤回授权不会影响个人睡眠。

## 验证矩阵

| 验证 | 结果 | 证明范围 |
|---|---|---|
| iOS定向回归 | **78/78，0失败** | 5真实HTTP旅程、8协调器/解码故障测试、共享API合同、邀请、生命周期、Focus比较及owner队列 |
| 双账号真实HTTP | **5/5，0跳过** | 分别登录/逐域接受/分别授权；独立私人专注完成上传、比较25/25、1共同记录及stable/viewer身份；先后晨间完成；断网；失效token后同owner重登录补传；暂停/解除；摘要撤权 |
| generic Simulator build | **BUILD SUCCEEDED** | app和现有扩展编译，包含共享恢复提示及本地化接线 |
| 后端npm test | **1322/1322，0失败/跳过** | 含3新增真实HTTP旅程及2旧回顾viewer/缺失上下文回归 |
| 新旅程PG | **4/4** | 3行为子测试+父测试；两条独立数据库连接并发完成仅1共同记录、并发begin和晨间ack不重复、buddy查询故障保留私人提交 |
| 生命周期PG回归 | **8/8** | 方向授权、事务失败回滚、slot和双域拉黑 |
| 邀请PG回归 | **10/10** | 独立域、回执、并发与升级 |
| 既有PG并发/升级 | **6/6 + 1/1** | 共计PG **29/29**，各文件使用重建的可丢弃数据库串行执行 |
| canonical/generated一致性 | **通过** | check:api-contracts；事件枚举、shared moment响应schema与文档一起更新 |
| OpenAPI lint | **0 errors，193 warnings** | 警告保留，未当作零警告 |
| source-line gate | **未通过，9个既有文件** | 与前批同一组基线超限；本批Focus496/Sleep489行，新文件均小于500，不改无关超限文件 |

PG首次复用旅程数据库跑旧生命周期夹具，旧夹具只清其自身ID前缀，触发pair唯一约束；改为每个文件重建专用数据库后上述回归全部通过。没有修改断言或业务规则来规避该失败。

## 复现

在Zook隔离worktree运行 `node --experimental-transform-types test/helpers/frogsleep-journey-server.ts`。fixture只监听 `127.0.0.1:3197`，内存数据库；正式Application路由，邮件/Push/群组/匹配关闭。iOS测试先验证fixture标识与memory，再reset；fixture缺失会XCTSkip，必须单列跳过，不能作为通过。

在Sleep的 `iOS项目` 执行：

```sh
xcodebuild test -project FrogSleep.xcodeproj -scheme FrogSleepTests   -destination 'platform=iOS Simulator,id=0607FC75-6E08-450A-AA17-4715565FCAD8'   -derivedDataPath /tmp/sleep-phase2a-derived -parallel-testing-enabled NO   -only-testing:FrogSleepTests/TwoAccountLiveJourneyTests   -only-testing:FrogSleepTests/SharedSleepJourneyCoordinatorTests   -only-testing:FrogSleepTests/SharedGuardianshipAPIClientContractTests   -only-testing:FrogSleepTests/BuddyLifecycleCloseoutTests   -only-testing:FrogSleepTests/BuddyInvitationAPIRepositoryTests   -only-testing:FrogSleepTests/FocusRelationshipAndComparisonServiceTests   -only-testing:FrogSleepTests/AccountPartitionSyncTests
xcodebuild build -project FrogSleep.xcodeproj -scheme FrogSleep   -destination 'generic/platform=iOS Simulator' -derivedDataPath /tmp/sleep-phase2a-derived
```

PG使用可丢弃专用库 `sleep_phase2a_journey_20261011`，每个文件运行前dropdb/createdb重建，设置 `FROGSLEEP_TEST_DATABASE_URL=postgresql://hao@localhost/sleep_phase2a_journey_20261011`，逐一用 `node --experimental-transform-types --test test/integration/<文件>` 运行：

- frogsleep-two-account-journey.postgres.test.ts
- frogsleep-lifecycle-closeout.postgres.test.ts
- frogsleep-invitation-closeout.postgres.test.ts
- frogsleep-buddy-postgres-concurrency.test.ts
- frogsleep-buddy-postgres-migration-upgrade.test.ts

日志：`/tmp/sleep-journey-client-tests.log`、`/tmp/sleep-journey-build.log`、`/tmp/sleep-journey-backend-full.log`、`/tmp/sleep-journey-postgres.log`、`/tmp/sleep-journey-regression-*.log`、`/tmp/sleep-journey-contract-{check,lint}.log`。iOS结果：`/tmp/sleep-phase2a-derived/Logs/Test/Test-FrogSleepTests-2026.10.11_15-51-10-+0800.xcresult`。本机夹具与临时PG库完成后关闭/清理。

## 继续保留的门槛

客户端4.1个人体验细项、4.5设备/无障碍、5.1 Android及5.2整体验收、5.3当前dev/第三/可删除账号、5.4发布仍未勾选。前序249项扩展回归的两个旧v11账号夹具与当前v12不一致，本批未改，不能声明全iOS回归通过。

后端2.3完整provider/通用Push重试、2.4余项协议审计、2.5完整grant迁移门槛与§3 dev/真实邮箱/真机/合并main复验仍未完成。共享进程内重试不承诺重启持久化恢复或多设备冲突解决，这些属于2B；个人owner队列已有持久化。本批不等于整个2A或二期完成。
