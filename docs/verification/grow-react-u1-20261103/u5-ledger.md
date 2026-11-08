# U5 投资期初与账本 worker 工程切片

2026-11-04—05：U4 两项已验收，工程总表 **21/27**。本切片完成标的、不可变期初、成交/现金命令、持久终态回执、现有 worker 核算、正式流水分页与 React 核对流程。U5 整项仍未勾选；这不是完整投资专题、迁移预演或发布验收。全部为专用 localhost PostgreSQL 和合成账号，没有读取真实历史、联网行情、调用真实模型或发布。

固定后端 `4ffa54e3d2b7dbc19a9cf85de7b4300130c9cc03`，Grow `20e6cb1472b6e7a6a8a249fcff0155a22ceed88f`，静态包 source_dirty=false。完整产物、合同源、085–093 摘要及原生兼容锚点见 [候选切片](u5-ledger-candidate.json)；[十组 Chrome 结果](u5-ledger-browser-results.json)与[原始日志/截图摘要](u5-ledger-evidence-hashes.json)可核对。本轮不修改既有 U4 候选锚点。

## 已实现行为

- 标的按 owner＋市场＋规范代码稳定去重；品种身份不偷换，名称/归档 CAS。研究资料登记不要求先建资产账户；完整独立研究工作流仍待实施。
- CNY 期初账户、份额、总成本和正式事件使用 NUMERIC(28,10)。API/表单保持十进制字符串，最多 18 整数/10 小数；未知成本、费税、结算与行情不猜零。期初版本与持仓关系不可变，状态修改只改状态。尚不开放基准覆盖或纠错接口。
- 财务命令绑定 owner、账户、base_revision、原请求 key/body。HTTP 接受后没有正式财务事件；既有 `lighttick.investment.ledger` worker 取得持久租约，在 owner 事务外核算，提交再次检查 membership、账户、标的及 fence。Common operation 接受回执不改，领域工作行保存终态；同原请求重试返回同 work 的当前回执。
- 超额卖出、失权/归档或账户变化失败不写事实；取消阻止旧计算迟到提交。提交中断时账户版本、事件与终态一起回滚；2 分钟租约后有界恢复最多 3 次。按业务日/提交序号排序，分页游标绑定 owner/账户快照，失效明确重建只读页。
- 60 位 half-even 移动平均算法已对齐 11 组旧纯记账合成黄金样本。报告冻结期初版本、账户版本、算法与输入摘要；当前明确 `unpriced`，不将缺行情当作市值/精确收益。计算只使用内置算法，不执行策略代码。
- React 提供实际成交、基金确认/实际净结算、现金种类、未知费税表单，确认后提交；原输入/请求和工作 ID 按 owner 保存在本机。刷新、丢响应、离线不重建请求；冲突比较后明确采用新基线，再开始新命令。持久取消命令另有原 key/修订。
- 授权导出新增本人标的/期初/事件/领域原 key/body/终态，不含平台内部队列、lease/fence、密钥。正常读只取最新报告和计数，不读取全部报告历史；历史导出有 5000 行/8 MiB 边界，超限拒绝、不截断。51 个 LightTick owner 表共用账号/全 App 清理顺序。

## 验证

- 后端全量 unit：2373 通过、1 既有条件跳过、0 失败。金融/worker 专项 14 项通过；包含原请求绑定、计算锁外并发、终态崩溃回滚、撤权、取消、租约抢占后旧结果被拒、快照分页和授权导出。
- 真实 PostgreSQL 联合 12 项全部通过：精确金额/重连/终态崩溃、owner 晚提交、Today 一致读取、知识/私人学习/路线/worker/合成迁移、实践与共用账号删除。准备 DDL 与业务验证分阶段，测试文件顺序执行；单个故事内仍保留多连接并发和实际锁等待。
- Grow 18 项 unit、类型检查与干净构建通过。真实 Chrome 十组通过：投资期初、账本、U2、旧学习、记录、手动/Today、共享行动、实践、回看、正式课程及学习 worker。投资故事验证 28 笔成功事实、原样重试、刷新后回执恢复、未知费税/成本、极小金额、失败不入账、离线保留、游标失效与分页重建、授权导出和跨 owner 拒绝；两组投资页 375px 无横向溢出，pageerror=0。取消的财务状态机与 fence 由 HTTP/worker/PG 验证，不代称已做真机 UI 取消验收。
- OpenAPI generate/check/lint、金融专项 tsc 与 916 源文件行数门禁通过；lint 保留 6 个既有其他域警告。旧客户端 pull 未加入金融实体，通用 push 仍仅 task。本轮没有新增原生投资 UI，不重复代签原生真机/模拟器全流程。
- 原 Grow 21 个 staged 路径 binary diff 前后相同；现有未提交投资/原生 UI 保留，只提交本轮文件。源码行为账本仅给 11 项相关旧操作附加**部分实现证据**，516 项逐行为等价仍未关闭。

## 发现与保留门禁

并行 PG 测试中，一项重放既有 034 迁移 DDL，另一项进入 owner 删除，出现 `guest_identities/account_upgrades` 关系锁死锁。迁移脚本已有 session advisory lock，可串行 DDL，不能据此声称 DDL 与业务写入安全。本轮没有改写全平台迁移协议；保留失败日志，验收按“迁移准备 → 业务运行”分阶段。带在线业务的迁移启动协调仍属 U0/发布门禁，不能从顺序测试通过推断安全。

实践旧 PG 测试还在等待 record-domain 锁 hook；owner gate 先取得后，该 hook 会晚于其自身等待的释放信号，导致测试自锁。已把观测点移到事务入口，保留实际 source archive/回执/回滚/删除断言，重新联合 12 项通过；未改变产品锁顺序。

U0 未完成：逐行为等价、交易日/行情/复权/指标与回测固定样本、其他 App 关闭/开启基线、上述 DDL 协调。U5 未完成：基准预览与修订、成交纠错补偿、台账之外的规则/筛选/研究/资料/预测/监控/归档/回测、Node CSV/Tushare/东方财富/腾讯与独立开关/明确错误、全模块合成导出包的增量/对账/显式激活/补偿回退、分块导出/恢复、兼容矩阵和混合负载 P95≤10%。这些能力不得由本切片替代。

真实模型质量、真机/读屏、长期窗口、真实历史迁移、dev/online/生产发布独立待执行。本轮没有 27/27 声明或真实用户切换。

## 复验入口

从候选分支导出合同到 Grow 的 `src/shared/api/contracts.json`；在干净 detached 工作树运行 `npm run build`，只用 `scripts/import-grow-artifact.ts` 导入固定产物，不加 `--allow-dirty`。复用 `test/support/grow-web-http.ts` 的合成用户与平台 worker 替身，等待 ready 后运行：

```bash
python3 test/support/grow_web_investment_accounts_acceptance.py --url http://127.0.0.1:58631 --output .artifacts/finance-recheck/accounts --account course4@example.com
python3 test/support/grow_web_investment_ledger_acceptance.py --url http://127.0.0.1:58631 --output .artifacts/finance-recheck/ledger --account course3@example.com
```

两个 driver 强制 localhost 与 course 合成身份，不接收真实凭据。停止 fixture 后，用显式专用 `LIGHTTICK_TEST_DATABASE_URL` 执行下列范围；各项强制 localhost 合成库，不让全量 DDL 重放和业务验收同时运行。

```bash
node --experimental-transform-types --test --test-concurrency=1 \
  test/integration/lighttick-account-deletion-postgres.test.ts \
  test/integration/lighttick-investment-accounts-postgres.test.ts \
  test/integration/lighttick-investment-ledger-postgres.test.ts \
  test/integration/lighttick-knowledge-postgres.test.ts \
  test/integration/lighttick-learning-work-postgres.test.ts \
  test/integration/lighttick-learning-routes-postgres.test.ts \
  test/integration/lighttick-native-learning-postgres.test.ts \
  test/integration/lighttick-commit-order-postgres.test.ts \
  test/integration/lighttick-today-snapshot-postgres.test.ts \
  test/integration/lighttick-learning-practice-postgres.test.ts
```

全量测试、合同/类型与构建命令保留在项目 npm scripts；真实数据库与发布不在这些命令范围内。
