## Why

当前 Grow 已迁入 Zook 仓库，但仍运行独立 Python 服务、自有账号和存储适配，未实现用户要求的同服务 Web 部署。需要把完整 Grow 能力接入 Zook 系统服务，同时保持所有现有 Web、App API 和其他产品行为兼容。

## What Changes

- 新增并行前端 `apps/grow-web`，由现有 admin-web HTTP 进程承载 `/grow/`；保留现有目录、入口、端口及三服务 Compose。
- 复用普通用户认证、LightTick 业务、PostgreSQL 仓储、LLM 路由、任务执行、文件、日志与审计；管理员会话保持独立。
- 逐项迁移记录、行动、目标、规划、课程、阅读、复盘、知识、认知校准、投资与研究能力，不以登录/首页替代整体迁移完成。
- 新能力采用默认关闭的产品专属开关、加法合同和迁移；Grow 任务设置独立容量预算，不改变既有产品服务参数。
- 保留原 Grow 历史账号、数据、GitHub/AI 配置和部署，不导入、不改写、不自动按用户名关联；历史迁移另行授权。
- 每个迁移模块明确唯一写入方，完成所有能力验收后退出新版对 Python 服务的运行依赖；旧服务不随之关闭。

## Capabilities

### New Capabilities
- `grow-native-web`: 同进程 Web 挂载、普通用户身份、共享组件和部署隔离。
- `grow-platform-services`: 模块迁移矩阵、系统服务接入、数据归属及后台任务约束。
- `grow-compatibility-gates`: 现有功能基线、逐模块验收、灰度与无损回退门禁。

### Modified Capabilities
无。已有合同的可观察行为保持不变；缺口通过新增产品接口实现。

## Impact

涉及 `apps/grow-web`、现有 `apps/admin-web/server.ts` 的限定路径分发、`src/modules/lighttick`、`api-contracts`、生成合同、数据库加法迁移、worker、新前端构建阶段及专项测试。当前仅梳理并生成实施提案，不变更这些运行时代码或发布配置。

完整路线清单位于 `docs/plans/grow-zook-native-web/legacy-routes.json`。基线为 Zook `aae6160`：511个 OpenAPI 可见 method/path 操作，429个源码装饰器声明；两者是不同口径，不代表已映射到 Zook 或已验收。
