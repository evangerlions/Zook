# 当前同步覆盖（2026-11-03）

本表基于当前运行时代码和固定客户端实现，区别已支持行为与待补缺口。它不是全量旧 Grow API 已迁移的声明。

| 对象 | 命令/回执 | 增量读取 | 当前客户端/新Web | 处置 |
|---|---|---|---|---|
| 独立记录 | records PUT/archive/restore，base_version、Idempotency-Key，记录/版本/回执同事务 | PostgresRecordStore写change_log，records列表分页；通用pull可读record | 原生RecordStore/Controller各自持久请求；React复用原接口 | U1已接入并验收；通用push不接受record写 |
| 执行task | task REST命令已有幂等；sync push支持start/complete/skip/defer/cancel/delete | task变更/tombstone与pull cursor | 原生AccountSyncCoordinator；Web今日使用领域REST并持久原请求 | 已修复sync回执故障/并发/错误重放，PG验证通过 |
| 基础计划/目标 | manual-plans创建/编辑/确认和现有planning生命周期 | plan/goal/task change_log及领域列表 | 双端原生已有基础链；React接手动草稿/确认、今日任务 | 本轮手动基础切片通过；暂停/复盘续排及AI会话UI仍待接入 |
| 共享行动/单次实践 | ActionService中action:key回执、revision，独立workspace | 领域action-plans读取/回执查询；不能假定通用pull含全部workspace | 原生SharedActions独立适配 | React已接日行动打勾/计时/生命周期/分页历史，PG浏览器验证同ID/CAS/丢响应重试；层级/完整编辑/复盘/来源交互仍待补，不能与task按标题合并 |
| 课程目录/正文 | learning-library旧来源exchange，source_revision/binding/consent | 当前每owner有界镜像 | 原生读取/缓存，旧来源仍权威 | Zook原生内容仓储/分页/发布仍待U3 |
| 私人学习 | 手机POST持久pending，旧来源exchangePrivate终态；privateRevision/contentVersion | GET private状态及operations | 原生PrivateLearning仍等待来源确认 | U3需迁版本/历史/回执与epoch，不能把队列接受记为保存完成 |
| 阅读位置/完成/成果 | 各领域不同事实 | 尚未统一重建完整增长投影 | App/旧Grow各有来源范围 | 保持明确完成；不以位置/计时推导学完或实践成功 |
| 本机草稿/待发请求 | 设备/文档内私有；无自动上传 | 不使用服务端增量通道 | 新Web按origin/app/user/document隔离，重载复制原槽，不覆盖另一个标签 | 已测恢复/切号/多标签隔离；全局找回已关闭标签草稿仍待后续 |

关键代码：LightTickSyncService、PostgresRecordStore、ManualPlanningService、ActionService、learning-library/private；原生QueuedLightTickAPI、AccountSyncCoordinator、RecordStore/RecordController、PrivateLearningStore/Controller。

仍须核对：全领域命令/回执的崩溃边界、跨领域事务提交与change sequence顺序、游标失效/重建、旧客户端新实体容忍、全量教材/导出/非HTTP任务及行情/回测fixture。本轮不把这些待办提前勾选。
