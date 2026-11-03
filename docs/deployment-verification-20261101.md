# Zook 待提交整理与 Sleep 部署验收（2026-11-01）

本轮按用户授权整理 Zook 的未提交内容，先集成 main、发布 dev，再验收已部署服务。online 和现有 Render 保持原状态；没有运行 release_online.sh。

## 来源与处置

基线 origin/main 为 `9cdf0fa0cfcda452ab2b25faec9ccd8250a35239`。原工作树均保留；只在新 feature 工作树集成经过审查的内容。

| 来源 | 结果 |
| --- | --- |
| frogsleep-apns-http2-20261101 四文件 | 合入 APNs HTTP/2 默认传输、15 秒超时、连接清理与测试；相关 15 项通过，不代表真机推送到达 |
| buddy-center-qa-fixes 五文件 | 三份回归按当前合同完善；两个 helper 已在 main 内联实现，作为重复历史文件保留，不再引入。旧目标夜窗预期与当前完成截止合同冲突，依据见 frogsleep-sleep-pending-review-20261101.md |
| yaohezi-family-care 十四文件 | 依赖未合入的账号/设备信任基线；基线与增量分别审查，保留最新 main 的 billing/LightTick 实现后合入。两个产品开关默认关闭 |
| lighttick-native-enhancement-reproduction-backend 单文件 | 旧快照。main 已有同名测试且多出 method override 回归；旧文件会删除现有覆盖，未覆盖 main。旧版 21 项在当前实现通过 |
| bodylog-group-invite-code 单文件（独立 clone） | 七项邀请码前瞻测试失败，main 缺少对应实现；源文件保留，未把失败测试作为可发布能力合入 |
| 根目录 10-25 验证报告 | 原文归档并明确历史日期，避免旧工作区失败状态被误读为当前结论 |
| 目录迁移后失效的 Git worktree 元数据 | 未删除、未 prune、未修复旧路径，防止误改其他现场 |

## 本地验证与边界

独立 Sleep 复核 470 项：469 通过、0 失败、1 需 PostgreSQL 的既有条件跳过；新增最终 18 项通过。Yaohezi 在最新 main 基线的隔离 PostgreSQL、Redis 和真实 HTTP 验证 20 项通过，无跳过；相关 35 项单元、严格类型与合同生成检查通过。

整合后重新运行全后端单元、后台类型与构建、LightTick 类型、合同一致性，以及独立新建并清理的 Sleep PostgreSQL 数据库专项。完成后将最终结果与发布 SHA/版本归档至本工作树 `.artifacts/release-20261101/`，发布前必须全量单元无失败；不把未完成检查记作通过。

依赖安装与数据库测试曾并行造成一次缺包，停止无界并发测试后在安装完成的工作区重跑；原失败日志保留，不作为产品缺陷。没有接入或清理任何线上数据库。

当前依赖审计：根 5 项（4 high、1 moderate），后台 13 项（9 high、2 moderate、2 low），0 critical。未执行自动大版本升级。行数门禁的五个超限文件在基线已超限，其中 application-factory 与 application-database 本轮为接入端口各增加 3 行；其余超限文件未增加行数，详见本轮日志；这些是后续治理与 online 放量前评估项，不能声称工程全门禁通过。

## 公网基线与 Sleep 端配置

Sleep iOS 的 productionZookAPIBaseURL 与 Android productionZookApiBaseUrl 均为 `https://app.youwoai.net`；iOS dev 可显式选择 `https://app-dev.youwoai.net`，Android 需使用 dev 构建配置。旧 `https://api.bodylog.app` 保留为旧接口/回滚入口；当前机器到其 HTTPS 握手超时。同样未验证通 `https://api.zook.dev`，不据此判定全球停机。

发布前 dev `/api/health` 为 `20261101_001`；online 为 `20261009_005`。online 的 `/api/v1/frogsleep/product-data/personal-sync/state` 返回 404，dev 已能进入鉴权。因此 main 的新同步能力不能据本地测试宣称已在正式端可用。

发布前 dev 真实游客验收 42 个检查通过：游客创建丢回执重放、原始睡眠同步、修改/删除墓碑、分页固定边界、越权拒绝、删除与旧游标隔离；所有自建游客均清理。complete=false，正式账号升级和正式账号注销未验证。最终新版本必须再跑一次，并验证版本匹配。

两个域名的三个 `/frogsleep/buddy-invitation`、`/frogsleep/sleep-buddy-invite`、`/frogsleep/focus-invite` 页面目前均返回 Admin SPA HTML（200 不等于邀请跳转正常）。已提供 `deploy_configs/nginx/frogsleep-links.conf.example`，需服务器运维在对应 HTTPS server 应用、`nginx -t` 后 reload。默认 dev API 3101、online 3100；实际以槽位 DEPLOY_HOST_PORT 为准；带 token 路径关闭 Nginx 访问与错误日志，故障通过不含 token 的上游健康监控观察。

两个域名的 AASA 返回 Admin HTML、assetlinks.json 返回 404。Sleep 当前有自定义 scheme 接力；Android HTTPS intent 未启用 autoVerify，iOS 不能据此宣称已启用 Universal Links。不能套用 HabitTap 的 AASA 身份或把其文件当 Sleep 验收通过。

## 待用户/运维配合

1. 用户确认暂无专用正式测试身份：需要 dev 专用账号 A/B，注销验收再用独立一次性账号；以本机私有配置路径提供，不在聊天发送密码。暂不执行真实用户数据清理。
2. 需要服务器管理访问或由运维应用三个 handoff 精确路径代理；当前没有 SSH/私有服务器配置。先备份现有站点配置，检查端口与域名，`nginx -t` 成功后 reload，再复验。
3. 需要 dev build 与真实设备，验证邀请唤起、接受/撤回、双人共同完成，以及 APNs 实际收件；provider accepted 与 mock 不代替设备收到。
4. LightTick dev 的 enabled/offlineSync 配置尚未由用户填写，Grow dev HTTPS/隔离数据库也尚未准备，Render 保留。上一轮固定旧 release SHA 的最小命令不能直接套到本次新发布，需以实际 release state 重新核定。
5. Yaohezi health 正式开启前完成账号删除编排和共享依赖审计项；本轮仅默认关闭部署。

上述缺口未解决前，不生成“全产品验收通过”结论，也不发布 online。发布 Git ref 成功、API 版本更新和功能开关就绪是三个独立事实。
