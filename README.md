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
8. Redis-backed `KVManager` 统一状态持久化。

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
│   ├── cache/
│   ├── database/
│   ├── files/
│   ├── kv/
│   ├── logging/
│   ├── queue/
│   └── runtime/
├── modules/
├── services/
└── shared/
```

## 常用命令

启动 API：

```bash
npm run dev
```

一键启动本地 API + Admin Web：

```bash
npm run dev:stack
```

启动 Admin Web：

```bash
npm run admin:install
npm run admin:build
npm run admin
```

本地开发 Admin Web 前端：

```bash
npm run admin:dev
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
默认 Admin Web 端口是 `3110`。
运行时会强校验 `REDIS_URL` 和 `DATABASE_URL`，依赖不可用时直接启动失败。
容器访问宿主机 Redis / PostgreSQL 时，推荐在连接串里使用 `host.docker.internal`。

如果你想把本地数据库、Redis 和管理员账号固定下来，推荐先复制：

```bash
cp deploy_configs/local.env.example deploy_configs/local.env
```

`npm run dev:stack` 会优先读取 `deploy_configs/local.env`，再读取 `.env.local`。这样本地联调配置就固定在 `deploy_configs` 里，不再需要单独维护一个 `local/` 目录。

健康检查路径为 `/api/health`。
