> 2026-11-08用户目录决策：React开发源已迁入plan/LightTick-Web，目录迁移4/4证据见[plan记录](../../../../plan/docs/03-technical/grow-web-plan-migration-2026-11-08.md)。旧源码清单与历史验收仍保留原路径/提交；新构建固定plan SHA。业务主任务21/27保持。

> 2026-11-03 首批代码已实现并验证：React记录、手动基础计划/今日任务、固定静态挂载和task同步回执修复。见[报告](../../verification/grow-react-u1-20261103/README.md)。学习权威、全专题和发布仍未完成；下文架构边界继续适用。

# Grow：LightTick Web 端重构与统一后端规划

2026-11-02 修订。用户明确 Grow 是 LightTick Web 端，本轮撤销上一版独立 Grow App、`src/modules/grow` 和 `/api/v1/grow` 的提议。完整跨端分析见[plan统一架构](../../../../plan/docs/04-planning/grow-lighttick-unified-architecture-2026-11-02.md)，产品真值仍为 plan PRD。

## 已确定边界

- Grow React/TypeScript/Vite静态前端源码位于 `/Volumes/肖豪/project/plan/LightTick-Web`，由plan仓库与两端协同维护（2026-11-08用户更新目录决策）。
- LightTick iOS/Android 客户端留在 `plan` 对应原生仓库，保留免登录本机模式和原生自足基础闭环。
- 三端使用同一 Zook 身份、既有 LightTick app membership、`/api/v1/lighttick/...` 和同一业务对象；不建立两产品互相复制的同步系统。
- 后端只在 Zook `src/modules/lighttick`、`src/app/lighttick*` 和现有 PostgreSQL基础设施实现；公共能力按既有多 App框架复用。
- 已删除的 `services/grow`、Python部署组、第四服务和旧代理不恢复；既有 Web仅接收固定 Grow静态包，不新增服务。

```text
Grow React ───────────┐
LightTick iOS ────────┼─→ Zook /api/v1/lighttick/* → 共同领域服务 → 权威数据/版本/回执/变更
LightTick Android ───┘                   └─ 平台公共能力 + 既有 worker
```

## 现状与目标

记录/目标/基础计划/任务等已有 Zook主数据与合同。通用 sync push运行时当前只执行task命令，不能按枚举名推定全部实体都支持push。学习目录仍有旧来源镜像，私人笔记/答案/学完仍依赖来源回执，需要专门迁移权威和兼容旧客户端。

已完成的旧接入清理见[历史验证记录](cleanup-verification.md)。本轮只调整规划和入口文档，没有修改App、后端合同/运行时、迁移数据或发布；新React页面与原生学习权威仍待实施。

## 阅读入口

- [后端与同步设计](design.md)、[范围](proposal.md)、[实施任务](tasks.md)。
- [2026-11-02旧源码基线摘要](current-grow-source-inventory.json)：283个业务/前端源码文件、431个AST路由声明；不等于注册HTTP操作数。
- [历史API清单](legacy-routes.json)、[行为迁移账本](migration-ledger.json)：历史511个操作仍待与当前源码及行为逐项核对。
- [Web规范](specs/grow-native-web/spec.md)、[平台接入规范](specs/grow-platform-services/spec.md)、[同步兼容规范](specs/grow-compatibility-gates/spec.md)。

所有后端遵循 Zook AGENTS/CLAUDE、唯一OpenAPI、文档同轮更新和 main→dev→同SHA online。前端产物与双端合同快照固定版本；原生二进制发布另行验收。本目录与本地忽略的OpenSpec镜像同步，不把规划校验当功能验收。

## 2026-11-07 筛选工程切片

版本化规则/固定引用模板、有限精确计算、持久 worker 和 React 筛选入口的代码已接入，PG/单测通过；浏览器联合验收已通过，见[子任务](screening-subtasks.md)与[证据](../../verification/grow-react-u1-20261103/screening.md)。原 U0/U5 整项仍保持未勾选，当前主任务进度 21/27。此处不替代逐项旧行为、全领域迁移或发布验收。
