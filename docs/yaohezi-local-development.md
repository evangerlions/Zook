# 药盒子本地开发与验证

开发工作区：`/Volumes/肖豪/project/Zook/.worktrees/yaohezi-family-care`，分支 `feature/yaohezi-family-care`，基于同步后的 `origin/main@e17a6ec`。原 Zook 工作区的 FrogSleep 分支和未跟踪资料保持原样。本分支尚未合并、推送或部署。

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

仅 `YAOHEZI_ENABLED=true` 启用账号路由，健康能力开关全部为 false。主体关联是内部 PostgreSQL 端口，不是公开健康 API；`self_asserted` 不证明患者身份、设备信任或访问权。尚未接通 iOS 账号客户端、设备入圈/恢复、密文同步、家庭范围授权、协作任务、会员页额度或视觉 AI。不得将本地账号测试结果描述为这些功能已完成。

公共合同见 `api-contracts/openapi/yaohezi/api.yaml` 和 README_API。开放健康接口前仍须完成可信设备及恢复协议、安全评审、统一授权检查及产品删除编排。真实短信/私有存储/推送、商店 sandbox、视觉供应商和正式发布有独立验收门槛。
