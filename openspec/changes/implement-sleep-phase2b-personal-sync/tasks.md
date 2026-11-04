## 1. 正式合同与历史审计（2026-10-11授权实施）

- [x] 1.1 审计94602cc与既有报告/进度实现，记录游客upgrade/occurredAt增量等不满足项。
- [x] 1.2 冻结报告+report_preferences范围、epoch兼容与墓碑/回执保留期。
- [x] 1.3 定义POST幂等、GET数据库分页、detail/delete/restore/changes OpenAPI及错误schema。
- [x] 1.4 生成public contracts，同轮更新README_API、专题与能力矩阵。

## 2. 持久化与事务

- [x] 2.1 统计旧snapshot重复，相同正文建立canonical映射，不同正文保留冲突。
- [x] 2.2 实现app/user/snapshot与namespace唯一约束、revision、查询scope索引。
- [x] 2.3 增加个人sync_state/changes/idempotency及墓碑保护，内存store对应实现。
- [x] 2.4 每账号事务计数锁实现提交有序sequence，资源/事件/回执同事务。
- [x] 2.5 技术验证restore manifest或历史版本固定视图，并处理分页期间修改/删除。
- [x] 2.6 app-scoped删号清理新增表，membership重建换epoch。

## 3. Runtime与迁移

- [x] 3.1 分拆personal-sync routes/service/repository，拒绝客户端伪造owner。
- [x] 3.2 实现稳定逻辑ID/请求摘要重放、If-Match冲突与删除防复活。
- [x] 3.3 实现完整DB keyset浏览、restore固定边界和changes游标校验/过期。
- [x] 3.4 旧无epoch客户端兼容不绕过删除保护；新增独立能力/写入开关。
- [x] 3.5 扩展回填/灰度/关写入回滚方案，保留已写墓碑。

## 4. 验收

- [x] 4.1 内存+PostgreSQL并发首次写/重复重放/冲突/跨用户同ID测试。
- [x] 4.2 >500条、同时间、并发提交顺序、固定恢复视图、游标跨账号/过期测试。
- [x] 4.3 删除竞争、离线旧设备、不自动压缩墓碑及删号清理换epoch与跨app删号测试。
- [x] 4.4 API生成物/lint、迁移升级、私人同步PG专项及客户端共享JSON样本验证。
- [ ] 4.5 当前dev双设备联调与灰度门槛通过，不复用历史报告宣布上线。

本机实现完成19/20；4.5当前dev双设备/灰度未完成。本批冻结为不自动压缩版本/墓碑/回执，清理只在app-scoped删号时先换epoch、阻断无epoch旧写入；通用压缩需另立任务，不凭本机测试声明其上线。后端1350单测、33 PG（含父测试）、合同生成/lint通过；客户端共享JSON样本仅验证wire合同，不代表客户端2B恢复功能实现。证据：`docs/frogsleep-api-admin-verification-2026-10-11.md`。
