## Why

报告 POST 当前按请求 insert，GET 先截取500条再分页；不具备可靠重试、删除传播和提交有序增量。二期摘要恢复需要独立协议，不能依赖客户端 occurredAt 时间戳。

## What Changes

- 增强 sleep-reports 的稳定逻辑 ID、幂等和数据库分页。
- 新增私有 report detail/delete、restore 与 changes 合同，采用 revision、sync_epoch 和提交有序游标。
- 为获准报告偏好增加唯一/版本约束；所有写入和变更/回执同事务。
- 审计 feature/frogsleep-data-ownership 的94602cc，仅复用满足协议的部分，不默认合并游客空间/时间戳同步。
- 新增存储纳入 app-scoped 删除；2026-10-11用户授权完成Sleep后端API后已实施，保持2A/客户端与发布门槛独立。

## Capabilities

### New Capabilities

- `phase2b-personal-sync-protocol`: 私有摘要的幂等、恢复、变更和防复活协议

### Modified Capabilities

无；本 change 的增量能力在实施时续接既有变化，避免重复认领旧任务。

## Impact

canonical OpenAPI、generated contracts、product-data modules/routes、ApplicationDatabase、PostgreSQL与内存实现/迁移、README_API、专项并发和迁移测试。客户端对应 implement-sleep-phase2b-client-recovery。
