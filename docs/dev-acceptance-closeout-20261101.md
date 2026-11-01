# Dev 验收缺口补齐操作包（2026-11-01）

本轮延续先 dev 后 online，Render 不变。源码从最新 origin/main `5e784ca` 开始；该基线已补齐 BodyLog 邀请码能力，不再沿用上一份历史报告的“尚未实现”结论。修复后必须经原 release_dev.sh 发布并核对实际版本，再记录公网结果；不把本地准备写成现网通过。

## 本地最终结果

Node22.22.0：全后端2196项全部通过，0失败/0跳过（含独立新建PostgreSQL的邀请排序）；根/后台audit均0；851个源文件行数门禁通过；API合同、后台类型/构建及LightTick/Yaohezi专项类型通过。独立BodyLog PostgreSQL5项和Sleep正式身份升级/注销真实HTTP+PostgreSQL1项通过，均不连接现网。Python部署专项31项中30通过、1项真实Docker opt-in跳过；本机Docker daemon未运行，不把该项写作已通过。外部TLS SMTP与实际支付宝SDK兼容专项已通过，未发送外部邮件。

独立审查发现的operator隔离三处问题均修复，并实跑18个拒绝场景、配置幂等与自定义镜像回归。广泛历史后端tsc仍有既有诊断，不能用专项类型通过替代其完成；本轮抽取对照基线无新增实质诊断。

## 已补的代码与门禁

- 后台 server 对三个精确 GET 邀请路径转发同槽位 API，保留 query/deep-link/302，强制 no-store/no-referrer、拒绝其他方法，公开错误脱敏，阻止 absolute URL 替换上游；原 API SSE 行为保留。
- 六处超长源文件按职责拆分，未调整599行阈值或扩大豁免。
- 根和后台依赖审计修复；最低安全补丁、Node22、真实支付宝 SDK 与本地 TLS SMTP 已验证。未发送外部邮件。
- 原 main 的两处烟测测试仍断言64 tokens，而已审查实现为32768；按最新 main 需求修正严格断言，不放宽失败条件。
- LightTick 配置脚本从历史聊天命令迁入 `build_scripts/lighttick_dev_enable.py`：参数化 expected-release、默认不改 env、apply/rebuild 分离，保留隔离/镜像/备份/清理父进程环境的保护；同时显式写dev环境/槽位，拒绝目标覆盖query，按仓库解析相对目录，传入已核定镜像名。
- 真实域名检查脚本 `build_scripts/frogsleep_domain_acceptance.py` 会把 Admin SPA 200、外域跳转、版本不匹配与隐私头缺失视为失败。仅匿名 GET，不宣称账号/双人/设备验收完成。

最终本地检查、公网回执及实际发布 SHA/版本保存在集成工作树 `.artifacts/acceptance-closeout-20261101/`。后台与专项严格类型检查不等于整个历史后端广泛 tsc 全绿；广泛检查的既有诊断另行保留。

## 服务器最小操作：LightTick runtime

目前没有服务器 SSH/私有配置访问，本节由服务器操作者执行。默认目录 `/home/ubuntu/app/Zook`，以实际 CICD OS 用户与路径为准；无需发送 env 或密码。

```bash
cd /home/ubuntu/app/Zook
# 从本次 release_dev.sh 输出取完整 release_head，不是 source main SHA。
# 不要使用旧版 88d254d、e8a194e 或“当前HEAD”替代核定的发布SHA。
read -r -p '本次已核定的完整 release_head: ' ZOOK_VERIFIED_DEV_RELEASE
python3 build_scripts/lighttick_dev_enable.py --expected-release "$ZOOK_VERIFIED_DEV_RELEASE"
# 仅在上行所有检查通过且确认是真实隔离dev后继续；同版本重建会短暂中断dev。
python3 build_scripts/lighttick_dev_enable.py --expected-release "$ZOOK_VERIFIED_DEV_RELEASE" --apply --rebuild
```

需要 dev.env 的 APP_ENV 为空或dev（显式online拒绝）、单独的 DB/Redis/文件目录与 Compose project，online.env 仅供只读比较。脚本核对 Git、active_release 和运行 API image/revision；无法确认会停止，不自动更换数据库或目录。备份位于 `~/.zook-private/lighttick-dev/`，文件600；不修改online或Render。静态 endpoint 比较不能替代所有者对真实底层隔离的确认。

然后本人登录 `https://app-dev.youwoai.net`，选择 LightTick 配置。先私下保存完整原JSON和revision，在原JSON中合并 `enabled=true` 与 `featureFlags.offlineSync=true`，保留其他字段；没有应用时通过应用管理建立 appId=lighttick，不开启演示seed。当前管理配置无CAS，避免多人同时修改。检查公开 config 的 enabled/sync 均true后，还需实际同账户验收。

## 专用 QA 身份与真实账号验收

当前用户确认没有 QA 账号；不会使用代码中的本地测试验证码、游客身份或个人账号冒充已验证的正式身份。A/B/C应通过正常 dev 注册流程建立、由本人控制接收渠道；D是可永久注销的一次性dev账号。未新增公开鉴权绕过，也未自动发送验证码/邮件。

```bash
mkdir -p "$HOME/.zook-private"
chmod 700 "$HOME/.zook-private"
cp deploy_configs/frogsleep-dev-qa.env.example "$HOME/.zook-private/frogsleep-dev.env"
chmod 600 "$HOME/.zook-private/frogsleep-dev.env"
# 本人在编辑器填写四个专用身份。不要把文件上传到Git或聊天。
```

准备完只需给代理私有文件路径。以下命令限已确认的 dev QA 文件，不开启 shell tracing；先验证非删除部分，再明确使用D执行注销测试。

```bash
set +x
set -a
. "$HOME/.zook-private/frogsleep-dev.env"
set +a
FROGSLEEP_DEV_BASE_URL=https://app-dev.youwoai.net FROGSLEEP_DEV_ACCOUNT="$SMOKE_A_EMAIL" FROGSLEEP_DEV_PASSWORD="$SMOKE_A_PASSWORD" npm run acceptance:frogsleep-dev
# 这一行会永久注销D。只有确认它是可删除专用账号时执行，不能使用A/B/C。
FROGSLEEP_DEV_BASE_URL=https://app-dev.youwoai.net FROGSLEEP_DEV_ACCOUNT="$SMOKE_A_EMAIL" FROGSLEEP_DEV_PASSWORD="$SMOKE_A_PASSWORD" FROGSLEEP_DEV_DELETE_ACCOUNT="$SMOKE_DELETE_EMAIL" FROGSLEEP_DEV_DELETE_PASSWORD="$SMOKE_DELETE_PASSWORD" npm run acceptance:frogsleep-dev
```

双人搭子与跨账号拒绝必须使用A/B/C再验；现有smoke脚本可能创建邀请并触发QA邮件，只在本人控制且同意接收的测试身份上执行。代理取得私有配置后先核对目标/账号范围，不清理个人关系。真机 APNs/邀请唤起需要dev构建、用户设备与实际收件，mock/provider accepted不作替代。

## 邀请域名、代理日志和 Grow

新后台转发随Git镜像部署，通常无需改 Nginx 即可修复原SPA fallback。若外层代理并未转给本后台，或需关闭token日志，再由服务器所有者按 `deploy_configs/nginx/frogsleep-links.conf.example` 在对应HTTPS server应用精确location，核定端口、`nginx -t`后reload。不能假定新server已控制外层访问/错误日志。Sleep当前是自定义scheme接力；AASA/assetlinks及已安装/未安装行为仍独立验收，禁止复用HabitTap的应用身份。

```bash
read -r -p '本次实际版本: ' ZOOK_VERIFIED_DEV_VERSION
python3 build_scripts/frogsleep_domain_acceptance.py --base-url https://app-dev.youwoai.net --expected-version "$ZOOK_VERIFIED_DEV_VERSION"
```

Grow仍缺本人管理的隔离dev HTTPS域名/证书、独立数据库/角色/Fernet密钥、测试GitHub来源凭据及显式账户绑定；未准备前保持GROW_DEPLOY_ENABLED=0。Render不改指向、不迁移个人历史。课程/笔记/计划同ID、账号隔离、重启重试六项实际故事完成后才能签验收回执和推进online。
