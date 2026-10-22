# FrogSleep dev 个人数据验收（2026-10-18）

本轮范围：真实 dev HTTP 的原始终态睡眠同步、可信游客升级、删号后的令牌/数据隔离。固定目标为 `https://app-dev.youwoai.net`；不执行 online 发布，不用猜测设备ID或手改数据库来恢复身份。

## 发布与首次观察

- 起始 main：`d397af2`；17项个人同步/游客/合同专项通过后，通过 `./release_dev.sh` 推送 dev。
- 发布：`version/20261018_001`，release commit `2e0162f4e77f34ec1f4aa053e5abafdd71485c5a`，source main `d397af22f613a2418c50d20e8931247e4582daa7`。origin/gitee 均由发布脚本更新。
- dev 起始健康版本 `20261009_004`；新原始/游客路径起初404。切换后健康版本为 `20261018_001`，实际游客私人数据旅程31项通过；该首轮暂不含已知失败的浏览器预检，也没有冒充正式账号升级/删号通过。
- 实际 HTTP 预检204却未允许PUT，浏览器无法修正原始记录；失败回归复现后补齐PUT与默认同步请求头。Origin allowlist不变。
- 新建的验收游客均通过本人 DELETE /me/account 清理；首轮清理无失败。去敏证据：`.artifacts/frogsleep-dev/guest-20261018_001.json`（不提交）。

## 可重复入口

`npm run acceptance:frogsleep-dev` 默认连接真实dev，允许loopback供自测；拒绝online/任意其他域、非默认dev端口、URL内凭据与路径，所有请求禁止重定向。

在权限为0600的本机配置文件中设置：

```text
FROGSLEEP_DEV_BASE_URL=https://app-dev.youwoai.net
FROGSLEEP_DEV_EXPECTED_VERSION=<已发布的固定版本>
FROGSLEEP_DEV_ACCOUNT=<可写但不删的专用QA账号>
FROGSLEEP_DEV_PASSWORD=<QA密码>
FROGSLEEP_DEV_DELETE_ACCOUNT=<明确允许销毁的独立QA账号>
FROGSLEEP_DEV_DELETE_PASSWORD=<可删账号密码>
FROGSLEEP_DEV_EVIDENCE_FILE=.artifacts/frogsleep-dev/acceptance.json
```

用 `node --env-file=/absolute/private/qa.env scripts/frogsleep-dev-acceptance.mjs` 运行，勿把凭据写进命令行、源码或证据。无账号时仍可检查游客自己的同步和删号；退出码2及 `complete:false` 表示部分验收。完整成功退出0，失败退出1。缺少任意一组账号凭据不算正式账号升级/删号通过。

旅程覆盖：固定健康版本、浏览器PUT/同步头、未认证拒绝、游客创建与丢失响应恢复、平台/专注权限限制、原始写入与幂等、归属伪造、CAS冲突、固定边界恢复、增量修订/墓碑、禁止墓碑复活、私人报告；正式目标凭据升级、错误proof/device/epoch拒绝、原请求重放、全部游客会话撤销、目标恢复与changes、碰撞后整事务回滚；独立可删账号的双会话撤销、旧refresh/队列拒绝、不自动重入、新身份空历史与旧epoch/游标隔离、其他账号状态不变。每次只创建唯一run ID的合成数据，清理自身游客和正式QA的本次活动记录；正式QA上的逻辑墓碑按协议保留。

删号验收遵循现有合同：同一身份的密码登录返回403 APP_MEMBER_DELETED；旧数据不可恢复。“新身份空历史”和“旧队列被拒绝”不同于提供同账号自动恢复功能，脚本不通过改库绕过该限制。没有被明确指定可删的账号，不执行正式身份删号。

## 本机与最终 dev 证据

- 第一次正式目标旅程使用仓库内置的可写QA身份，仅写入本次唯一run ID合成数据、随后清理，不删除此QA账号。升级/回执重放可执行，但冲突后目标sequence意外增长，整条旅程明确标为失败。
- 排除缓存：dev同一URL写前/写后state与提交sequence一致，Cache Miss且请求ID不同；使用相同来源数据的真实HTTP+PostgreSQL用例重现失败。
- 根因：HTTP execute内部捕获异常，外层withExclusiveSession因此COMMIT；guest store复用ambient事务，冲突前的partial写被保留。此前直接调用service的PG回归未经过错误转换层。
- 只对private Sleep资源/游客端点移除泛型HTTP事务外壳，资源服务拥有完整事务。真实HTTP+PG红→绿，独立SQL连接还证明在注入KV清理故障前已看到DELETED membership与升级receipt；原请求重放完成清理。
- dev残留的本次partial合成记录经本人GET确认200/revision1后DELETE清理，未改库或清理其他数据。验收脚本也补上失败路径中自身候选partial的清理和QA会话注销。
- 独立安全复核发现fetch默认重定向会转发POST正文；已对业务/预检禁用重定向，并限制dev默认HTTPS端口；本机307目标零请求回归通过。
- feature全量1472项通过；原始游客/个人同步/账号删除3套PG共24项通过，另新增真实HTTP PG专项1项通过。CORS与验收脚本9项单独通过。公共合同check与diff检查通过。仓库既有行数门禁9项超限单独记录，不把专项成功表述为所有仓库门禁通过。
- 真实dev第二轮修复后结果及正式可删账号旅程另记；可删注册QA凭据尚未提供时，不把该部分标为通过。

## 修复合并与第二次 dev 发布

- feature提交 `63d07cc`，合并main `2405765c8610541ed5c4150e9f0ebcc10ddced46`；合并后全量1472/1472通过，真实HTTP PG专项再次通过，生成合同check和diff检查通过。此前3套PG回归24项和新增HTTP PG1项共同覆盖本轮服务端修正。
- 通过 `./release_dev.sh` 从已推送的origin/main发布 `version/20261018_002`，release commit `84b59f7678aa953d3726af9ed6a26c4904057551`，origin/gitee均更新。健康检查确认200/20261018_002；未运行online发布。
- 修复后真实dev完整执行了当前可用账号范围内的80项检查，`passed:true`、清理失败0。覆盖浏览器PUT预检、原始同步/固定分页/增量/墓碑、正式目标游客升级与原回执重放、错误凭据拒绝、游客所有会话撤销、实际碰撞回滚（target sequence不变、partial资源404、来源两条记录完整），以及游客删号与新身份恢复隔离。
- 额外恢复验证：删号前保存真正的restore分页游标；删号后新游客sequence=0且历史为空，旧epoch上传409、旧restore游标409；显式新建历史仅有自身一条revision1记录。证据 `.artifacts/frogsleep-dev/recovery-20261018_002.json`，早一轮70项证据 `.artifacts/frogsleep-dev/acceptance-20261018_002.json`；均去敏且不提交。
- 后续仅增强本机验收脚本与记录，运行时代码src与上述dev版本一致；增强后9项本机HTTP/CORS测试和真实HTTP PG专项再次通过。所有本轮root及复核创建的一次性本机数据库已清理；合成活动记录/游客/本次QA会话已清理，逻辑墓碑按协议保留。

## 尚缺的正式账号删号验收

目前没有提供明确可销毁的正式注册QA账号。现有内置可写QA只用于本次合成数据，不对其删号。真实dev结果保留 `complete:false`、`registered_deletion:false`；游客删号恢复已通过，不能据此把正式注册身份的密码重新登录拒绝、双会话撤销及与其他账号隔离标为真实dev已验收。该正式旅程在本机真实HTTP+PG已通过；收到独立可删QA登录方式后，用同一脚本补齐最后一段。没有改库重新激活或新增自动恢复账号入口。
