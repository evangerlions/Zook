# U5 日线行情任务与不可变快照验收

2026-11-05。本轮完成行情纵向工程切片，整体仍为 **21/27**，U0 与 U5 整项不勾选。只有合成 localhost 账号、CSV 和供应商故障替身；未读取真实私人历史、连接真实供应商、迁移真实数据或发布。

## 固定候选

- Zook 行情主体 `27361fd584ee5a88d3d15d13155b5e20cba6bebf`；日期验证修复 `bf168f9a`；管理端请求修复 `e889c8e6`。公共合同固定于 `27361fd584ee5a88d3d15d13155b5e20cba6bebf`，后续修复没有修改合同。
- Grow `7c478dc1d31467c6da7a24a4cf5bed4c6a49eb54`，从干净 detached 工作树构建，manifest `source_dirty=false`；经既有脚本校验文件摘要与双方修订后只导入本地测试静态目录。
- 数据库迁移 `094_lighttick_market_work.sql`。NUMERIC(28,10) 存储价/量/额；API 十进制字符串，DATE 交易日期。元数据、逐日日线、工作终态与快照同事务提交；加入共用 owner 删除和本人导出。

## 已实现行为

React 提供实际日期、CSV 文件/粘贴、单位、来源选择和历史表格，不要求先建立资产账户。UTF-8 文件保留 BOM/CRLF，未知结果重试同 key/body；取消使用单独 CAS 原请求。成功快照不可变，显示缺失交易日、未复权口径、来源/算法/日历版本与摘要；不足指标明确显示样本不足。撤权/离线恢复重新读取，游标失效只重建云端列表，保留本机草稿和未决请求。

`/api/v1/lighttick/investments/market/...` 独立命令/回执/分页，不进入旧客户端 task 同步。原接受回执与领域 work 原子保存，重放读取同一 work 的当前终态。日期不合法返回 422；owner/resource/base_revision/原请求身份必须匹配。

现有 LightTickWorker 接入 market job，owner 两并发、UTC 日预算、公平批量恢复、120 秒租约和最多三次崩溃恢复。外部 IO、CSV 和指标在 owner 事务外，45 秒有界取消；提交重查授权、标的修订与 fence，取消/失效结果不得产生快照。批量日线单 SQL 插入，不在 owner 锁内循环网络/逐行插入。供应商故障显式终态，没有自动换源或自动无限重试。

供应商开关复用 LightTick 平台版本化配置，默认 CSV 开、远程关。Tushare 秘密复用平台 KV；管理端使用原 adminSession、敏感授权、CAS/幂等和审计，GET 只返回修订与已配置状态，配置写入及历史恢复都拒绝秘密字段。输入只留当前页内存，不写 localStorage/sessionStorage；worker、公共合同、审计和授权导出不带 token。网络三个 adapter 保持固定主机、单位、版本、超时与大小边界。

## 验证

- 后端全量 unit：**2429 通过、1 既有条件跳过、0 失败**。行情工作七项、HTTP/AJV 一项、管理授权一项与既有账本十项联合 **19 通过**；另有 adapter/指标/回测纯函数 47 项已纳入全量。
- PostgreSQL 联合 **13 项通过、0 跳过、0 失败**：市场精确存储/事务回滚/重连/租约、共享账号清理、账本、课程/学习工作、迁移、提交顺序与一致快照。真实数据库采用专用 58630，HTTP fixture 停止后顺序运行。
- 管理端 Chrome 敏感授权、丢响应同 key/body 重试、修订 CAS 与移除、无秘密存储/响应通过，JS pageerror 为零。AntD 弹窗关闭后等待不可见再重试，避免动画中的旧弹窗定位。
- Grow **21 项通过**；干净产物类型/构建、Admin 类型/构建、金融类型、合同 generate/check/lint、938 个源文件行数门禁通过。合同 lint 的 6 项旧警告未新增。
- 真实 Chrome 行情：BOM/CRLF 原文、丢响应后刷新精确原请求重试、超 JS 安全整数金额、work 身份恢复、标的 CAS/显式采用新基线、供应商 503 无换源、运行中取消无迟到快照、离线恢复、23 个快照分页及旧游标失效重建、本人原文导出与跨 owner 404、无资产账户依赖、键盘及 320/375/768/1024 宽度通过，JS pageerror 为零。修复重复 key 导致旧回执残留，保留专门回归断言。
- 旧功能 Chrome 十组全部通过：U2、私人学习、记录、计划、共享行动、实践、知识回看、正式课程/worker、投资账户、成交/现金账本。

## 复验

仅使用专用合成 localhost PG 与 `test/support/grow-web-http.ts`；等待 ready，固定前端产物后运行：

```bash
python3 test/support/grow_web_market_acceptance.py --url http://127.0.0.1:58631 --output .artifacts/market-recheck --account course6@example.com
python3 test/support/grow_web_market_admin_acceptance.py --url http://127.0.0.1:58631 --output .artifacts/market-admin-recheck
```

原测试账号存在日预算，重新跑整套应使用另一个没有资产账户的合成 course 账号；不提高生产预算绕过门禁。PG 集成测试必须先停止 HTTP fixture，再按 `--test-concurrency=1` 顺序重放，禁止 DDL 与业务测试并行。

本轮完整日志在 `.artifacts/grow-u5-market-20261105/`；随本页 JSON 固定摘要和候选。截图人工检查包括 320px 实际 viewport；Chrome 的 full-page 图在长页面/固定侧栏可有拼接重影，不据拼接图替代布局宽度和交互断言。

## 尚未完成

普通未复权日线不具备公司行动、交易状态与执行时间线，不能当作完整可执行回测数据。完整研究/规则/筛选/预测/监控/归档、复权因子与公司行动、市场整体快照、账本纠错补偿、完整回测 API/工作流继续实施。当前只给旧逐行为账本添加部分实现证据，不声明原语义和副作用全部等价。

全模块合成迁移包冻结/增量/对账/激活/补偿回退、其他 App 开关两态及混合 P95≤10%、客户端兼容矩阵仍待执行。真实供应商、真实模型、真机/读屏、长期观察、真实迁移和生产发布独立保留；本轮不代签。
