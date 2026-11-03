# Today 一致读取

Today 的 profile、plans、goals、tasks、task steps 在同一个 owner 事务入口读取。owner 写锁先于领域锁；任务筛选、时区计算、排序和返回事实记录在读取事务外。HTTP 使用已经捕获的步骤，不再逐任务读取可能更晚的版本。公开响应字段和 snapshot_version 既有语义不变；它不是新增的全领域同步水位。

真实 PostgreSQL 合成用例在读取旧 plans 后暂停，同时提交“取消旧任务、替换计划、修改步骤、确认新计划”的原子续排。移除读取事务后用例失败（writer 提前提交）；恢复后通过，读到完整旧状态，下一次读取完整新状态。另一 owner 不受本 owner 门禁阻塞的验证见 u0-commit-order.md。

命令：`LIGHTTICK_TEST_DATABASE_URL=<disposable localhost grow_web_u1_ database> node --experimental-transform-types --test test/integration/lighttick-today-snapshot-postgres.test.ts`。单测 `lighttick-today.service.test.ts` 2 项通过。私有输出位于 `.artifacts/grow-unified-20261103/u0-today-{red,green}.log`，仅合成数据。

本切片不完成 U0 总项。全领域分页快照、水位/失效游标重建、原生切号途中同步、投资黄金数据及其他 App 混合负载仍需独立证据。
