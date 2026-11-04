## Context

从 fetch 后 origin/main 4599ef5 建 feature/sleep-phase2a-readiness worktree；main 被另一 worktree 占用，不切换或改写它。保留原 feature/frogsleep-data-ownership 的94602cc，不混入2A。

## Goals / Non-Goals

**Goals:** 核验已有账号/授权/通知合同与本次发布证据；不新增历史同步或自动部署。

**Non-Goals:** 不重写既有业务、群组/陌生人匹配、历史Go新增功能、自动生产发布。

## Decisions

先写行为级测试证实账号不依赖 Buddy capabilities、A/B 数据不串、FrogSleep 删除不影响其他 app。复用 app-scoped auth、统一 invitation/grants 和 outbox。测试发现缺口才最小修复，API行为变化同轮更新 OpenAPI/generated/README_API。

规划真相源：Sleep `开发规划/小呼二期统一规划-20261008.md`；字段细则：`开发规划/Sleep二期-Zook同步合同与数据生命周期设计-20261011.md`。

## Risks / Trade-offs

内存成功不等于 PG/线上成功 → 分别记录；历史 readiness 过期 → 当前候选重新验收；provider配置未知 → 不标发布完成。

## Migration Plan

代码最终进 main；dev验证同一SHA后才能online。此轮只本机验证，不推送/部署；缺外部证据的任务保持未完成。

## Open Questions

当前 SES delivered、APNs/FCM真机、错误账号和可删除账号；PG专项数据库可用性。


## 客户端账号隔离批次发现的2A缺口

2026-10-11核查：`src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`的reportSession每次分配randomId，client_session_id只写payload；GET映射保留客户端ID，但重复POST仍可能新增实体并累加统计。客户端固定账号/稳定ID/回执payload比较只能保证本机隔离与去重，不能替代后端幂等。该缺口由后续本批任务2.6修复并验证；账号隔离批次当时不修改后端运行时、不更改2B数据归属分支、不把已有A/B隔离测试当幂等已通过。


## 私人专注幂等批次指定范围与语义

任务2.6指定：focus-buddy.service.ts的reportSession、独立focus-session-report构建器、ApplicationDatabase专注原子写协议、PostgresDatabase单行委托、PostgresFrogSleepStore记录解析导出、新PostgresFocusSessionStore、内存专注写入辅助及接线、021迁移、专注API/PG迁移并发测试、canonical FrogSleep OpenAPI/generated、README_API/能力矩阵/验证记录、两端OpenSpec及Sleep统一规划状态。保留其他工作区和WIP，不推送或部署。

认证推导(app_id,owner_user_id)，session_id/sessionId为大小写敏感的不透明字符串；缺省保持旧客户端append语义，显式非法/冲突ID返回400。有效ID由数据库部分唯一索引和单条UPSERT保证并发不新增；同内容（归一化请求指纹）重试返回原记录和首次默认时间；同键内容修正更新单条私人记录，保留server ID与created_at，以数据库最后接受的写入为准，不承诺2B版本/跨设备冲突解决。只有首次插入调用原里程碑/共享检测，回放或私人修正不重复生成派生项；原请求上报分析事件仍记录请求次数，不能作为唯一session统计。

021迁移先锁表整理旧重复：同app/user/client ID保留最早实体ID与created_at，内容取最新updated_at行，其他重复软删除并保留审计痕迹；共享时刻的两端session引用映射至保留ID，不重算历史共享时刻。缺失/非法旧ID不自动猜测归属。索引与整理由迁移事务一起提交；对共享时刻、邀请和通知不做业务扩展。

完成记录：任务2.6已通过207项FrogSleep测试及8项真实PG幂等/升级测试，另有既有PG回归7项通过；canonical/generated/README_API与能力矩阵同步。后端进度6/16，未发布。新实现不保存单次请求状态到Service字段，PG委托只保留稳定查询依赖。

## 统一邀请收口批次（2.1）

指定统一 bundle、accept/safety/兼容 service，以及域预览、身份认领、旧决策和 slot compatibility 辅助；Sleep/Focus 旧 accept 仅加共用 slot 锁/状态重验；ApplicationDatabase 协议、PG 委托/decision 映射/slot 锁/safety 事务、内存共用调度及映射、DomainDecision 类型抽取/公共 re-export、022 迁移；新增 API/真实 PG 专项、既有锁断言；canonical OpenAPI/generated/generator 清单、README_API、邀请专题、能力矩阵、两端 OpenSpec/统一规划与验证记录。其余关系/worker/2B/部署不扩展。

预览只读，逐域返回 CAS 版本、终态/动作和原关系 ID；错账号/角色中性 404，正确邮箱收件人在显式成功命令中认领。accept/decline/cancel 用原版本及同 key 回放，accept 不自动 grant；原关系 receipt 不能从当前 slot 推导，解除后回放不重建。022 唯一身份/时间匹配回填，否则不猜测。

新旧接受共用确定顺序 slot 锁，canonical accept 也检查旧 active/accepted/paused 关系；旧整单先锁 slot 再锁 bundle，各域 CAS 与 child 终态在事务内提交。safety 锁 bundle 再 decision，不创建 slot。避免同/不同邀请交错接受重复占位或死锁。内存 exclusive/command/safety 共用调度队列，嵌套 exclusive 不另开事务，保持失败回滚不会抹掉另一已提交命令。

本机 1306 单测、10 新 PG 测试及 6+1 既有 PG 回归通过；当前累计 7/16。2.4 其余审计、2.5 完整 grant gate 和 §3 dev/真实 provider/设备/发布不标完成。证据：`docs/frogsleep-phase2a-invitation-closeout-verification-2026-10-11.md`。

## 2026-10-11 方向授权与关系生命周期收口范围

本批2.2仅修改 buddy-growth 的关系/授权/通知验权、safety block 和旧 Sleep/Focus 生命周期桥接、对应路由、合同/generated、测试与 API/专题/能力矩阵/OpenSpec 验证文档。

Canonical 关系是新邀请的唯一事实。暂停按参与人独立记录；静默为本人按关系通知偏好，不更改授权。解除/拉黑撤销双方授权并释放仍指向原关系的槽位；恢复不复活已终止的共享会话。通知打开与每次 worker 尝试都重新验权。客户端共享缓存使用代际屏障，授权/生命周期变更先清缓存再读服务端，不影响私人计时与历史。


实现使用 `buddy-relationship-facts` 无复制投影、`buddy-relationship-lifecycle.service`、`buddy-relationship-cleanup` 与统一 API 路由。方向 PUT 和生命周期与邀请共用 participant/domain slot 锁；共享 Sleep/成长共同活动写入在锁内复验，撤销只释放匹配的原 slot。pending 旧 Focus 关系被入口拒绝，旧 Sleep resume 不能替另一参与人恢复；旧 Focus duplicate revoke 保持兼容400。Mute 按本人/关系独立于旧守护偏好，notification-target 按真实类别/ID/成员/方向校验，worker 每次attempt复验；旧Sleep入Push队列也应用mute gate。

实际文件范围另含 `buddy-growth-events` 路由字段、`buddy-joint-goal`/`buddy-milestone-report` 当前权限读取、手写 public-contract-validator 新请求接线及 Sleep/Focus 兼容桥接。1317单测、25项PG串行验证、合同检查通过；2.2本机完成，累计8/16。完整provider/dev/真机/发布仍未完成；证据：`docs/frogsleep-phase2a-lifecycle-closeout-verification-2026-10-11.md`。

## 2026-10-11 双账号专注与共同守护旅程范围

本批新增2.7本机双账号旅程任务（dev3.1保持未完成），指定 Focus canonical关系读取/共同记录派生及Sleep会话晨间状态/幂等摘要、相关API/PG/HTTP测试与本机fixture server、合同/generated/README_API/专题/能力矩阵/OpenSpec验证记录。

新域关系沿用canonical事实，不复制legacy关系。共享派生必须独立验权，失败不得使已经持久化的私人专注上报失败。断网/401保留私人本地记录与待同步队列，不自动把新的账号token用于旧请求；共享失败不模拟成功或复活旧会话。双参与人晨间结果分别记录，重试不得增加事件/摘要计数。

本批补充指定 `buddy-artifact-redaction.ts` 仅处理查看者筛选/旧回顾投影，`frogsleep-journey-artifacts.test.ts` 验证旧单主回顾与缺失身份隐藏。`test/helpers/frogsleep-journey-server.ts` 只监听127.0.0.1，使用正式路由和可丢弃内存数据；禁用邮件/Push/群组/匹配。iOS两独立凭据/GRDB实例通过真实HTTP联调，不能代替dev、provider或设备发布门槛。

收口结果：完成canonical Focus投影、optional companion派生隔离/slot锁pair去重及stable viewer字段；共享晨间分人终态、事件幂等、每人summary/recap与旧数据隐藏兼容。1322单测、29 PG及78 iOS专项/generic build通过；2.7完成累计9/17，dev/provider/设备门槛保留。详见本批双账号验证记录。

## 2026-10-11 通知投递与重试收口范围（2.3）

指定 Buddy notification worker/preference/target/read service、通用 NotificationService 的 FrogSleep 分支与 failed-event 的通知重放分支、Push 未配置处理；ApplicationDatabase、PG/内存通知持久化适配与新的通知 session lock/helper，仅持久化原job的设备哈希回执（不新增token明文表）。邮件worker与claim仅处理当前禁用/目标失效/过期processing结果未知。对应API/worker/PG及客户端feed/路由测试、canonical合同/文档/规划同步。保留其他产品与所有WIP行为。

outbox与job稳定身份、跨进程锁串行处理；设备成功回执独立提交，失败设备可重试。每次实际发送重验当前权限/静默/开关/设备；无设备只保留站内入口。provider接受后响应丢失仍有外部不确定性，不声称跨provider恰好一次；邮件过期processing进入结果未知死信，不盲目重复投递。

测试发现同一Push token可同时归属两账号，导致旧账号通知到当前账号设备。补充指定 `postgres-frogsleep.ts` 的upsertDevice、内存同方法和069设备唯一性迁移：按app/platform/token绑定当前注册人，旧主只能清自己的记录；历史活跃重复保留最近注册、软删除其余，不动其他app。API设备注册合同/文档与PG测试同步。

本批结果：2.3本机完成累计10/17；1338单测、37串行PG（每文件新库）、74 iOS与generic build通过，OpenAPI/generated及两仓文档同步。Push未知processing/传输结果停止重发，邮件同理；设备唯一归属/旧重复升级严格仅FrogSleep，其他app保留旧约束与upsert合同。真实provider/设备/dev与发布继续未完成，详见通知验证记录。

设备历史若最新注册时间并列，069停止这些冲突token的活跃绑定，等待当前账号显式重新注册；不通过随机ID猜当前使用人。PG已验证并列停用、重新注册与旧主不能删除新主。
