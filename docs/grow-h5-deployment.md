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
`DATABASE_URL` 必须使用与 Zook 不同名的数据库；原用户数据库不能覆盖。
`GROW_PUBLIC_URL=https://app-dev.youwoai.net/grow`，`GROW_BASE_PATH=/grow`。
`FORWARDED_ALLOW_IPS` 填同 Compose 网络中受控 admin-web 代理的地址或隔离网段；
不得填 `*`。TLS 原始 scheme 经管理系统转交 Uvicorn，Host 保持外部域名，
同源写入校验才能正确工作。数据库必须完成实际连接及 CREATE SCHEMA 权限预检。
GitHub仓库/Token用于内容功能；AI维持原有按需配置方式。

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

隔离 PostgreSQL 和 Chromium 验证了登录、静态资源与 API 留在 `/grow`、
行动写入后重启回读、退出会话失效。未配置 GitHub 的规划/草稿503另行记录。
Docker daemon 本机未运行，容器测试没有通过记录。
公网发布状态以本轮实际 release 回执与随后 HTTP 检查为准。
