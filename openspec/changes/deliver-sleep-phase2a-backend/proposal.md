## Why

Zook 已有 app-scoped auth、统一邀请、方向授权和 worker，但代码存在不等于本次客户端/发布候选可用。2A 需要以当前 main 的可重复测试与环境证据收口，而不是另建身份/关系系统。

## What Changes

- 建立 Buddy 全关时账号操作仍可用的行为测试。
- 核验 A/B 私有数据、跨 app token/membership、logout/删除以及错误账号邀请。
- 复用邀请、grant、共享 session 与通知 worker，缺陷按最小范围修复并同步合同文档。
- 明确 dev/online 候选、SES/APNs/FCM 和回滚验收；只执行本机测试，不自动发布。
- 2B 个人同步、群组启用和陌生人匹配后置。

## Capabilities

### New Capabilities

- `phase2a-backend-release-contract`: 2A 账号、关系、通知的契约与发布证据

### Modified Capabilities

无；本 change 的增量能力在实施时续接既有变化，避免重复认领旧任务。

## Impact

FrogSleep auth/buddy routes、相关 module/store、test/unit 与 PostgreSQL 专项、README_API、能力矩阵及验收文档。从 origin/main 隔离 worktree 开发；客户端对应 deliver-sleep-phase2a-client。
