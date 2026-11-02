## Why

此前通过复制 Grow Python 源码、第四服务和代理实现的部署不符合目标。用户要求删除这些接入，并将 Grow 前端用 React 或 Vue 重构，后端作为 Zook 多 App 框架中的产品模块原生实现。需要保留业务功能和数据语义，同时为新增模块、数据源、AI 场景及客户端提供稳定边界。

## What Changes

- Grow 前端源码保留独立仓库，推荐 React + TypeScript + Vite 静态 SPA；分批重写页面，旧页面仅作功能对照，不作为新运行时依赖。
- Grow 作为独立产品 namespace，新增 `/api/v1/grow/...` 与 `src/modules/grow`；具体 appId 由 Zook app registry 配置，不假定 URL namespace 就是 token 中 appId。
- 共享认证、应用成员关系、配置、模型路由、文件、任务和日志；保留 LightTick 现有合同和权威数据，跨产品协作使用显式授权接口。
- 已清理当前工作区的 `services/grow` 及专用源码锁、部署组、Compose/Python 构建、代理和相关测试；提取 LightTick 共用 env 解析工具。
- 用功能/状态/数据/异常四类验收覆盖记录、计划、行动、学习、阅读、认知、知识、投资和研究；兼容的是用户可观察结果，不机械复制全部旧接口。
- 按纵向切片实现新合同、服务/仓储、React 页面和验收，全部通过前不宣布整体重构完成。

## Capabilities

### New Capabilities
- `grow-native-web`: 分仓 React 静态前端、路由/会话/状态隔离、版本化产物。
- `grow-platform-services`: 独立 Grow 产品模块和 Zook 多 App 公共能力、数据及任务。
- `grow-compatibility-gates`: 现有功能账本、黄金结果、历史数据迁移、回退与存量产品回归。

### Modified Capabilities
无。既有产品合同保持兼容；共享业务提取必须单独验证，不能通过改写 LightTick 语义实现 Grow。

## Impact

前端实现仅在 `/Volumes/肖豪/project/grow`。Zook 业务代码、路由、迁移、worker、合同、客户端和文档按其目录及发布规范交付；无新增 Grow 服务或 Python 后端。当前没有注册新 App、迁移历史数据或发布新前端；旧服务器资源与部署状态须单独核验。
