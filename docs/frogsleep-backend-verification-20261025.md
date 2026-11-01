# FrogSleep / Zook 后端验证（2026-10-25）

> 历史快照，2026-11-01 归档。下述未提交状态和失败对应当时版本，不代表当前 main 或当前部署；当前验收见 `docs/deployment-verification-20261101.md`。

本轮针对 `/Volumes/肖豪/project/Zook` 验证，未修改业务代码或原测试，未提交、推送、发布。结论：此前 P0/P1 已提交后端链路通过本地回归；当前含其他未提交开发的整个工作区尚未全绿，不能据此宣布整个产品达到上线标准。

## 版本与方法

- Zook HEAD：`49346e3b210bfea2cf76e41af2206525868bc2c4`，包括 P0 `69ef04c`、P1 `49346e3`。
- 对已提交独立副本的 1295 个 Git blob 逐一校验，与 HEAD 全部一致。
- 已提交副本：`/Volumes/肖豪/project/sleep/.artifacts/p1-commits-20261025/Zook`。
- PostgreSQL 集成测试每个文件创建独立本地数据库，分别测试已提交副本和含未提交改动的当前工作区；无跳过。数据库和证据日志保留在本地，未接入线上数据库。
- 本轮证据目录：`/Volumes/肖豪/project/Zook/.artifacts/frogsleep-backend-verification-20261025/`。

## 结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| 已提交副本全部 FrogSleep PostgreSQL 集成测试 | 13 文件，82 通过，0 失败、0 跳过 | `postgres-results.json`，origin=committed |
| 当前工作区全部 FrogSleep PostgreSQL 集成测试 | 15 文件，92 通过，1 失败、0 跳过 | `postgres-results.json`，origin=workspace |
| 当前工作区全后端单元测试 | 1538 项，1534 通过、4 失败、0 跳过 | `workspace-unit.log` |
| 已提交副本全后端单元测试 | 前轮验证 1488 项全部通过；本轮未重复执行 | sleep 下上述独立副本同级 `zook-independent-unit.log` |
| API 生成一致性 | 通过 | `contracts.log` |
| FrogSleep OpenAPI lint | 通过，134 条 warning | `frogsleep-openapi-lint.log` |
| 全局源码行数门禁 | 失败，8 个已有超限文件 | `line-count.log` |

134 条 OpenAPI warning 未在本轮整改；lint 通过不代表文档完全无告警。全局行数门禁涉及 bodylog、lighttick、数据库接口、application factory 和 admin-api，不能视为本次 P0/P1 业务断点回归失败，也不能记作门禁通过。

## 已验证的闭环

以下文件位于 Zook `test/integration/`，已提交副本与当前工作区中对应测试均通过：

| 能力 | 覆盖与测试文件 |
| --- | --- |
| 升级迁移、关系一致性 | `frogsleep-buddy-postgres-migration-upgrade.test.ts`、`frogsleep-buddy-postgres-concurrency.test.ts`：升级、迁移重放、并发关系占位 |
| 首次共同完成、目标累计 | `frogsleep-buddy-first-completion-postgres.test.ts`：双人专注/睡眠、跨日绑定、重试与重启、累计去重 |
| 完整双账号链路 | `frogsleep-two-account-journey.postgres.test.ts`、`frogsleep-dev-acceptance.postgres.test.ts`：独立数据库连接、双人事实、共同动态与完成 |
| 邀请与授权 | `frogsleep-invitation-closeout.postgres.test.ts`、`frogsleep-backend-loop-postgres.test.ts`：邀请接受、方向性授权、撤回、错误领域 ID、生命周期竞争 |
| 专注与个人数据 | `frogsleep-focus-session-idempotency.postgres.test.ts`、`frogsleep-account-data-postgres.test.ts`：并发幂等、超过 500 条历史、分页与持久化 |
| 游客升级与原始睡眠同步 | `frogsleep-raw-guest.postgres.test.ts`：迁移去重、冲突回滚、游标与快照边界、并发上传/删除、身份归属 |
| 生命周期与注销 | `frogsleep-lifecycle-closeout.postgres.test.ts`、`frogsleep-account-data-postgres.test.ts`：关系终止、数据清理、事务回滚、其他产品隔离 |
| 通知与设备归属 | `frogsleep-notification-closeout.postgres.test.ts`、`frogsleep-backend-loop-postgres.test.ts`：设备唯一归属、任务收据、授权撤回、偏好和 provider 就绪性 |
| 个人同步管理 | `frogsleep-personal-admin.postgres.test.ts`：epoch/revision、数据脱敏、迁移及事务提交顺序 |

登录/续期/退出、P1 私有历史恢复、邀请和通知异常分支还由单元测试覆盖。PostgreSQL 多数测试通过服务或 `app.handle` 调用；不将其统称为真实网络端到端测试。

## 当前工作区仍存在的问题

1. **未提交送花 HTTP 测试的初始化顺序错误。** `frogsleep-support-http-postgres.test.ts` 在两人登录之前执行 `prepare` → `enroll`。默认 seed 只有全局账号，没有 FrogSleep App 成员身份；失败数据库查询确认 `zook_app_users` 尚无双方 FrogSleep membership。`BuddySupportAccess.relationship` 正确拒绝，返回 `BUDDY_SUPPORT_UNAVAILABLE`。同模块 PostgreSQL 服务测试主动建立 membership，其 10 项通过。
   - 在证据目录建立独立诊断副本，将双方登录放到 prepare 之前；真实 HTTP 送花、请求幂等、回应去重、关闭接收后历史、后端重启恢复及功能开关通过（1 项）。
   - 证据：`workspace-frogsleep-support-http-postgres.test.ts.log`、`diagnostic-support-http.test.ts`、`diagnostic-support-http.log`。
   - 原测试未改，正式回归仍计 1 失败。诊断通过不替代原测试修复。
2. **4 项未提交观察 CLI 测试无法处理中文目录。** `frogsleep-support-observation-cli.test.ts` 使用 `new URL(...).pathname` 将中文目录保留为 `%E8...`，子进程找不到脚本，stdout 为空，随后 JSON.parse 失败。
   - 证据：`workspace-unit.log`、`cli-path-diagnosis.json`。需要使用文件 URL 到本地路径的正规转换并复跑；本轮保留原改动。
3. **工程门禁待处理。** 全局行数检查 8 文件超限；OpenAPI 134 warning 需要另行评估和治理。

## 上线验证边界

- 本轮没有验证真实设备 APNs/FCM 到达、真实邮件/短信送达；worker 状态、fake provider 收据、provider accepted 都不等于用户已收到。
- 没有进行 StoreKit sandbox 购买、续费、退款或权益撤销联调；本地权益数据读写测试不能替代该验证。
- 没有执行线上配置、生产升级演练、压测或发布。此前 iOS 模拟器验证记录仍有效，但本轮没有新增一轮 iOS 构建或真机验证。
- 本报告证明已列出的 P0/P1 本地业务闭环回归通过，不证明所有 Zook 产品或所有生产条件均验证完成。

## 保留现场

`baseline.json` 记录验证前所有已有受版本控制及非忽略未跟踪文件的摘要、HEAD 和暂存区；`preservation.json` 记录收尾对比。本轮新增此报告及忽略目录中的证据，其他已有文件字节、HEAD 和暂存区保持不变。测试数据库名称见 `postgres-jobs.json`；保留供追溯。
