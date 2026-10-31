# 药盒子本地开发与验证

开发工作区：`/Volumes/肖豪/project/Zook/.worktrees/yaohezi-family-care`，分支 `feature/yaohezi-family-care`，已合入 `origin/main@0b28ef7`。原 Zook 工作区的 FrogSleep 分支和未跟踪资料保持原样。本分支尚未合并回 main、推送或部署。

## 运行

```sh
cd /Volumes/肖豪/project/Zook/.worktrees/yaohezi-family-care
npm run verify:yaohezi-local
```

需要本地 Node、PostgreSQL 和 `redis-server`。PostgreSQL 默认 `127.0.0.1:5432`，使用当前 OS 用户（可显式设置 PGUSER），该用户需有创建数据库权限。自定义端口使用 `YAOHEZI_LOCAL_PG_PORT`。不需要提供短信、存储、推送、支付或模型密钥。

脚本每次创建新的 `yaohezi_local_*` 数据库和独占临时 Redis。Redis 仅绑定 loopback、随机端口、随机密码，完成后关闭；不读取部署用 DATABASE_URL/REDIS_URL，不清空已有数据库或服务。测试数据库保留供检查，证据写入忽略的 `.artifacts/yaohezi/<数据库名>/`：`result.json`、`postgres.log`、`redis.log`。Redis 不保存长期会话数据到磁盘；测试覆盖的是应用实例重建后通过独立 Redis client 继续读取运行中的真实 Redis。

## 验证范围

- 实际 PostgreSQL 迁移、真实 Redis 和 HTTP 请求；登录验证码由服务器生成并按正常流程校验，未传 `test=true`。
- 错验证码拒绝；正常验证码建立账号及 yaohezi membership；me 不建立健康授权。
- 其他产品 token 拒绝；追加 token 分段返回 401。
- 两次并发 refresh 只成功一次；当前会话登出后新 refresh 失效；新应用实例保留正确成员关系，其他产品不受影响。
- 主体内部端口：显式确认、并发幂等、操作 ID 冲突、账号/主体分离、跨账号领取拒绝、数据库重开。

短信 transport 只在测试进程捕获验证码，不外发短信、不在证据里打印验证码或 token；任务队列使用内存 fixture，没有外部 worker/推送。HTTP server 仅绑定 loopback 随机端口，测试结束自动停止；本命令不是长期可供 App 连接的开发服务器。

## 当前产品边界

账号与设备 API 分别由默认关闭的 `YAOHEZI_ENABLED`、`YAOHEZI_HEALTH_DEVICES_ENABLED` 控制，本地 M2 fixture 显式开启两者。`self_asserted` 不证明患者身份。iOS 已接通账号；Zook 设备入圈、恢复、即时撤销及 Node 参考设备已完成本地验证，原生可信设备接入、密文同步、家庭授权、协作和会员 AI 尚未验收。

公共合同见 `api-contracts/openapi/yaohezi/api.yaml` 和 README_API。生产开启设备接口前仍须完成原生设备、密钥驻留、真机验证、外部密码审计、已记录的依赖告警处理和产品删除编排。真实短信、私有存储、推送、商店 sandbox、视觉供应商和正式发布有独立验收门槛。

## iOS 持续联调服务

```sh
npm run dev:yaohezi-local
```

此命令另建独立的 `yaohezi_local_ios_*` 数据库、私有临时 Redis 和 loopback HTTP 服务，默认 `http://127.0.0.1:18763`。看到 `Local iOS fixture ready` 后再运行 iOS 测试。可用 `YAOHEZI_LOCAL_HTTP_PORT` 改端口；自动化测试当前固定 18763。按 Ctrl-C 停止自有 HTTP/Redis，保留数据库和 `.artifacts/yaohezi/<数据库名>/fixture.json`。

iOS Debug 的 Xcode Run 环境变量设置 `YAOHEZI_LOCAL_BASE_URL=http://127.0.0.1:18763`，在“今日 → 账户与数据 → 登录与账号”操作。Release 忽略该变量并拒绝 HTTP；正式服务只通过 Info.plist 的 `ZookAPIBaseURL` 配置 HTTPS 地址，当前未预填生产地址。Debug 的本地 ATS 例外不进入 Release。

该脚本完全独立于部署入口。`/__local/*` 只由此 fixture 提供，要求 `X-Yaohezi-Local-Fixture: ios-account-tests-v1` 测试控制头，无 CORS；不是生产 API。测试端从 `/__local/phones` 分配两个新的合成手机号，正常请求验证码，再从 `/__local/otp?phone=...` 读取捕获的验证码供 XCTest 输入。App 业务代码不会调用这些测试路径，也不发送 `test=true`。另有合成会话撤销、重定向及计数控制，均仅作用于新建本地数据库/Redis。禁止把该脚本作为部署服务。

在原生工程 `apps/health-ios` 运行：

```sh
xcodebuild test -workspace HealthTimeline.xcworkspace -scheme HealthTimeline \
  -destination 'platform=iOS Simulator,id=294B8715-9E71-4A6F-8AFD-4E1EA1CE5A44,arch=arm64' \
  -parallel-testing-enabled NO \
  -only-testing:HealthTimelineTests/ZookAccountTests \
  -only-testing:HealthTimelineTests/ZookLocalAccountIntegrationTests \
  -only-testing:HealthTimelineUITests/ZookAccountUITests
```

先确认该专用模拟器存在；没有时用本机可用的 iOS Simulator ID。未启动 fixture 时，本地集成/UI 用例明确 skip，不算本地联调通过。实际验收要求这些用例执行且通过。

本地通过范围：验证码登录/错误码、真实 Keychain 跨启动会话、24 个请求 single-flight、真实服务端 refresh/logout 撤销、双账号切换与旧账号上下文停止、父亲 SQLCipher 本地档案保留且未发生云端资料请求。补充模拟传输测试覆盖迟到 401、退出/刷新竞态、Keychain 写入/清除失败、丢失刷新响应与禁止无限重试；真实 HTTP 还验证认证请求不跟随 307 重定向。外部短信、真机与正式发布仍未验收。

## M2 本地验证

`npm run verify:yaohezi-local` 包含账号、主体路由、健康设备三组集成，共 18 个 test/subtest。M2 使用正常随机短信验证码及真实 Redis/PG/HTTP，覆盖设备批准、资源版本钥、只读签名改药与跨主体拒绝、撤销并发顺序、重开、三条恢复路径、旧恢复根拒绝、快照时效、伪造授权和限流。

`npm run typecheck:yaohezi-security` 严格检查协议、客户端参考和 PG 实现；`npm test` 运行全仓单元。加密测试含 RFC 8032/9180 公共向量、恢复 AAD、HPKE 负向及未来版本钥轮换。向量里的私钥是公开测试资料。

`npm run dev:yaohezi-local` 继续是账号 UI fixture，默认不启用 M2；无需开启健康接口即可重复 iOS 账号验收。M2 没有原生设备界面入口。测试 PG 库和证据保留，HTTP 与私有 Redis 验收后自动停止，不改用户 Redis 6379。
