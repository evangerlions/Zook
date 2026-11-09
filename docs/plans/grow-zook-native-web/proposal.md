## Why

Grow 是 LightTick 的 Web 端。上一版独立 App/数据/API的提议会拆开既有三端主数据，应撤销；现有前端需React重构，旧Python业务在Zook按LightTick领域原生实现并完成来源权威切换。目标是保持现有功能与离线恢复，支持多端共享对象及未来模块扩展。

## What Changes

- Grow前端源码迁入plan/LightTick-Web，由plan仓库维护React/TypeScript/Vite静态SPA；iOS/Android保留原生和本机模式。
- 沿用LightTick appId/membership、canonical `/api/v1/lighttick/...`、领域模块及现有主数据，不新建grow App或平行合同。
- 复用records/manual/planning/tasks/actions等已验证行为；学习内容/私人学习/知识/认知/投资/研究缺口在LightTick内新增子领域，而非另建服务。
- 逐实体建立命令、持久回执、变更日志、pull投影、客户端缓存/冲突覆盖矩阵；现有通用push只处理task，其他领域先保留各自提交机制，不宣称全量同步已存在。
- 课程与私人学习从旧来源镜像/命令回执切为Zook原生权威，保留同ID、版本和旧App合同；按owner+module冻结、对账、切epoch，拒绝迟到旧写。
- 既有旧Python部署清理保留；不恢复源码副本/第四服务/代理，不新增SSR或独立后端。
- 同步产品主文档入口、联合规划与历史标准边界，不改写历史批次验收证据。

## Capabilities

### New Capabilities
- `grow-native-web`: 分仓React静态前端、同产品普通用户会话、固定产物与版本兼容。
- `grow-platform-services`: LightTick多端共享领域服务、内容权威原生化和平台能力复用。
- `grow-compatibility-gates`: 逐实体同步、离线/冲突恢复、旧来源与旧客户端兼容、全功能与发布门禁。

### Modified Capabilities
无。已有合同通过加法方式扩展，既有字段、状态/完成和幂等语义保持兼容。

## Impact

前端归plan/LightTick-Web，原生归plan内各客户端，业务/数据库/AI/API唯一归Zook。产品与联合验收见[统一架构](../../../../plan/docs/04-planning/grow-lighttick-unified-architecture-2026-11-02.md)。本轮只变更规划，不实现新接口、改账号或自动迁入私人历史。
