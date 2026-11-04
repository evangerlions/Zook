# U5 行情、指标与回测基础模块

2026-11-05：补充 Node 原生的日线 adapter 和内置计算依赖，**尚未接入公共 API、持久任务/行情快照、管理配置与研究页面**。不替换已验收账本候选，不更新任务勾选，仍为 21/27。该依赖切片不等于 U5 行情/研究功能完成；没有网络取数、真实凭据、私人历史或发布。

## 实现与证据

- CSV/Tushare/东方财富/腾讯明确选源；policy resolver 是服务端依赖，逐供应商独立开关与修订。policy/凭据在 IO 期间变化会拒绝结果；没有 env 入口、客户端 Token 字段或自动换源。平台 KV/版本配置、管理权限、worker 接线仍是下一切片，不宣称已有可用运营开关。
- 固定 HTTPS 主机与接口，单次请求，禁止跳转、15 秒单次超时、2 MiB 解压后响应上限、可取消。原始 JSON 数字在进入 JS 浮点前保留十进制词法；量/额换算用独立 Decimal60。Tushare 手/千元、东方财富手/元、腾讯非科创手/万元与科创股/万元分开，不从浮点回造原数。
- CSV 有明确来源/单位、BOM/中英文列、严格引号与行列容量；不静默猜源单位、价格或重复日期。仅支持已声明沪深股票/场内 ETF 候选身份，腾讯历史仅股票日线；北交所、场外基金与市场整体快照仍未接入。
- 数据集固定 source/adapter/policy、未复权口径、取得/可用时间、日期范围、日历、缺失交易日、输入摘要和限制。取完后才记 available_at；抓取的历史不倒灌为历史事前证据。不足日线、未来/未收盘当天、OHLC 不一致、单位超精度或日历冲突明确拒绝，不写零、不推断停牌。
- 2026 沪深公开节假日表有独立版本与来源。交易日不把工作日调休周末当开市日；覆盖以外、北交所和维护复核截止后都返回未知。`review_until=2026-11-27` 是应用维护期限，**不是交易所公告失效日期**。Tushare 供应商日历要求完整逐日覆盖，公开参考与供应商不一致时停止。
- MA5/MA20、最近 14 条 ATR、20 次相邻记录收益样本标准差、五条平均量比已对齐旧纯函数；不把缺失交易日当相邻日、不年化冒称波动率。
- 回测只内置 threshold/ma_cross，不接受任意代码。明确收盘信号、下一开盘执行、费用/税、滑点/tick、参与率/现金、T+1、停牌/涨跌停、公司行动、日历与分钟时间线；缺事实返回 incomplete，不能套用“默认正常”。均线比较用精确 BigInt 有理数，ISO 时间保留微秒次序，完整结果固定算法版本/规范参数/输入摘要。当前只是声明历史事实上的模拟，不把行情日线直接补成完整可执行回测数据。

专项 **47 项全部通过**：adapter/边界 11，指标 13 组旧黄金向量＋输入保护 1，回测 20 组旧执行/指标黄金向量＋参数/微秒保护和超精度处置 2。金融专项 tsc 与 929 源文件行数门禁通过。最新全量 backend unit 2420 通过、1 既有条件跳过、0 失败；金融已接线候选的 PG/Chrome 仍按原固定产物证据，不把新依赖视为浏览器交付。两份 fixture 固定输入/全结果、60 位 half-even 与旧源码摘要；仅隔离编译经过阅读的旧纯函数 AST，未导入 db/app/tenancy、Pydantic/旧服务或读取环境/账号数据，Python 不作为运行依赖。

本切片的 schema/API/客户端与持久化接线尚未交付，不能从纯 adapter 与算法测试代签真实 PG、Chrome、管理权限或真实供应商连通性；已有账本工程 12 项 PG/十组 Chrome 证据仍锚定其原候选。原生/生产门禁不变。

## 一手参考与兼容边界

- [Tushare HTTP](https://tushare.pro/document/1?doc_id=40)、[日线字段/单位与未复权说明](https://tushare.pro/document/2?doc_id=27)、[复权因子](https://tushare.pro/document/2?doc_id=28)。当前只请求未复权日线；没有自动前/后复权，因子下载/锚点应用与复权黄金向量仍待接入。
- [上海证券交易所 2026 休市安排](https://www.sse.com.cn/disclosure/dealinstruc/closed/c/c_20251222_10802510.shtml)（复核使用官方繁体镜像），[深圳证券交易所通知](https://www.szse.cn/disclosure/notice/general/t20251222_618087.html)（正文通过巨潮的深交所原公告 PDF 复核）。固定节假日范围来自两份交易所公告；原生支持范围不延伸到其他市场。
- 东方财富/腾讯属于对既有源码协议的直接 Node 迁移；本轮没有找到其公开稳定开发合同，未用社区文章代替官方保证。adapter version 固定，协议变化应显式失败，真实供应商对照仍独立待执行。没有绕过凭据/限流/失败去抓其他来源。

源码：`src/modules/lighttick/investments/market/`。复验：

```bash
node --experimental-transform-types --test test/unit/lighttick-market-adapters.test.ts test/unit/lighttick-market-indicators.test.ts test/unit/lighttick-market-backtest.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.lighttick-investments.json
npm run check:line-count
```

日志在 `.artifacts/grow-u5-20261104/market-unit-final.log`、`market-types-final.log`、`market-lines-final.log`；摘要随本页相邻 JSON 固定。后续必须完成既有 worker 接线、不可变数据快照、管理权限/秘密与配置、API 合同/React 页面及 PG/Chrome 后，才允许计入 U5 专题行为验收。
