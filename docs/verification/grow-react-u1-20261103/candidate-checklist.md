# 工程切片候选与剩余门禁

**17/27，未达到完整迁移/发布候选。** 固定版本、静态资源摘要和数据库增量见 [candidate-slice.json](candidate-slice.json)。JSON 中 Zook SHA 是生成此清单前的已提交候选，后续文档提交不追写成循环 SHA。唯一合同源仍在 Zook OpenAPI。前端由干净 detached worktree 生成，未复用用户 staged 改动；本轮均在原候选分支提交，没有推送或发布。

## 兼容矩阵

| 组合 | 已验证结果 | 仍待执行 |
|---|---|---|
| 固定 React 产物 + 当前 Zook + PG 085–087 | 学习版本/私人组件 CAS/旧答案、实践、丢响应、公开配置链接、375px；U2 原故事回归 | 全旧行为逐项、正式路线、知识和投资 |
| iOS 570494e + 当前 Zook 合同 | 私人学习原生终态、来源/实践、原生 Web 地址；同步与 V2→V3 存储专项 | 完整分页/发布新入口、真机、读屏、扩展跨进程 |
| Android e77d459 + 当前 Zook 合同 | 对应 JVM 学习/实践/HTTP/同步专项；Room 事务实现编译 | 完整新入口、模拟器完整故事、真机/读屏 |
| 旧 App schema / 功能关闭 | 原兼容合同及 task-only push 保持；新增实体未加入旧 pull | 历史二进制实际安装矩阵及其他 App 混合负载 |

## 可重复本地门禁

在 Zook 根目录执行，不访问真实历史。PG 测试只接受专用 localhost `grow_web_u1_` 数据库；不得将该变量指向 dev/online。

```sh
npm run check:api-contracts
npm run lint:api-contracts
npm run check:lighttick-actions-types
node node_modules/typescript/bin/tsc -p tsconfig.lighttick-learning.json
npm run check:line-count
npm test
python3.13 -m unittest discover -s build_scripts/tests -p test_inventory_grow_legacy_behaviors.py
python3.13 build_scripts/check_grow_migration_ledger.py --ledger docs/plans/grow-zook-native-web/migration-ledger.json --inventory docs/plans/grow-zook-native-web/current-behavior-declarations.json
```

最后一项目前应非零退出：516 个操作待语义核对。这不是可忽略警告。OpenAPI lint 当前 6 个既有警告；全仓临时 tsc 历史问题未伪称通过，仅专项类型通过。

```sh
LIGHTTICK_TEST_DATABASE_URL=postgresql://grow_web_qa@127.0.0.1:58630/grow_web_u1_20261103 node --experimental-transform-types --test --test-concurrency=1 test/integration/lighttick-commit-order-postgres.test.ts test/integration/lighttick-today-snapshot-postgres.test.ts test/integration/lighttick-native-learning-postgres.test.ts
```

浏览器在合成 fixture 和固定产物启动后运行 `test/support/grow_web_{learning,practice,u2}_acceptance.py --url http://127.0.0.1:58631 --output <local-artifacts>`，逐个执行，避免修改同一合成 owner 时互相影响。fixture 必须显式启用现有 Actions/V2/NativeLearning 开关，AI 使用 deterministic synthetic provider，不推断真实模型质量。

## 迁移预演边界

已完成学习模块合成包：冻结、失败导入回滚、原请求/终态、重连对账、显式激活、拒绝迟到 bridge、激活后新写入禁止 abort 覆盖。CLI 单测保证默认 offline dry-run，无隐式网络或写入。实际步骤通过专用 PG 集成测试复现，包含固定身份/来源清单摘要与水位。

还缺全模块、分块和增量协议、独立源冻结执行器，以及激活后补偿/重新导出的完整预演。当前 manifest 最大 6 MiB/200 课节，超限拒绝。不得用此切片切换真实账号。

## 放行前必须逐项补齐

- U0：516 操作逐项合同/页面/测试/迁移处置；金融黄金数据及全域水位/快照；其他 App 开关双态无新增 5xx，固定负载/并发/样本窗口，P95 相对基线增幅 ≤10%。无基线与测量原始证据不得放行。
- U3：正式课程路线/阶段/进度、双端完整入口；平台 AI/文件/采集 worker 的预算/取消/租约/重启与幂等发布。
- U4：知识/认知/搜索/时间线/成长只聚合确认事实并可追溯；长文本及全域撤权/删除/账号删除/离线清理/安全导出。
- U5：完整投资/研究行为，Node CSV/Tushare/东方财富/腾讯独立开关与显式失败；精确金额、十进制 API、交易日/复权与固定数据集/算法版本回测；全部合成迁移及非破坏回退。
- 独立执行：真实模型评估、真机与读屏、长期观察、经授权真实迁移；最后才按 Zook 原流程 main→dev→同 SHA online，并记录 App 二进制版本。上述项目目前均未执行，不从本轮本地结果自动勾选。
