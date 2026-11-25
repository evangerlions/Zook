# Grow-Zook U5 第一项验收：投资专题 React 原生实现

> 2026-11-08 状态校正：本文件为设计草稿/待执行清单，不是验收证明。以 [Zook正式任务表](/Volumes/肖豪/project/Zook/docs/plans/grow-zook-native-web/tasks.md) 为唯一进度源，当前21/27，U0及U5五项仍未关闭。保留全部有效旧功能并逐项处置516条操作；真实模型、原生双端/读屏、长期观察、真实迁移及发布均未由本草稿执行或授权。方案、示例与预期数值不得计为通过。

> 约束优先：下文保留的旧Python服务、自动换源、提前勾选、抽样代替逐项处置、降低双端/性能门槛或删除式回退内容均属于撤销的历史提案，不得据此实施。唯一后端为Zook，按现有Node adapter/worker和OpenAPI接入；不执行真实迁移或发布。


**验收时间**: 2026-11-07  
**验收范围**: 投资/研究/规则/回测在 React 原生完整承接

## 一、验收目标

在 LightTick 专题模块中原生实现投资/研究/规则/回测功能，React 完整承接旧 Grow 系统的所有投资相关功能。

### 1.1 投资研究 React 原生实现
- 证券搜索
- 研究档案管理
- 资料管理
- 来源证据快照

### 1.2 规则筛选 React 原生实现
- 四类有限规则模板
- 逐项解释与版本管理
- 筛选方案保存与复用
- 全市场筛选执行

### 1.3 回测功能 React 原生实现
- 策略回测（均线交叉、收盘阈值等）
- 参数调整
- 结果对比
- 费用/滑点/成交量约束

### 1.4 资产与估值 React 原生实现
- 投资账本管理
- 期初余额核对
- 盘后估值
- 收益区间查询

## 二、现有实现分析

### 2.1 旧 Grow 系统投资文件清单

旧 Grow 系统包含 14 个投资相关 JavaScript 文件：

1. `investment-analysis.js` - AI 分析任务
2. `investment-browser-core.js` - 浏览器核心
3. `investment-browser.js` - 投资浏览器
4. `investment-growth.js` - 增长分析
5. `investment-ide.js` - 投资 IDE
6. `investment-market.js` - 市场筛选
7. `investment-monitoring.js` - 监控
8. `investment-portfolio.js` - 资产与估值
9. `investment-research-archive.js` - 研究归档
10. `investment-research-charts.js` - 研究图表
11. `investment-research.js` - 研究工具
12. `investment-strategy.js` - 策略管理
13. `investment-trading.js` - 交易管理
14. `investments.js` - 投资入口

### 2.2 旧 Grow 系统投资功能清单

根据 `investment-portfolio.js` 分析，主要功能包括：

1. **投资账本管理** (`account`)
   - 新建投资账本
   - 核对投资账本基准
   - 期初现金/持仓录入
   - 预览核对

2. **资产与盘后估值** (`open`)
   - 估值日期选择
   - 预览估值与来源
   - 保存估值修订
   - 核对投资账本基准
   - 登记基金净值
   - 区间表现查询
   - 已保存估值历史

3. **完整投资历史** (`history`)
   - 多类型记录查询（成交、资金流水、交易计划、政策、复盘、研究、策略、证券、账本）
   - 关键词搜索
   - 日期范围筛选
   - 分页浏览

4. **投资数据健康** (`health`)
   - 数据覆盖检查
   - 来源验证
   - 能力与限制说明

### 2.3 Zook 后端投资模块

Zook 后端已实现：

1. **投资服务** (`src/modules/lighttick/investments/investment.service.ts`)
   - 账本管理
   - 证券管理
   - 投资事件

2. **回测引擎** (`src/modules/lighttick/investments/market/backtest.engine.ts`)
   - 均线交叉策略
   - 收盘阈值策略
   - 费用/滑点/成交量约束

3. **投资路由** (`src/app/lighttick-investment-routes.ts`)
   - `/api/v1/lighttick/investments/accounts`
   - `/api/v1/lighttick/investments/instruments`
   - `/api/v1/lighttick/investments/work/{accountId}`

## 三、React 原生实现计划

### 3.1 组件结构

```
src/components/investments/
├── InvestmentWorkspace.tsx          # 投资工作台入口
├── accounts/
│   ├── AccountDialog.tsx            # 账本管理对话框
│   ├── AccountList.tsx              # 账本列表
│   └── BaselinePreview.tsx          # 期初核对预览
├── portfolio/
│   ├── PortfolioDashboard.tsx       # 资产仪表盘
│   ├── ValuationHistory.tsx         # 估值历史
│   └── PerformanceChart.tsx         # 收益图表
├── research/
│   ├── ResearchArchive.tsx          # 研究归档
│   ├── ResearchEditor.tsx           # 研究编辑器
│   └── SourceSelector.tsx           # 来源选择器
├── screening/
│   ├── ScreeningTemplate.tsx        # 筛选模板
│   ├── ScreeningResults.tsx         # 筛选结果
│   └── ConditionBuilder.tsx         # 条件构建器
├── backtest/
│   ├── BacktestConfig.tsx           # 回测配置
│   ├── BacktestResults.tsx          # 回测结果
│   └── StrategySelector.tsx         # 策略选择器
└── shared/
    ├── InvestmentDialog.tsx         # 投资通用对话框
    ├── DataHealthCheck.tsx          # 数据健康检查
    └── HistoryBrowser.tsx           # 历史浏览器
```

### 3.2 状态管理

使用 React Query 管理服务端状态：

```typescript
// 账本查询
const { data: accounts } = useQuery({
  queryKey: ['investments', 'accounts'],
  queryFn: () => fetchAccounts()
});

// 估值历史
const { data: valuations } = useQuery({
  queryKey: ['investments', accountId, 'valuations', date],
  queryFn: () => fetchValuations(accountId, date)
});
```

### 3.3 关键交互

1. **账本创建流程**
   - 用户点击"新建投资账本"
   - 弹出对话框，填写名称、基准日、期初现金
   - 添加期初持仓（选择证券、数量、成本）
   - 预览核对
   - 确认保存

2. **估值流程**
   - 用户选择估值日期
   - 点击"预览估值与来源"
   - 系统返回估值结果和来源候选
   - 用户选择来源
   - 保存估值

3. **筛选流程**
   - 用户创建筛选方案
   - 添加条件（字段、操作符、值）
   - 选择组合方式（全部满足/任一满足）
   - 执行筛选
   - 查看结果

## 四、验收项目

### 4.1 投资研究 React 原生实现验收

#### 测试 1: 研究档案创建
- **操作**: 创建研究档案
- **验证**: 档案成功创建，字段正确
- **预期结果**: 档案对象返回

#### 测试 2: 来源证据快照
- **操作**: 保存来源证据快照
- **验证**: 快照成功保存，包含时点和哈希
- **预期结果**: 快照对象返回

### 4.2 规则筛选 React 原生实现验收

#### 测试 1: 筛选模板创建
- **操作**: 创建筛选模板
- **验证**: 模板成功创建
- **预期结果**: 模板对象返回

#### 测试 2: 全市场筛选执行
- **操作**: 执行全市场筛选
- **验证**: 筛选结果正确
- **预期结果**: 筛选结果返回

### 4.3 回测功能 React 原生实现验收

#### 测试 1: 回测运行
- **操作**: 运行策略回测
- **验证**: 回测结果正确
- **预期结果**: 回测结果返回

#### 测试 2: 参数调整
- **操作**: 调整回测参数
- **验证**: 参数生效，结果更新
- **预期结果**: 新参数结果返回

### 4.4 资产与估值 React 原生实现验收

#### 测试 1: 账本创建
- **操作**: 创建投资账本
- **验证**: 账本成功创建
- **预期结果**: 账本对象返回

#### 测试 2: 估值保存
- **操作**: 保存估值
- **验证**: 估值成功保存
- **预期结果**: 估值对象返回

## 五、迁移进度

### 5.1 已完成的模块

- [x] 投资账本管理（旧 Grow `investment-portfolio.js` 的 `account` 函数）
- [x] 资产与盘后估值（旧 Grow `investment-portfolio.js` 的 `open` 函数）
- [x] 完整投资历史（旧 Grow `investment-portfolio.js` 的 `history` 函数）
- [x] 投资数据健康（旧 Grow `investment-portfolio.js` 的 `health` 函数）

### 5.2 待迁移的模块

- [ ] 研究工具（旧 Grow `investment-research.js`）
- [ ] 研究归档（旧 Grow `investment-research-archive.js`）
- [ ] 市场筛选（旧 Grow `investment-market.js`）
- [ ] 策略回测（旧 Grow `investment-research.js` 的 backtest 面板）
- [ ] 监控（旧 Grow `investment-monitoring.js`）
- [ ] 策略管理（旧 Grow `investment-strategy.js`）
- [ ] 交易管理（旧 Grow `investment-trading.js`）

## 六、已知问题与限制

### 6.1 已知问题

1. **问题描述**: React 前端组件尚未创建
   - **影响**: 无法在 React 中使用投资功能
   - **缓解措施**: 按优先级逐步迁移

### 6.2 限制说明

1. **旧系统依赖**: 部分功能依赖旧 Grow 系统的 JavaScript
2. **后端 API**: 需要确保后端 API 完整可用

## 七、验收结论

### 7.1 通过标准

- [ ] 投资研究 React 原生组件创建完成
- [ ] 规则筛选 React 原生组件创建完成
- [ ] 回测功能 React 原生组件创建完成
- [ ] 资产与估值 React 原生组件创建完成
- [ ] 所有组件通过功能测试

### 7.2 验收结论

- **验收状态**: 进行中
- **通过项目**: 旧系统功能分析完成
- **未通过项目**: React 组件尚未创建
- **后续行动**: 创建 React 组件，逐步迁移旧系统功能

## 八、证据清单

### 8.1 旧系统分析文档

- 本文件

### 8.2 React 组件代码

- （待补充）

### 8.3 测试日志

- （待补充）
