# Grow 重构：React 前端 + Zook 多 App 原生后端

2026-11-02 更新。用户已明确删除此前 Grow Python 部署接入，并要求以前后端分仓、Zook 多 App 框架承载后端的方式重构。

## 当前结果与目标区别

- 已在当前工作区删除 `Zook/services/grow`、Grow 专用部署组脚本、Python 镜像/Compose overlay、源码锁、旧代理及相关专用测试/运维文档。共享部署入口恢复到接入前版本，LightTick 使用的纯 env 解析函数抽为共用工具。
- `/Volumes/肖豪/project/grow` 的原始代码、历史资料与未提交改动保留，作为功能核对来源。
- React 前端、独立 Grow App 注册和 `/api/v1/grow/...` 业务接口尚待实施。本轮没有远程发布或操作服务器，源码清理不代表历史容器已退役。
- 本方案替代前版“保留原生 JS 页面、不要求框架重构、Grow 全部归属 LightTick”的规划。建议采用 React + TypeScript；Vue 作为技术可行备选，不同时建设两套框架。

## 目标边界

| 部分 | 唯一源码归属 | 交付方式 |
|---|---|---|
| Grow 前端 | `/Volumes/肖豪/project/grow` | React/TypeScript 静态 SPA，按功能模块组织 |
| Grow 产品业务 | Zook `src/modules/grow`、`src/app/grow*` 及 PostgreSQL 基础设施 | 复用既有 API、worker 进程 |
| 平台公共能力 | Zook 既有 auth/app registry/files/LLM/config/logs 等模块 | 服务端按 appId/userId 鉴权和配置 |
| 对外合同 | Zook `api-contracts/openapi/grow`（待新增） | 生成固定版本客户端和运行时合同 |
| 静态承载 | Zook 既有 Web 进程 | 固定 Grow 构建包，计划 `/grow/`；当前尚未挂载新前端 |

```text
Grow React SPA → Zook 公共认证 + /api/v1/grow/*
                              ├─ Grow 领域模块
                              ├─ 平台认证 / App / 文件 / LLM / 配置
                              ├─ PostgreSQL 仓储
                              └─ 既有 worker 内受限任务
```

## 文档与验收入口

- [清理与验证记录](cleanup-verification.md)。
- [架构分析与扩展设计](design.md)：React/Vue 取舍、多 App 边界、业务模块、状态与数据、兼容迁移。
- [范围与约束](proposal.md)、[实施任务](tasks.md)。
- [当前 Grow 源码基线](current-grow-source-inventory.json)：当前工作区代码摘要与 AST 路由声明；不执行原服务，不含个人数据。
- [历史 HTTP 清单](legacy-routes.json)、[待核对账本](migration-ledger.json)：原先 511 个注册操作清单保留作比对；不是当前行为完整性或接口等价证明。
- [前端规范](specs/grow-native-web/spec.md)、[后端规范](specs/grow-platform-services/spec.md)、[兼容规范](specs/grow-compatibility-gates/spec.md)。

## 发布约束

所有后端改动遵循 Zook `AGENTS.md`、`CLAUDE.md`：最新 main → feature → main → release_dev.sh → dev 验证 → 同一已验证 SHA release_online.sh。前后端固定产物组合，合同、生成结果、文档和测试同轮交付。

本目录为可提交规划；`openspec/changes/grow-zook-native-web` 的忽略镜像同步维护。未完成任务不得因删除菜单或移除旧服务而标为完成。
