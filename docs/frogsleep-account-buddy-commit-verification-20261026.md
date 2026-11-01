# FrogSleep 账号与搭子提交前复验

日期：2026-10-26。业务基线为 `edbfbf8e5e633c88fc03f897731deb769fdaeadb`，从该提交导出独立源码副本进行本地验证。本轮没有新增后端业务代码；提交范围仅为本复验记录。原有未提交的 `docs/frogsleep-backend-verification-20261025.md` 保留，不纳入本次提交。

## 验证结果

| 检查 | 结果 |
| --- | --- |
| 全量后端单元测试 `npm test` | 1623 项：1622 通过、0 失败、1 项因未传专用数据库而跳过 |
| 邀请未读时钟数据库补验 | 7 通过、0 失败、0 跳过，包含上述跳过场景；与全量单测有重叠，不简单相加 |
| 全部 FrogSleep PostgreSQL 集成测试 | 15 文件，93 通过、0 失败、0 跳过 |
| `npm run check:api-contracts` | 通过 |
| `npm run check:line-count` | 通过，696 个源码文件在限制或既有基线以内 |

PostgreSQL 每个文件使用新建的独立本地数据库，覆盖账号归属与注销、双账号旅程、邀请与授权、关系并发与升级迁移、共同睡眠/专注完成、跨日绑定与重试、通知、私人历史与游客升级，以及留言/小花持久化和真实本地 HTTP。

独立副本复用本机已安装的根目录和管理端 `node_modules`，未引入新依赖。首轮因副本缺少管理端 TypeScript 依赖链接，有一个测试文件无法加载；补齐现有依赖后重新运行全量测试，最终结果如上，没有为此修改业务源码或测试。

## 证据与边界

源码副本和证据位于 `/Volumes/肖豪/project/Zook/.artifacts/account-buddy-commits-20261026/`：

- `backend-unit-final.log`：最终全量单测。
- `postgres-results.json`：逐文件数据库名称、退出码及计数；各文件日志同目录保存。
- `backend-contracts.log`、`backend-lines.log`：合同一致性与行数门禁。
- `baseline.json`：提交操作前的工作区文件摘要。

全部数据库均为本机专用测试库，未使用 dev/online 业务数据库。没有验证真实短信/邮件、APNs/FCM 设备送达或生产发布配置；本记录不等于生产上线放行。此次仅提交验证记录，不推送、不部署，不修改其他已有工作区文件。
