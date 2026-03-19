# Zook Backend Scaffold

这是一个基于 TypeScript 的后端 MVP 骨架项目，用来承接 `docs` 中定义的小中型 app 服务端设计。

当前仓库重点完成的是“核心规则先落地并可验证”：

1. 认证与 Bearer 鉴权。
2. `appId` 作用域校验。
3. RBAC 权限判断。
4. Analytics 事件与指标聚合。
5. 文件上传确认流程骨架。
6. 通知入队与失败事件重投。
7. API / Worker / Admin Web 三服务结构。

## 文档入口

建议按下面顺序阅读：

1. 设计原文档：
   [docs/small-medium-app-backend-design-discussion.md](/Users/zhoukai/Projects/AI/codex/Zook/docs/small-medium-app-backend-design-discussion.md)
2. 当前实现概览：
   [docs/current-backend-implementation-overview.md](/Users/zhoukai/Projects/AI/codex/Zook/docs/current-backend-implementation-overview.md)
3. 构建与服务端常用命令：
   [buid_readme.md](/Users/zhoukai/Projects/AI/codex/Zook/buid_readme.md)
4. 同机构建 + 同机发布的本地 CI/CD 方案：
   [docs/local-cicd-deploy.md](/Users/zhoukai/Projects/AI/codex/Zook/docs/local-cicd-deploy.md)

## 目录概览

```text
.
├── apps/
├── docs/
├── src/
├── test/
├── README.md
├── buid_readme.md
├── package.json
└── package-lock.json
```

核心源码目录：

```text
src/
├── main.ts
├── worker.ts
├── app.module.ts
├── core/
├── infrastructure/
├── modules/
├── services/
└── shared/
```

## 常用命令

启动 API：

```bash
npm run dev
```

启动 Admin Web：

```bash
npm run admin
```

启动 Worker：

```bash
npm run worker
```

执行单元测试：

```bash
npm test
```

默认 API 端口是 `3100`，也可以通过 `PORT` 环境变量覆盖。
默认 Admin Web 端口是 `3200`。

健康检查路径为 `/api/health`。
