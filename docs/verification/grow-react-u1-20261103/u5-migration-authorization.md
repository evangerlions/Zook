# Grow-Zook U5 第二项验收：历史迁移授权与对账

> 2026-11-08 状态校正：本文件为设计草稿/待执行清单，不是验收证明。以 [Zook正式任务表](/Volumes/肖豪/project/Zook/docs/plans/grow-zook-native-web/tasks.md) 为唯一进度源，当前21/27，U0及U5五项仍未关闭。保留全部有效旧功能并逐项处置516条操作；真实模型、原生双端/读屏、长期观察、真实迁移及发布均未由本草稿执行或授权。方案、示例与预期数值不得计为通过。

> 约束优先：下文保留的旧Python服务、自动换源、提前勾选、抽样代替逐项处置、降低双端/性能门槛或删除式回退内容均属于撤销的历史提案，不得据此实施。唯一后端为Zook，按现有Node adapter/worker和OpenAPI接入；不执行真实迁移或发布。


**验收时间**: 2026-11-07  
**验收范围**: 历史迁移范围显式授权、单写切换、增量水位、数据对账、非破坏回退

## 一、验收目标

实现历史迁移的授权和对账机制，确保迁移过程安全、可控、可回退。

### 1.1 历史迁移范围显式授权
- 迁移前获得用户显式授权
- 明确迁移范围、数据数量、摘要
- 关系对账结果展示

### 1.2 单写切换机制
- 迁移开始时切换到单写模式
- 阻止并发写入
- 确保数据一致性

### 1.3 增量水位记录
- 记录迁移进度
- 支持断点续传
- 可恢复的迁移过程

### 1.4 数据对账
- 迁移完成后自动对账
- 验证数据完整性
- 对比源和目标数据

### 1.5 非破坏回退方案
- 迁移失败时能够回退
- 不丢失原始数据
- 回退后系统状态一致

## 二、迁移范围分析

### 2.1 旧 Grow 系统数据清单

旧 Grow 系统包含以下投资相关数据：

**账户与账本**:
- 投资账户 (accounts)
- 期初余额 (opening_balances)
- 持仓 (positions)

**交易与成交**:
- 成交记录 (fills)
- 资金流水 (cash_events)
- 交易计划 (trade_plans)

**研究与分析**:
- 研究档案 (research)
- AI 分析任务 (analysis_jobs)
- 复盘记录 (reviews)

**策略与规则**:
- 策略 (strategies)
- 规则模板 (screening_templates)
- 筛选结果 (screening_results)

**市场与行情**:
- 证券 (instruments)
- 市场数据 (market_data)
- 历史行情 (historical_quotes)

**估值与绩效**:
- 估值快照 (valuations)
- 绩效数据 (performance)

### 2.2 数据量估算

基于旧 Grow 系统的使用情况，估算数据量：

| 数据类型 | 估算数量 | 存储大小 |
|---------|---------|---------|
| 投资账户 | ~10 | ~10 KB |
| 成交记录 | ~1000 | ~500 KB |
| 资金流水 | ~500 | ~200 KB |
| 交易计划 | ~200 | ~100 KB |
| 研究档案 | ~500 | ~2 MB |
| AI 分析任务 | ~100 | ~500 KB |
| 复盘记录 | ~300 | ~150 KB |
| 策略 | ~50 | ~50 KB |
| 规则模板 | ~100 | ~100 KB |
| 证券 | ~5000 | ~5 MB |
| 历史行情 | ~100万 | ~500 MB |
| 估值快照 | ~1000 | ~500 KB |

**总计**: 约 510 MB

### 2.3 迁移策略

**分阶段迁移**:
1. **阶段 1**: 核心数据（账户、成交、资金流水）
2. **阶段 2**: 研究与分析数据
3. **阶段 3**: 策略与规则数据
4. **阶段 4**: 市场与行情数据
5. **阶段 5**: 估值与绩效数据

## 三、实现计划

### 3.1 迁移授权界面

**React 组件**:
```typescript
function MigrationAuthorization() {
  const [scope, setScope] = useState<MigrationScope | null>(null);
  const [authorized, setAuthorized] = useState(false);
  
  // 获取迁移范围
  useEffect(() => {
    fetchMigrationScope().then(setScope);
  }, []);
  
  // 用户授权
  const handleAuthorize = () => {
    if (confirm('确认开始迁移？迁移过程中系统将进入只读模式。')) {
      setAuthorized(true);
      startMigration();
    }
  };
  
  return (
    <div>
      <h2>历史数据迁移授权</h2>
      
      {scope && (
        <div>
          <h3>迁移范围</h3>
          <p>数据总数: {scope.total_count}</p>
          <p>预计大小: {scope.estimated_size}</p>
          
          <h4>数据摘要</h4>
          <ul>
            {scope.summary.map((item, i) => (
              <li key={i}>{item.type}: {item.count} 条</li>
            ))}
          </ul>
          
          <h4>关系对账</h4>
          <p>{scope.relationship_check}</p>
        </div>
      )}
      
      <button onClick={handleAuthorize}>
        授权开始迁移
      </button>
    </div>
  );
}
```

### 3.2 单写切换机制

**后端实现**:
```typescript
async function startMigration() {
  // 1. 切换到单写模式
  await db.query('SET TRANSACTION ISOLATION LEVEL SERIALIZABLE');
  
  // 2. 记录迁移开始
  await migrationStore.create({
    status: 'in_progress',
    started_at: new Date(),
    watermark: '0'
  });
  
  // 3. 阻止并发写入
  await enableWriteBlocking();
}

async function enableWriteBlocking() {
  // 设置全局写入阻断
  await cache.set('migration:write_blocked', 'true');
}

async function checkWriteAllowed() {
  const blocked = await cache.get('migration:write_blocked');
  if (blocked === 'true') {
    throw new Error('系统正在迁移中，暂不支持写入');
  }
}
```

### 3.3 增量水位记录

**水位记录**:
```typescript
interface MigrationWatermark {
  migration_id: string;
  phase: 'accounts' | 'fills' | 'research' | ...;
  last_id: string;
  processed_count: number;
  total_count: number;
  updated_at: Date;
}

async function updateWatermark(watermark: MigrationWatermark) {
  await migrationStore.update(watermark.migration_id, {
    phase: watermark.phase,
    last_id: watermark.last_id,
    processed_count: watermark.processed_count,
    updated_at: new Date()
  });
}

async function resumeMigration() {
  const migration = await migrationStore.getLatest();
  if (migration.status === 'in_progress') {
    // 从上次中断的地方继续
    await migratePhase(migration.phase, migration.last_id);
  }
}
```

### 3.4 数据对账

**对账逻辑**:
```typescript
async function reconcileData() {
  const sourceCount = await getSourceCount();
  const targetCount = await getTargetCount();
  
  const report: ReconciliationReport = {
    source_count: sourceCount,
    target_count: targetCount,
    match: sourceCount === targetCount,
    discrepancies: []
  };
  
  // 检查每个类型的数据
  for (const type of ['accounts', 'fills', 'research', ...]) {
    const sourceTypeCount = await getSourceCount(type);
    const targetTypeCount = await getTargetCount(type);
    
    if (sourceTypeCount !== targetTypeCount) {
      report.discrepancies.push({
        type,
        source_count: sourceTypeCount,
        target_count: targetTypeCount,
        diff: sourceTypeCount - targetTypeCount
      });
    }
  }
  
  return report;
}
```

### 3.5 非破坏回退

**回退规则（设计约束，尚未实现全领域工具）**：

- 任何回退都先冻结owner+module，锁内核验单调authority epoch、原请求、激活状态与变更水位；外部导出/计算在事务外，提交时重验，不能自动解除冻结或重新双写。
- 尚未激活时，只能在证明无后继写入且归属/来源清单完整的前提下，按确切导入批次逐对象撤销，并保留原数据、未决命令和终态回执。范围不能由粗略领域名或水位推断。
- 激活后只要存在新写入，禁止删除迁入领域或恢复旧库覆盖。使用有原请求/版本/来源的补偿命令，或重新导出最新权威包、冻结对账后显式切换；补偿本身也须保留可追溯事实。
- 不能证明状态时保持冻结并报告差异，不自动恢复写入。回退后的权威、epoch和写入入口须明确对账后显式激活。
- 合成预演须覆盖：激活前撤销、激活后有新写时拒绝破坏性回退、补偿/重新导出、晚到写拒绝、重复请求、崩溃恢复、数量/摘要/关系及草稿/未决保留。真实迁移仍未授权。

原删除全部迁入领域再解除冻结的示例已撤销；本文没有可执行的删除或发布命令。

## 四、验收项目

### 4.1 历史迁移范围显式授权验收

#### 测试 1: 迁移范围展示
- **操作**: 打开迁移授权界面
- **验证**: 显示迁移范围、数据数量、摘要
- **预期结果**: 范围信息正确展示

#### 测试 2: 用户授权
- **操作**: 点击"授权开始迁移"
- **验证**: 授权成功，迁移开始
- **预期结果**: 迁移状态更新为"进行中"

### 4.2 单写切换机制验收

#### 测试 1: 单写模式切换
- **操作**: 开始迁移
- **验证**: 系统切换到单写模式
- **预期结果**: 写入操作被阻止

#### 测试 2: 并发写入阻止
- **操作**: 迁移期间尝试写入
- **验证**: 写入被拒绝，返回错误
- **预期结果**: 写入失败，提示迁移中

### 4.3 增量水位记录验收

#### 测试 1: 水位记录更新
- **操作**: 迁移过程中检查水位
- **验证**: 水位正确更新
- **预期结果**: 水位记录反映当前进度

#### 测试 2: 断点续传
- **操作**: 中断迁移后恢复
- **验证**: 从上次中断的地方继续
- **预期结果**: 迁移继续，不重复迁移

### 4.4 数据对账验收

#### 测试 1: 自动对账
- **操作**: 迁移完成后自动对账
- **验证**: 对账报告正确生成
- **预期结果**: 数据一致性验证通过

#### 测试 2: 差异检测
- **操作**: 模拟数据差异
- **验证**: 检测到差异并报告
- **预期结果**: 差异报告正确

### 4.5 非破坏回退验收

#### 测试 1: 迁移回退
- **操作**: 触发迁移回退
- **验证**: 已迁移数据被删除
- **预期结果**: 系统恢复到迁移前状态

#### 测试 2: 数据完整性
- **操作**: 回退后检查数据
- **验证**: 原始数据完整
- **预期结果**: 数据无丢失

## 五、已知问题与限制

### 5.1 已知问题

1. **问题描述**: 历史数据量大，迁移时间长
   - **影响**: 迁移期间系统长时间不可用
   - **缓解措施**: 分阶段迁移，支持断点续传

### 5.2 限制说明

1. **单写模式**: 迁移期间系统不支持写入
2. **回退限制**: 回退后需要重新授权迁移

## 六、验收结论

### 6.1 通过标准

- [ ] 历史迁移范围显式授权测试通过
- [ ] 单写切换机制测试通过
- [ ] 增量水位记录测试通过
- [ ] 数据对账测试通过
- [ ] 非破坏回退测试通过

### 6.2 验收结论

- **验收状态**: 进行中
- **通过项目**: 迁移方案设计完成
- **未通过项目**: 迁移授权、单写切换、水位记录、对账、回退待实现
- **后续行动**: 逐步实现迁移机制

## 七、证据清单

### 7.1 迁移方案文档

- 本文件

### 7.2 迁移代码

- （待补充）

### 7.3 测试日志

- （待补充）
