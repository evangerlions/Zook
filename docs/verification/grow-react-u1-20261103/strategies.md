# 策略版本、比较、有限网格和持久回测验收（2026-11-07）

本轮有界子任务 **4/4 通过**，主任务仍 **21/27**。见[子任务](../../plans/grow-zook-native-web/strategy-subtasks.md)及[机器证据](strategies.json)。仅使用 localhost 合成账号、专库和 CSV；未读取真实历史或凭据、请求真实模型/行情、迁移真实数据或发布。Grow 仍为 React 静态前端，Zook 为唯一后端，使用现有 LightTick worker。

## 已交付

- 策略为独立 owner 资源。完整17字段的受控参数、说明与反证进入不可变版本，保留摘要、CAS、原 key/body 回执、分页历史及归档恢复。旧版本可明确采用，编辑新版本不改写原报告。归档 epoch 可阻止运行中结果在归档后恢复时迟到发布。授权导出与共用账号删除覆盖新增资源。
- 支持单次回测、2–4个精确版本同输入比较、最多双轴各4值共16组合的有限网格。第五个值保留输入且禁止提交，不静默截断。现有 threshold/ma_cross 日线多头模型，不执行用户代码，也不自动采用收益最高参数或创建交易/行动。
- 固定已存标的版本、完整日线快照/摘要、参考交易日历、区间/决策时点、成本/参数、执行声明和算法版本。未复权日线仅支持沪深股票次日开盘和T+1模型，无资产账户也可研究。行情缺失、日历缺口、未收盘或缺少停牌/涨跌停/公司行动事实，不自动补为正常；缺声明可保留不完整报告与未知指标。本人声明及历史可获知时点未独立验证。
- 既有 worker 调度，CPU 计算进入固定 Node worker_threads 模块，事务外计算。owner 活动1、UTC日20、保留100任务，30秒期限、60秒租约、最多3次尝试；原请求重放、重启恢复、取消/撤权/标的及归档屏障拒绝迟到结果。恢复碰到不支持的冻结算法版本显式失败，不用新算法重算旧任务。冻结输入上限2MiB、报告6MiB，超限明确拒绝。
- 终态报告持久保存完整参数、来源、组合、收益/成本/风险及摘要；曲线、订单、成交、执行事实和原始行情分页读取。分页游标绑定 owner/报告摘要/组合/分区。授权导出包含冻结输入及创建/取消原请求，不含秘密或内部租约/fence，超过5000项/8MiB明确失败。
- React 提供参数结构化编辑、精确旧版本核对/采用、来源范围及逐日执行条件、比较表、报告分页和历史回看。三方 CAS、丢响应后同 key/body、离线和 A/B/A 切号、过期游标重建保留草稿/未决请求。新增实体不加入旧 pull，通用 sync/push 仍为 task-only。

## 候选与重启证明

| 项目 | 固定输入 |
| --- | --- |
| Zook实现/合同 | `80b89823c4f157a2c772dc5c2a0d377316531322` |
| Zook运行代码 | `689bea57d19f76f4f1110abb11124b23836756da`（增加冻结算法屏障，合同未变） |
| 浏览器验收驱动 | `40984c0aade209e497f9753b7f7b0058bbf3459a`（仅测试和浏览器清理） |
| Grow干净产物 | `7ea12afd97bbaa51ce18ba3740f1f5aeafd9542e`，合同固定80b89823 |
| 数据库 | `grow_web_u1_20261107d1`；真实PG联合测试另用d2 |
| 迁移 | `102_lighttick_strategies.sql`，数据库记录校验和与源码相同 |

17份实际服务静态资产 SHA256 均匹配干净产物 manifest。相同 d1 库重启前后，6个策略、31个版本、16个回测（11成功/5取消）、31条定义回执、冻结来源/完整报告及5个观察资源的规范化摘要均为 `7d90be1292befa0134d7d1667daba3d0e40435b90c70308eb9ef0c6a9c051aa4`。原始日志及机器证明保留在 `.artifacts/strategies-20261107/`，关键结果/摘要已进入本报告及JSON。

## 验证结果

| 范围 | 结果 |
| --- | --- |
| 合同与类型 | generate/check/lint、后端/React类型通过；lint为6条既有警告、16项显式忽略；source line gate通过 |
| 后端全量 | 2525通过、0失败、1项既有跳过 |
| 策略领域/HTTP | 8通过；版本/CAS、精确数值、网格边界、输入/报告/分页、取消/撤权/归档和算法版本屏障 |
| 真实PG/Redis联合 | 23通过；实际CSV worker/FK、迁移重入、竞争/回滚、受限计算线程、过期租约恢复、取消屏障、完整导出/共用删除 |
| 风险基线 | 173通过；9份黄金样本、516条旧操作仍全部unreviewed，221个其他App schema及后台文档未变 |
| Grow | 39测试、类型和干净源码构建通过 |
| Chrome新三组 | 主流程、异常边界、持久报告只读重载通过；实际Chrome157，320/375/768/1024无页面横向溢出，窄屏表格局部滚动 |
| 旧故事回归 | 13组最终有通过记录；最后一轮12组直接通过，课程因合成course6日预算不足被明确拒绝，换既有合成course5完整重跑通过，未修改配额或清库 |
| 最近切片 | 研究AI、独立资料、筛选、预测监控四组最终通过，浏览器正常清理退出 |

主流程实际worker结果：单次净收益200，同输入比较 `[200,0]`，四组网格 `[200,200,0,0]`；页面和持久导出一致。取消响应丢失后重放原请求仍为取消，无迟到报告。真实409过期游标重建仍保留未保存说明；未声明执行事实明确显示“不完整”和未知指标。六份截图已逐一查看：[单次](strategies/single.png)、[网格](strategies/grid.png)、[320px编辑](strategies/strategy-320.png)、[历史重建](strategies/history.png)、[不完整报告](strategies/incomplete.png)、[375px报告](strategies/report-375.png)。

只读验收登录后 console/page/http 错误均为空；登录前 `/api/v1/auth/refresh` 的预期401单独保留，不隐去。先前重复运行资料脚本遇到非空fixture断言，保留失败记录后选满足前置条件的合成账号重跑；未清除业务数据。浏览器 Context.close 曾在路由/轮询关闭阶段挂起，驱动改为关闭页面/API和所属浏览器，最终三组及四组相关回归全部正常退出，未降低业务断言。冻结算法不匹配先有失败测试，再修复并8项通过。

## 本机入口与复验

入口：`http://127.0.0.1:58631/grow/investments`，合成账号 `course9@example.com`，密码 `Password1234`。策略 `Synthetic strategy 44dc2b` 可查看历史，报告列表有 single/compare/grid及取消任务。当前d1该owner已使用16/20日任务预算；重跑完整写入主流程与边界共需6个任务，不能在此账号当日直接重复。保留现库，完整写入复验应另建符合fixture保护命名的全新 localhost 合成专库，先通过既有HTTP测试fixture建立合成账号，再运行 `test/support/grow-strategy-seed.ts`；不得针对真实库或重置当前演示库。Redis必须沿用测试秘密管理配置，不从真实环境取密钥。

在Zook目录可执行只读/单测复验：

```sh
npm run check:api-contracts
npm run lint:api-contracts
node apps/admin-web/node_modules/typescript/bin/tsc --project tsconfig.lighttick-strategies.json
node --experimental-transform-types --test test/unit/lighttick-strategies.test.ts test/unit/lighttick-strategy-grid.test.ts test/unit/lighttick-strategies.api.test.ts
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --check
npm run check:line-count
```

真实PG专项使用专用d2，避免与运行中演示库共用；联合复验命令（使用与演示库隔离的d2）：

```sh
LIGHTTICK_TEST_DATABASE_URL=postgresql://grow_web_qa@127.0.0.1:58630/grow_web_u1_20261107d2 GROW_WEB_MODEL_TEST_REDIS_URL=redis://127.0.0.1:58632 node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --postgres
```

遵循脚本的localhost专库及运行中库保护，不打印秘密。浏览器入口为 `test/support/grow_web_strategies_acceptance.py`、`grow_web_strategy_boundaries.py`、`grow_web_strategy_read_acceptance.py`；均带localhost及精确前端版本校验，`--help`可看参数。边界脚本依赖主流程结果，边界脚本的fixture/main-result及只读脚本的main-result须为同一库/同一轮，不能混用旧结果。

## 保留修改与未关闭范围

Grow原已暂存patch逐字节相同。工作期间另有5个路径发生未暂存变化，见JSON preservation；原Python、market/model以及策略接入提交后的InvestmentPage后续改动均保留且未混入验收产物。验收使用隔离干净7ea12af，不能宣称当前整个工作树与起点逐字节不变。Zook原六份未跟踪草稿、plan双端gitlink和WORKING文件均保留，不纳入本轮提交。

11条旧策略相关操作仅附 `partial_not_parity`：新合同是受控替代范围，不认证原任意Python策略IDE、RSI/MACD/BOLL等其他模板、分钟线/多标的/基准比较或旧全生命周期等价。未执行任意策略代码。估值/绩效、账本纠错补偿、其余设置/GitHub内容/AI relay/实时源仍待实现或核对。全部516条操作、全领域合成迁移/增量/补偿、旧客户端/双端矩阵及其他App开关混合P95≤10%仍未关闭。此前合成fixture锁等待根因与pg@9审计继续在U0，本轮未复现不等于消除。

真实模型质量、供应商、真机/读屏、长期观察、真实迁移和发布保持待执行，发布HOLD。浏览器工具自动更新采用既有auto配置：Claude注册1.97版本不变但安装main补丁297f50c7；独立Codex0.11.18.2由另一checkout管理而跳过，可另行执行 `cd /Users/hao/.codex/skills/gstack && ./setup --host codex`。本轮无需该独立安装参与验收。
