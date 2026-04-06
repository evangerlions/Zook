# Docs Index

## 1. 文档分层

当前 `docs/` 目录建议按下面的阅读顺序理解：

### 对外接入

1. [../README_API.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/README_API.md)
   外部 App / Web 接入 Zook 服务时应该看的总入口。
2. [public-qr-login-spec.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/public-qr-login-spec.md)
   扫码登录专用的对外接入协议。

### 内部后台 / 运营

1. [admin-api-spec.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/admin-api-spec.md)
   Admin Web 与后台内部接口协议。
2. [admin-web-design.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/admin-web-design.md)
   Admin Web 的页面模型、工作区与交互设计。
3. [local-cicd-deploy.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/local-cicd-deploy.md)
   本地 / 服务器部署链路说明。

### 架构与实现

1. [current-backend-implementation-overview.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/current-backend-implementation-overview.md)
   当前后端已经做到什么程度。
2. [backend-i18n-design.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/backend-i18n-design.md)
   服务端多语言文本设计。
3. [small-medium-app-backend-design-discussion.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/small-medium-app-backend-design-discussion.md)
   更偏长期架构讨论与实施约定。

### 厂商 / 方案记录

1. [bailain/2026-03-29百炼codingPlan.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/bailain/2026-03-29百炼codingPlan.md)
   厂商能力或接入方案记录。

## 2. 现在的分布是否合理

目前比之前合理，但还有一处可以继续收：

1. `README_API.md` 现在已经适合只做对外接入入口
2. `docs/` 里已经可以承接内部 admin、部署、实现概览和专题设计
3. `docs/bailain` 目录名存在拼写问题，后续建议统一成 `docs/bailian` 或 `docs/vendors/bailian`

## 3. 后续新增文档建议

1. 面向外部接入方：优先写到 [../README_API.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/README_API.md) 或 `docs/public-*`
2. 面向内部后台：优先写到 `docs/admin-*`
3. 面向部署 / 运维：优先写到 `docs/*deploy*`
4. 面向架构设计：优先写到 `docs/*design*` 或 `docs/*overview*`

## 4. API 文档同步规则

仓库级强约束已经写入 [../AGENTS.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/AGENTS.md)。

执行上按这套理解：

1. 对外接口变化：更新 [../README_API.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/README_API.md)
2. 内部 admin 接口变化：更新 [admin-api-spec.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/admin-api-spec.md)
3. 后端能力范围明显变化：更新 [current-backend-implementation-overview.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/current-backend-implementation-overview.md)
4. 某个公共协议专题有较深变化：补充更新对应 `docs/public-*`

如果一个接口改动同时影响“对外接入约定”和“后台内部能力”，那就需要两边都改，不能只改一份。
