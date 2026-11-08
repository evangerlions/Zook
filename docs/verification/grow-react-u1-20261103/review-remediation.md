# Grow / Zook 审查问题收敛（2026-11-08）

本轮修复子任务6/6通过，主任务仍21/27。见[子任务](../../plans/grow-zook-native-web/review-remediation-subtasks.md)与[机器证据](review-remediation.json)。未改变旧功能保留范围，未迁移真实数据、不请求真实模型/供应商、不发布。前端仍为Grow React静态包，Zook为唯一后端；没有新增Python服务或后端进程。

## 修复范围与边界

1. 审查发现的model语法和useApi引用在本轮开始前已被后续工作树改动修正，本轮保留这些修复。移除未接线的平行数据源配置类型，原完整行情草稿校验保持不变；新增负向测试覆盖非法供应商、单位、版本和工作身份。
2. 数据源入口只通过已有session/ApiClient读取正式 `GET /api/v1/lighttick/investments/market/capabilities`。四个唯一供应商及布尔值/版本摘要按现有OpenAPI校验；关闭、启用但缺凭据、可提交任务分别呈现。不调用旧Python路径或admin端点，不静默换源、不自动创建行情任务；刷新响应序号/卸载屏障阻止旧结果恢复。
3. 设置页只显示平台开关及凭据是否齐备，不输入、读取或展示Token，不把状态读取当成实时连接测试。平台凭据继续由既有admin敏感管理维护。个人Tushare、AKShare/BaoStock、分钟行情明确尚未实现，仍需后续完整切片，不能据此签署原功能等价。
4. 原草稿100%/19of19整体验收声明撤销；方案、伪代码和预期测试数保持待执行。新Python/FastAPI/Celery服务和自动换源提案撤销，以现有Node adapter/worker及Zook合同为准。
5. 取消辅助功能20%抽验和默认废弃数量。所有516条继续逐行为实现或明确处置，均仍unreviewed；既有partial_not_parity不改为完整等价。原生iOS/Android/旧客户端矩阵不可由Chrome视口代签；其他App开关双态无新增5xx、同负载P95增幅≤10%保留，不能用绝对500ms替代。
6. 迁移草案撤去按领域删除后恢复写入的伪代码，要求owner/module、单调epoch、激活状态和新写水位校验；激活后存在新写仅能补偿或重新导出。无法证明时保留冻结；未实现全领域工具，也没有执行任何删除/迁移。

原暂存改动逐字节一致。相关未跟踪草稿经过状态/约束修正，继续保留为未提交草稿；原文及起始指纹备份在 `/tmp/grow-review-remediation-20261108`，本轮不把整批草案或旧Python功能混入提交。正式报告中的改动指纹可用于核对工作区；草稿不构成发布授权。

## 固定候选与验证

- Grow源码/干净静态产物：`8c81adc0635403a447fe9fa6de5dbac2ac9a3f26`；唯一合同仍固定 `80b89823c4f157a2c772dc5c2a0d377316531322`，没有API语义改动。
- Zook候选 `faa79cf4` 的现有运行代码（与 `689bea57` 相同业务实现）被复用；本轮Zook只新增验收驱动和文档，没有生产代码或数据库迁移变化，最高迁移仍102。
- 干净工作树类型检查、构建通过；Grow43测试全部通过。17份实际服务资产SHA256与manifest全部匹配，source_dirty=false。
- Zook合同check、风险只读核对、源码行数门禁通过；行情/adapter/admin/指标/回测与风险相关59测试全部通过。黄金摘要9份，全部516条账本未提前关闭。
- Chrome157新数据源专项通过：实际合成配置CSV/东方财富可提交、Tushare/腾讯关闭；运输层注入503、启用但缺凭据、非法响应及离线，均不改后台配置，错误清除状态并可重试；切号和320/375/768/1024宽度通过，无页面脚本异常。登录前预期401和注入503单独记录，不冒充全程无HTTP错误。
- 新产物下已有持久网格报告只读回看通过，冻结原始行情分页和窄屏局部横向滚动正常；登录后console/http/page错误为空。没有重新提交回测、消耗任务预算或改配额。
- 复用真实PG合成d1库，重启前后6策略/31版本/16回测（11成功、5取消）/31定义回执及完整来源报告和5观察资源摘要保持 `7d90be1292befa0134d7d1667daba3d0e40435b90c70308eb9ef0c6a9c051aa4`。不清库、不读取真实历史。

截图：[实际来源状态](review-remediation/capabilities.png)、[375px设置](review-remediation/capabilities-375.png)、[旧报告回看](review-remediation/report-375.png)。截图已逐张查看。完整后端2525项、PG23项、旧13组等上一轮证据仍绑定旧候选；本轮没有重跑这些完整集合，不能记作新增通过。

## 可执行复验

Grow目录：`npm run typecheck`、`npm test`、`npm run build`。用于验收的干净工作树位于 `/Volumes/肖豪/project/grow/.worktrees/grow-react-build`，固定以上Grow SHA。

Zook目录：

```sh
npm run check:api-contracts
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --check
npm run check:line-count
node --experimental-transform-types --test test/unit/lighttick-market-work.test.ts test/unit/lighttick-market-work.api.test.ts test/unit/lighttick-market-indicators.test.ts test/unit/lighttick-market-backtest.test.ts test/unit/lighttick-market-admin.api.test.ts test/unit/lighttick-market-adapters.test.ts test/unit/grow-risk-baseline.test.ts
python3 test/support/grow_web_source_capabilities_acceptance.py --url http://127.0.0.1:58631 --expected-grow-revision 8c81adc0635403a447fe9fa6de5dbac2ac9a3f26 --output .artifacts/review-remediation-20261108/replay
```

入口 `http://127.0.0.1:58631/grow/investments`，合成 `course9@example.com` / `Password1234`；点击“数据源配置”。浏览器脚本仅允许localhost，包含合成登录和只读业务检查；注入只影响测试浏览器响应，不修改供应商设置。

## 下一步

继续账本纠错/补偿及估值/绩效，随后其余设置/来源/专题逐行为、全域合成迁移与兼容/混合性能。真机/读屏、真实模型/供应商、长期观察、真实迁移与发布均待独立执行，发布保持HOLD。6/6表示审查修复范围，不能加到原27项分母或作为U0/U5关闭依据。
