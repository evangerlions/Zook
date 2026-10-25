# C2 验收报告后续修复

2026-10-21。基线 `10496b9`；模块拆分提交 `5f902a7`，合同修复提交 `796e5c1`；在原 feature 工作树继续修复，不修改主干、原生端或生产配置。

## 已修复

行数门禁的 8 个失败全部解除，没有调整 `scripts/check-source-line-count.mjs`、阈值或豁免名单。

| 原文件 | 原行数 | 当前行数 | 拆分职责 |
| --- | --- | --- | --- |
| bodylog-group.service.ts | 873 | 592 | 查询/榜单、日记录、通知分别进入协作模块；服务保留原公开方法 |
| postgres-bodylog-admin.ts | 820 | 572 | 成长、奖励、配置查询进入 growth admin store |
| application-database.ts | 746 | 559 | BodyLog 45 个方法的完整形状进入类型端口，保留抽象方法合同 |
| postgres-database.ts | 712 | 643 | RBAC 查询交给独立 store，使用原 query 回调及事务上下文 |
| admin-api.ts | 669 | 567 | BodyLog/LLM 请求移入分域 API，保留原成员和顺序 |
| application-factory.ts | 646 | 588 | 连续的基础设施装配块移出；保留构建/失败顺序 |
| postgres-bodylog-checkin.ts | 644 | 530 | 习惯模板 CRUD 独立存储模块 |
| lighttick-v1-routes.ts | 605 | 569 | 仅拆响应投影，保留鉴权、幂等和命令处理 |

PostgresDatabase 继续使用原有 674 行的 legacy 门槛，其余七个文件均低于默认 599 行；没有新增或扩大豁免。新模块也全部通过同一个门禁。

P0 条件 schema 中“required 引用字段只在外层定义”的 15 条警告已修复：在对应条件分支补充空 properties 声明，保留外层约束；未修改接收数据集合、接口路径、错误码或写入门槛。OpenAPI 已重新生成、check 和隔离 lint。全合同警告由212降到197，错误为0。

## 验证结果

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| source 行数门禁 | **通过：667 个文件，0失败** | line-count-before/after.log |
| 全量 Node 回归 | 1500 pass / 0 fail / 0 skip | full-regression.log |
| 真实 PostgreSQL：BodyLog、小组成长、LightTick actions | 3 复合测试通过 / 0 skip | postgres-regression.log |
| Grow→Zook 来源故障恢复与门禁 | 12 pass / 0 fail / 0 skip | grow-source-recovery.log |
| 后台类型检查 | 配置的 `admin:typecheck` 通过 | admin-typecheck.log |
| 后台构建 | `admin:build` 通过 | admin-build.log |
| 公共合同生成/check及 AJV/生成一致性测试 | 通过，6项合同/生成专项测试 | contract-tests.log |
| 全合同 lint | 0 error / 197 warning | contract-lint.log |
| 61 个迁移实现的机械核对 | 方法体保留，仅调整显式依赖和缩进 | refactor-equivalence.json |
| 类型/构造/API 边界核对 | 45个数据库端口签名、10个初始化语句及顺序、后台公开成员顺序一致 | boundary-contracts.json |
| 合同语义核对 | 归一化无约束空声明后，唯一 OpenAPI 与基线完全一致 | schema-equivalence.json |
| 额外后端严格类型探针 | **非全绿**：既有诊断716→709，新增0；不作为全量typecheck通过依据 | semantic-comparison.log |

拆分中既有回归捕获了两个遗漏依赖（LightTick variantsData、邀请有效期 DAY_MS），均已修复，未跳过或放宽测试。相关 LightTick 62项、数据库/权限126项、小组109项、后台/LLM286项专项在全量测试前已通过。

Grow 本地原139项回归及两组客户端检查本轮没有重复运行：Grow 业务实现没有改变，其历史通过证据继续保留在 Grow 原报告；本轮重跑的是会经过修改后 Zook 的12项来源验收。不要把沿用结果写成本轮重跑结果。

## 剩余限制

- 197条合同历史警告仍存在，分布于其他合同及旧 LightTick 定义；没有关闭 lint 规则或删除合同来隐藏它们。
- 根后端仍没有统一配置的 typecheck 脚本。额外严格探针的709条既有诊断未全量治理；只补齐了拆分涉及的缺失类型导入，并确认没有新增诊断。后台正式配置的类型检查和构建已通过。
- C3 全图接管、接管前后回执 key 路由、原生 C4/C5 联调、真实账号/设备及生产迁移发布没有在本轮实施或验证。
- 普通连接写入、配对、v2 接管及公开消费者能力仍关闭。没有改原生端，没有 P1/P2 扩展，没有合并、推送或部署。

机器汇总见 [results.json](results.json)。原 C2 报告和失败日志作为历史基线保留，不覆盖原始证据。
