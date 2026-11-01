# 送花与观察 CLI 测试闭环（2026-10-25）

## 修复与依赖范围

送花 HTTP 测试先完成双方密码登录，建立 FrogSleep App membership，再初始化关系并报名送花策略，避免在空数据库中被正确的成员鉴权拒绝。观察 CLI 测试将脚本与示例文件的 URL 经 `fileURLToPath` 转为真实文件路径，避免中文目录被百分号编码；临时输入目录包含中文与空格，作为持续回归覆盖。

经用户明确授权，提交包含原先未提交的送花与观察 CLI 必要依赖：业务服务、PostgreSQL migration 075 与仓储、内存测试仓储、路由和类型、注销与过期清理、旧接口约束、遥测、canonical OpenAPI 与生成代码、接入说明、观察示例与相关测试。送花开关仍由 `FROGSLEEP_BUDDY_SUPPORT_ENABLED` 控制，提交不会自动开启线上功能。

基于 `ddd822e69cf1b7f0e9826e9fa3e916fb0e224476` 创建候选 Git tree，导出仅包含已提交基线与所选依赖的独立副本验证。无需未选择的工作区源码；复用本地已安装的 node_modules，未新增 npm 依赖。独立副本位于 `/Volumes/肖豪/project/Zook/.artifacts/frogsleep-support-commits-20261025/Zook`。

## 验证结果

- 当前工作区与独立副本的全量单元测试均为 1615 项：1614 通过、0 失败、1 项缺少专用数据库而跳过。
- 为独立副本配置新的本地专用数据库，补跑 `frogsleep-buddy-invitation-unread-clock.test.ts`：7 项全部通过、无跳过（含 2 项 PostgreSQL 子场景）。该文件与全量单元结果有重叠，不将数字简单相加。
- 独立副本全部 15 个 FrogSleep PostgreSQL 集成测试文件：93 项通过、0 失败、0 跳过；每个文件使用独立本地数据库。
- 其中 `frogsleep-support-http-postgres.test.ts` 从空数据库启动，经真实 HTTP 完成双方登录、送花、请求幂等、回应去重、关闭接收后保留历史、后端重启恢复和功能开关验证。
- CLI 4 项专项在当前中文项目目录中全部通过；全量独立副本测试再次覆盖。
- `npm run check:api-contracts` 通过；候选提交差异空白检查通过。

本轮不宣称生产上线就绪。此前记录的全局行数超限及 OpenAPI warnings 不属于这两处测试修复；真实推送、邮件短信与购买流程仍需单独联调。观察 CLI 没有注册真实展示聚合源时仍返回 not_ready，不能据此宣称留存改善。

## 证据与保留现场

证据位于 `.artifacts/frogsleep-support-commits-20261025/`：`selected.json`、`tree.txt`、`independent-unit.log`、`postgres-results.json`、`independent-clock-postgres.log`、`independent-contracts.log` 及 `preservation.json`。较早的工作区修复验证位于 `.artifacts/frogsleep-test-fixes-20261025/`。

提交仅包含所选功能依赖、两处修复和本记录；之前的 `docs/frogsleep-backend-verification-20261025.md` 保留未提交。提交过程不覆盖工作区文件，保留所有已有文件字节；不推送、不发布。
