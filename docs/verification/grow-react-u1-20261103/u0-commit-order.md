# U0 owner 提交顺序切片

先以实际 PostgreSQL 复现：记录事务分配较早 change sequence 并暂停提交，另一个同 owner 规划事务提交后被 pull 看见；此时客户端推进游标会漏掉随后提交的记录。红灯日志为 `u0-commit-order-red.log`。

修复：PostgresLightTickRepository 在 BEGIN 后、任何领域锁和写入前取得 owner advisory xact lock；请求/事务状态只存在 AsyncLocalStorage 上下文。相同 owner 嵌套复用，未声明的新 owner 拒绝；guest upgrade 预先排序取得源/目标 owner 锁。worker 直接状态写入与学习/行动/来源仓储写入也加入统一事务边界。没有增加跨 owner 全局锁。

验证：真实 PG commit-order、records、reflection、sync receipt 和 record-transfer 六项通过；另一个 owner 可在被暂停事务期间正常提交。仓储单测验证锁先于 aggregate 写入、回滚、嵌套范围及双 owner 固定顺序。同步最新 main 后全量单测 2267 通过、1 跳过；新增两项锁测试单独通过。admin 类型检查通过。共享测试库的 migration/DDL 集成测试串行运行，避免多个 runner 同时重放 DDL。

本切片不将 U0 第三项整体勾选：行情/回测黄金样本、学习未决回执和完整 bootstrap/游标失效预演继续随 U3/U5 补齐。未访问生产数据库，未迁真实用户，未发布。
