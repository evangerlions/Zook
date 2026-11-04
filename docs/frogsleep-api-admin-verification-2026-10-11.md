# Sleep 后端 API 与当前管理系统接入验证记录

日期：2026-10-11。实施目录：`/Users/hao/Documents/project/Zook/.worktrees/sleep-phase2a-backend`；分支 `feature/sleep-phase2a-readiness` 从当前 `origin/main=4599ef52ff6e017b39d01ceb8d4ea6830be78bb7` 续接。原 Zook 根 checkout 的 `94602cc` 仅审计，没有合并或覆盖；Sleep/Zook 原工作区 WIP 均保留。本批未提交、推送、合并、部署。

## 已完成的代码范围

- 复用已实现的注册登录、私人专注幂等、统一邀请、方向授权、关系生命周期、双账号共同旅程和通知worker。
- 个人同步新增 protocol/service/repository、070/071迁移、账号级事务锁、不可变资源修订/变更、操作摘要与回执、稳定ID、If-Match、epoch、签名游标、完整数据库keyset浏览、固定恢复与增量墓碑。报告浏览保留业务时间/ID降序；偏好空读取保留progress:null兼容。
- 相同旧快照正文合并并保存旧ID映射，不同正文保留独立冲突资源；报告偏好取最新状态。历史版本、墓碑与回执不自动压缩；账号删除清正文和新增表、换epoch并禁止旧无epoch写入，其他App不受影响。
- 管理系统新增 `/frogsleep` 路由与FrogSleep工作区导航；概览与10类数据库分页元数据、筛选、独立敏感授权、原Push任务重试和审计。审计记录管理员username；原邮件诊断认证保持兼容。
- 不返回私人正文、邀请密钥、邮箱或push token。失败重试保留原任务、设备回执和5次预算；未知/processing、终态、耗尽预算及跨App请求拒绝，worker每次尝试重新验权。
- 前端清理项目切换/卸载时用户数据和操作上下文，通过请求取消结果与generation拒绝旧响应和旧重试；含加载、空、错误、分页与会话失效跳转。

## 验证

| 检查 | 本批结果 | 日志 |
|---|---|---|
| 完整Node后端回归 | 1350/1350，无失败/跳过 | `/tmp/sleep-admin-backend-full.log` |
| 私人同步+管理PostgreSQL | 8/8，含父测试；两独立连接、530条+日期/ID浏览、固定视图、提交顺序、唯一revision、rollback、legacy回填重跑、删号竞争/跨App/epoch | `/tmp/sleep-admin-pg-frogsleep-personal-admin.postgres.test.ts.log` |
| PG生命周期/邀请/slot并发/迁移回归 | 8+10+6+1=25，通过；各文件新建独立数据库 | `/tmp/sleep-admin-pg-*.log` |
| canonical生成物 | check通过 | `/tmp/sleep-admin-contracts.log` |
| OpenAPI lint | 0错误、192既有警告 | `/tmp/sleep-admin-openapi-lint.log` |
| Admin Web typecheck / build | 通过 | `/tmp/sleep-admin-typecheck.log`、`/tmp/sleep-admin-build.log` |
| OpenSpec strict | 后端3个change和客户端2个change通过 | 对应tasks文件 |
| source-line全局门槛 | 未通过，保留9个既有大文件；新FrogSleep路由未新增违规 | `/tmp/sleep-admin-line-count.log` |

额外后端TypeScript诊断：新增私人同步/后台文件无诊断；继承的后端类型错误仍存在，本仓库实际后端执行门槛为Node transform-types测试。未将全局TypeScript诊断或source-line失败写成通过。

真实浏览器使用生产构建与localhost隔离内存服务，验证：管理员登录、FrogSleep导航、聚合概览、用户元数据二次授权、60设备跨页和token隐藏、独立重试授权→原任务QUEUED且次数2未重置、工作区切换清空且回到Sleep重新授权、会话失效跳转、320px已授权表格无页面横向溢出（修复Sleep页面grid容器最小宽度，横向滚动仅留在表格内）。最终构建展示私人同步读/写能力，无控制台error。页面验证期间不调用真实provider，不修改线上后台数据。

截图：[最终后台](assets/frogsleep-admin-2026-10-11.png)、[320px页面](assets/frogsleep-admin-mobile-2026-10-11.png)。本机临时服务/数据库在结束时清理。

历史94602cc审计：since以客户端业务occurredAt过滤，缺乏修改/删除commit顺序；游客upgrade接受guest_device_id猜测、查询kind缺省为sleep_invite、底层500条截断、非事务逐条改owner。本批不接入该游客云升级接口，使用已授权摘要恢复边界。

## 状态与外部门槛

Zook2A **12/17**（§2.4/2.5本机收口）、个人同步 **19/20**、后台管理 **7/8**。Sleep2A仍 **17/23**；Sleep2B仅前置 **3/15**，提供同内容JSON样本并通过生成schema验证，本批没有实现Swift/Android恢复或游客显式绑定。

未完成：当前dev双设备/第三/可删除账号联调、真实SES accepted→delivered、APNs/FCM真机deep link、Android/整体验收、main合并和同SHA dev→online发布。local fixture、schema样本、provider mock和浏览器成功均不替代这些外部证据。清理旧数据或通用自动压缩另需epoch/保留政策与专项，不由此批宣称已上线。
