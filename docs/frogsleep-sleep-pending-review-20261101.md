# Sleep 未提交文件复核（2026-11-01）

基线为 `origin/main` 的 `9cdf0fa`。本轮在独立 `feature/sleep-shared-night-recovery` 工作树复核，原 `buddy-center-qa-fixes` 工作树中的五个未跟踪文件保持原样。

## 处置与依据

- `sleep-date-anchor.ts`、`sleep-joint-activity.ts` 为历史提取草稿：主线的 `shared-sleep-session-start.ts` 已内联对应逻辑，并增加活动参与者必须与关系双方一致的校验；最近相关提交为 `9116a70`。不再次引入重复 helper。
- 移植 `frogsleep-buddy-sleep-activity-link.test.ts`，覆盖服务/HTTP 混合调用、跨日期恢复、活动完成后恢复、错误关系/参与者、取消/未开始、旧调用按日期复用，以及无关会话不能替代绑定会话。额外覆盖已过期活动拒绝首次建会话、撤销共享授权后拒绝恢复。
- 移植 `frogsleep-sleep-date-anchor.test.ts`，通过当前 service 和 HTTP 入口验证日期，不依赖未接入 helper。额外验证带时区偏移的时间戳保留书写日期，以及生成合同接受日期与旧时间戳。
- 原 `frogsleep-buddy-goal-night-window.test.ts` 期待周日晚开始、周一早完成仍计入上周，并调用主线不存在的第六参数。这与当前 OpenAPI 的 “ending inside the goal window” 及按完成日去重约定相反。保留当前协议，将测试调整为验证截止、暂停冻结、同日去重和接受前开始不计数；没有扩展夜窗产品语义。
- OpenAPI 原 `date_anchor`/`dateAnchor` 仅声明 `format: date`，与现有 HTTP 行为和 README 的 ISO 时间戳兼容承诺不符。本轮改为 `date` 或 `date-time` 并同步生成文件；无运行时代码变更。

## 审查边界

双方参与者、关系、共享授权和活动状态均由现有服务在关系锁内重验；已有活动绑定优先于调用方日期。未传活动 ID 仍只复用同日 pending/active 会话。活动之外的会话不能冒充已绑定活动的完成来源。取消、过期未建会话、授权撤销的拒绝分支已覆盖。

本轮为本地回归及合同校准，不包含 PostgreSQL 集成测试、设备端睡眠采集、通知真实送达或发布。根目录原 `docs/frogsleep-backend-verification-20261025.md` 是针对历史提交的独立验证报告，不作为本轮验证结果，也未改写其历史结论。

## 验证结果

- 三份移植测试及已有跨午夜、首次共同完成、共同目标专项：49 项通过；之后补充的生成合同校验随全量 FrogSleep 回归通过。
- 最终收紧错误码及接受前开始的独立断言后，三份移植测试重新执行：18 项通过，0 失败、0 跳过。
- `node --experimental-transform-types --test test/unit/frogsleep*.test.ts`：470 项，469 通过，0 失败，1 跳过；跳过项为需要 PostgreSQL 的 invitation ordering 测试。
- `npm run generate:public-contracts`、`npm run check:api-contracts` 和 `git diff --check` 通过。
- 独立安装锁定合同工具后，`redocly lint api-contracts/openapi/frogsleep/api.yaml` 通过，5 条现存路径/响应 warning，均不涉及本轮日期 schema。
