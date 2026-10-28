# BodyLog 可重复验收与发布门禁

## 本地自动门禁

从干净、已同步的 main 创建 feature 分支开发。安装既有依赖后，为本次验收单独创建本机 PostgreSQL 数据库（数据库名必须以 `bodylog_` 开头）。不要传入业务库、共享库或线上连接。

```sh
createdb bodylog_readiness_run
BODYLOG_TEST_DATABASE_URL=postgresql://localhost/bodylog_readiness_run \
BODYLOG_GATE_REPORT_DIR=/tmp/bodylog-release-gate npm run gate:bodylog-release
```

依次检查生成合同一致性、源码行数、管理后台类型及生产构建、全部单元测试，以及真实 PostgreSQL/HTTP 集成。每步日志和最终 report.json 独立保存；失败立即退出非零。两个集成文件共享 migration，必须串行，避免空库并发建表冲突。不设置测试数据库时拒绝执行，不能把 integration skip 当作通过。

## 部署后的两个保留账号

先通过仓库 release_dev.sh 发布 origin/main 的已审核 SHA，再记录部署版本。凭据通过当前进程环境提供，不写入命令历史、仓库或报告。QA_A_EMAIL、QA_A_PASSWORD、QA_B_EMAIL、QA_B_PASSWORD 必须对应两个专用验收账号。

```sh
BODYLOG_EXPECTED_VERSION=<实际发布版本> \
BODYLOG_ACCEPTANCE_REPORT=/tmp/bodylog-dev-acceptance.json \
npm run acceptance:bodylog-dev
```

默认只登录并读取两账号资料、邀请、搭子、权益、任务、奖励和活动，同时检查匿名访问拒绝、关键能力版本及实验保持 disabled。版本不匹配会在登录或变更之前立即停止；公开能力/匿名鉴权失败也中止。任何账号读取或实验预期失败都禁止变更，不能只看 health 200。

显式设置 BODYLOG_QA_MUTATIONS=1 时，仅允许 loopback 或 app-dev.youwoai.net：确认两账号没有现存活跃/待接受搭子后，创建本次配对、由收件人接受、用同一 operation ID 两次鼓励并验证只回同一确认，最后只解除本次创建的关系。已有关系会保留并中止；不会删除账号、本地目标、报名或奖励。报告不包含密码、Bearer、邀请 token 或用户 ID。默认实验关闭检查不能替代正式实验审批；将来启用实验后须单独调整经审阅的验收预期。

## 实际产品页面验收

`npm run dev:bodylog-acceptance` 在 127.0.0.1:3138 启动临时内存库，使用生产 application factory、实际鉴权及业务路由。仅包含仓库已有测试账号 alice@example.com / bob@example.com、Password1234，和隔离后台 reviewer / ReviewPass123!；这些是公开测试夹具，禁止作为真实环境凭据。内存状态随进程退出丢弃，无外部通知供应商。不要暴露端口到局域网。

iOS Debug 需同时设置 --uitesting 及 BODYLOG_QA_API_ORIGIN=http://127.0.0.1:3138，覆盖认证、业务和配置 origin；只允许干净 loopback origin，Release 忽略该覆盖。BuddyPairUITests 通过正式页面执行计划报名/本地目标记录/返回刷新、邀请创建/服务端撤销/重新创建、两账号搭子流程。同一内存服务不要同时跑可变更脚本和页面测试：解除关系保留服务端冷却期；独立 suite 前重启临时服务，或为脚本另设 BODYLOG_QA_PORT。模拟器结果不能替代 APNs、系统安装链接回跳、WatchConnectivity 真机或连续七天到账。

## 邀请域名

将 deploy_configs/nginx/bodylog-links.conf.example 的 location 合入 **已有** bodylog.app TLS server；dev 上游为 127.0.0.1:3101，online 为 3100。先 nginx -t 再按运维流程 reload。模板不是实际 DNS/TLS/域名托管部署凭证。

```sh
BODYLOG_LINK_REPORT=/tmp/bodylog-links.json \
npm run check:bodylog-links -- --base https://bodylog.app
```

检查 AASA 精确 appID/路径、禁止重定向/SPA 假 JSON、五种链接显式打开 App、隐私及缓存头。测试用合成 token，不触发归因。`--base http://127.0.0.1:3138` 只证明服务器实现；正式域名失败时不得宣称 Universal Links 完成。尚无可核实 App Store ID，页面明确提示手动安装后返回原链接，不生成虚假商店地址。

## 发布边界

feature 完整测试及复核后合入 main，在合并后的 main 再运行专项测试并推送。使用 release_dev.sh，核实服务版本与待发布源 SHA。online 必须仍为同一个已验证 main SHA，并具备实际域名 AASA、分发签名/安装回跳、APNs、物理 Watch、真实跨日奖励证据及负责人确认；本门禁不会自动发布 online、开启实验或作出留存提升结论。实验设计与样本要求见 bodylog-retention-experiment-plan.md。
