# 原生切号与游标恢复

iOS `570494e`、Android `e77d459`。通用 sync/push 保持 task-only，未增加领域实体或修改协议。

每次同步捕获 owner，发送前、授权刷新前后及网络返回后验证该 owner。iOS 在 MainActor 上核对后同步处理队列和投影；Android Room 队列捕获稳定 owner，避免挂起的队列写入重新使用当前账号。HTTP 的首次成功响应也检查 owner，迟到成功不能跳过校验。游标更新在凭据存储内比较 owner 并保存，生产存储实例共用进程内锁，不会用旧 load 副本覆盖刚切换的账号或最新 token。

遇到 LIGHTTICK_SYNC_CURSOR_INVALID 最多从空游标重放一次，丢弃本次尚未应用的半页结果。全部分页成功后，事务替换本 owner 的只读 SyncProjection；重复页按 sequence 幂等，包含 tombstone，其他 owner 不受影响。失败保留旧投影和原游标。草稿、待发送请求、冲突队列、计时及私人学习存储不参与替换。当前服务器保留 owner change_log；此恢复属于现有完整日志重放，不宣称已经实现新的全领域快照/压缩水位协议。

测试暴露并修复 iOS 原本全局唯一的 PendingOperation.id：新增 SwiftData V3，将本地存储键改为长度分隔 owner + 原 request ID，保留独立原 requestId/body/idempotencyKey；没有修改 V1/V2 schema。真实合成 V2 磁盘库经版本迁移后原请求保持不变，没有进入备份导出 fallback。显式 owner 迁移发生相同 request ID 碰撞时拒绝，两个原 body 均保留。

## 验证

- iOS Simulator 31 项通过：PendingOperationExecutor/Store、HTTP URLProtocol、SessionLifecycle。包含 push/pull 切号、两个 owner 相同 ID、迟到 HTTP 成功、原请求丢响应重放、V2→V3 磁盘迁移、显式迁移碰撞、失效游标中途重建、重复分页和重放断线不清理。
- Android JVM 18 项通过：AccountSyncCoordinator 6、AuthorizedHttpClient 6、SessionLifecycle 6。覆盖对应切号、丢响应、任务专属队列、分页、重建和凭据边界；Room 实现经 kapt/Java/Kotlin 编译。首次增量构建使用旧 DAO 生成缓存失败，关闭 kapt 增量并 rerun-tasks 后生成了新事务方法并通过，未改依赖或绕过编译。
- 私有日志 `.artifacts/grow-unified-20261103/u0-{ios,android}-sync.log`。所有数据为测试生成，无真实历史访问。

尚未完成 U0 全项：跨进程 App/扩展并发凭据、全领域一致快照及能力协商/压缩水位、金额/交易日/回测黄金数据、其他 App 开关双态混合负载仍需证据。真机、真实长期窗口及发布未执行。
