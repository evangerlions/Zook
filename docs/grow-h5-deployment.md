# Grow H5 接入 Zook（2026-11-02）

目标入口 `https://app-dev.youwoai.net/grow`。源码位于 `services/grow`，
沿用 Zook 的 main → release_dev.sh → webhook → 本机构建发布链路。
`/grow` 已由管理系统 HTTP server 接管，无需为此修改域名入口的 Caddy/Nginx。

本次只迁移代码及 H5 承载方式；旧 Grow/Render 的私人数据库、内容授权和账号
不自动复制。旧服务继续保留。新 dev 使用独立 PostgreSQL 数据库与新密钥。

## 服务器运行配置

沿用 `docs/lighttick-grow-z1-deployment.md` 的整组发布、回退与 dev 验收门禁。
其中 Grow Git mirror 前置已由本次 bundled source 替代。

在服务器现有 `deploy_configs/dev.env` 保留所有 Zook 变量，并增加：

```dotenv
GROW_DEPLOY_ENABLED=1
GROW_APP_ENV_FILE=/home/ubuntu/app/Zook/deploy_configs/grow-dev.env
GROW_HOST_PORT=8757
# GROW_ACTION_BRIDGE_SECRET 与 grow-dev.env 中的值保持一致。
```

路径以实际服务器检出目录为准。`grow-dev.env` 根据
`deploy_configs/grow-runtime.env.example` 私下填写，权限600，不提交Git。
推荐 `PLAN_CONTENT_BACKEND=postgresql`，`DATABASE_URL` 使用 Zook 当前槽位 PostgreSQL，
并设置独立 `GROW_DATABASE_SCHEMA=grow_h5_dev`（online 应使用对应独立槽位及 schema）。
记录、规划、课程正文、参考资料、不可变版本和发布恢复日志全部在数据库中，
不再要求 GitHub。Python 服务自行在指定 schema 安装兼容表，不能使用 public，
不能覆盖既有 Zook/LightTick 表或把用户名相同当作账号相同。
旧 GitHub 模式仍要求不同数据库名；已有内容绑定不会被静默改写。
`GROW_PUBLIC_URL=https://app-dev.youwoai.net/grow`，`GROW_BASE_PATH=/grow`。
`FORWARDED_ALLOW_IPS` 填同 Compose 网络中受控 admin-web 代理的地址或隔离网段；
不得填 `*`。TLS 原始 scheme 经管理系统转交 Uvicorn，Host 保持外部域名，
同源写入校验才能正确工作。数据库必须完成实际连接及 CREATE SCHEMA 权限预检。
旧 GitHub 模式的仓库/Token仅用于兼容；AI维持原有按需配置方式。

Grow 的本地运行目录使用 Compose 命名卷 `grow-runtime`，dev/online
随项目名隔离；数据库、密钥、授权和运行卷均应纳入既有受控备份。

## 发布和检查

代码测试、复核并推送 main 后运行 `./release_dev.sh`。脚本负责发布分支和 tag，
不手推 release-dev。服务器开关未启用时仍运行原三个服务，`/grow` 明确返回503，
避免原先把 Admin SPA 的200误判成 Grow 已发布。

检查 `/api/health` 的版本必须等于脚本输出版本；再检查 `/grow` 跳转到
`/grow/` 和 `/grow/login`，以及 `/grow/api/health`、`/grow/static/login.js`。
还必须在真实 HTTPS 上完成登录、读写和重启回读，才可声称服务部署成功。
独立数据库及配置未准备时，单纯触发 release_dev.sh 不能启用 Grow 容器。

## 本地验证边界

隔离 PostgreSQL 和 Chromium 验证了带旧根路径 Cookie 的登录、静态资源与 API 留在 `/grow`、
行动写入后重启回读、退出会话失效；PostgreSQL 模式所有模块 ready，首屏没有存储503。
Docker daemon 本机未运行，容器测试没有通过记录。
公网发布状态以本轮实际 release 回执与随后 HTTP 检查为准。

本地验证库已从本轮独立 Grow PostgreSQL 迁入本机 Zook 的 `zook_local_integration`
数据库、`grow_h5_local` schema。迁移前保留 dump，97张表、60行既有数据逐表数量和
摘要一致，原源库保持可恢复。账号内部 schema 引用随迁移调整，避免读到 Zook public。
详情及备份位于本机私有 `.artifacts/grow-h5-local/`。不代表旧 Render/Supabase 的真实
历史账号和 GitHub 内容已经迁入，原服务没有被修改或关闭。
