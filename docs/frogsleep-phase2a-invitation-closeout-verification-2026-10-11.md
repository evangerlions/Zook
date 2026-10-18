# FrogSleep 2A 统一邀请本机验证（2026-10-11）

本批实现 `deliver-sleep-phase2a-backend` 2.1，对应 Sleep 客户端 4.2。基线与 fetch 后 `origin/main` 均为 `4599ef52ff6e017b39d01ceb8d4ea6830be78bb7`；工作区 `.worktrees/sleep-phase2a-backend`、分支 `feature/sleep-phase2a-readiness`。该 SHA 加未提交的 2A 改动才是本机测试对象；未合并、推送或部署。

## 结果与边界

- 预览只读，返回各域 status、decision_version、viewer_actions、原 relationship_id；聚合状态不是域决策真值。已决策域不会再次展示按钮，pending sibling 可继续处理。
- 未绑定邮箱按当前账号邮箱确认，错账号/错角色/未知邀请中性 404；仅成功的显式 accept/decline 绑定收件人。未注册收件人的邀请可以由邀请人分域取消。
- actor、域、动作、原版本和同 key 对应唯一决定；并发 CAS 失败回滚，回放不重复关系/slot/授权/通知。accept 的 key 相同但 expected_version 改变也返回 409。
- accept 原关系 ID 存在 decision 中。解除及新 slot 占用之后，旧回放返回原 revoked 关系，不误返回新搭子，不重建关系/授权。
- 分域新协议不创建 legacy 关系或隐式 grants；只同步旧 child 的终态投影。兼容整单授权语义保留，但角色必须在回放前检查，不能覆盖新协议终态域。
- 新旧接受共享 slot 行锁、重读 child 状态，并同时核验 canonical slots 与既有 legacy 关系。slot→bundle→decision 的顺序避免整单与新协议交错死锁；safety 锁 bundle→decision，不写 slot。内存 exclusive/command/safety 使用同一调度队列，避免回滚抹掉另一事务。
- 022 增加原始关系回执；历史回填只接受 app、域、双方及决定时间完全匹配的唯一关系，缺失/歧义不猜测。新类型单独文件，保留公共 re-export。

## 指定实现范围

统一邀请 bundle/accept/safety/兼容 service、只读域预览/身份/兼容决策/slot 辅助；Sleep/Focus 旧 accept 仅增加共享 slot 锁与状态重验；ApplicationDatabase 锁与 receipt 协议、PostgresDatabase 委托、PG decision store/slot 锁/safety 事务、内存相同调度及 receipt 映射、records 类型抽取、022 迁移；新增 API/真实 PG 专项及既有 safety 锁断言；canonical OpenAPI/generated/generator 清单、README_API、邀请专题、能力矩阵、两端 OpenSpec/统一规划与本记录。其他业务、2B、worker、部署不扩展。

## 验证

| 验证 | 本机结果 | 日志 |
|---|---|---|
| `npm test` | 1306/1306 通过，0 skipped | `/tmp/phase2a-invitation-full-backend.log` |
| 新邀请 API 专项 | 5/5 通过（包含在全量内） | `/tmp/phase2a-invitation-new-backend.log` |
| 新 PG 邀请专项 | 10/10 通过，含 9 个子测试及总测试 | `/tmp/phase2a-invitation-postgres.log` |
| 既有 PG 并发 gate | 6/6 通过 | `/tmp/phase2a-invitation-existing-postgres.log` |
| 既有 PG 升级 gate | 1/1 通过 | `/tmp/phase2a-invitation-existing-migration.log` |
| generate/check public contracts | 通过 | 已同步生成文件 |
| OpenAPI lint | 0 errors，194 既有 warnings | `/tmp/phase2a-invitation-contract-lint.log` |

PG 使用本批创建的可丢弃 `sleep_phase2a_invite_20261011`，两个独立 PostgresDatabase/pool 连接及 SQL 连接；清理只作用于该测试数据库。覆盖 10 次同键接受、8 次接受/取消竞争、分域并发、邮箱晚认领、解除后新 slot 占用的旧回放、同/不同邀请新旧接受竞争、8 次取消同键回放及迁移重复回填。

```sh
FROGSLEEP_TEST_DATABASE_URL='postgresql://hao@localhost/sleep_phase2a_invite_20261011' \
  node --experimental-transform-types --test test/integration/frogsleep-invitation-closeout.postgres.test.ts
```

`check:line-count` 仍有 9 个既有超限/基线文件，ApplicationDatabase/PostgresDatabase 只增加任务协议与委托，不据此宣称全仓门槛通过；新增 helper 无超限。旧兼容流程在 pg 8 仍有同一 client 查询重叠的 deprecation 提示，本机 gate 通过，不代表 pg 9 兼容已验证。

2.1 本机审计与补缺完成，累计 7/16；2.4 其他协议、2.5 完整邀请/slot/grant 门槛及 §3 dev、SES、APNs/FCM、真机/发布保持未完成。两账号数据共享/撤权、完整 Sleep/Focus 旅程由后续 2.2 和客户端 4.3/4.4 验证，不把本批邀请回执视为端到端旅程通过。
