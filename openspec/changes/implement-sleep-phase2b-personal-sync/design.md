## Context

现有 POST 随机ID插入，GET 截取500条再分页；94602cc分支新增接口需对照协议审计。

## Goals / Non-Goals

**Goals:** 私有报告摘要与report_preferences可靠同步；不新建游客服务端空间，不共享原始行为。

**Non-Goals:** 不重写既有业务、群组/陌生人匹配、历史Go新增功能、自动生产发布。

## Decisions

唯一逻辑ID+正文摘要去重、If-Match revision、账号sync_epoch。新增 detail/delete/restore/changes，写入资源、提交有序sequence、事件与幂等回执同事务；restore用固定manifest或可回放版本。每账号事务计数锁保证提交顺序，不能直接以bigserial当提交位点。

规划真相源：Sleep `开发规划/小呼二期统一规划-20261008.md`；字段细则：`开发规划/Sleep二期-Zook同步合同与数据生命周期设计-20261011.md`。

## Risks / Trade-offs

旧重复报告 → 回填前统计、保留不同正文；删除压缩 → epoch失效与旧写入阻断；旧客户端 → 明确兼容路径，禁止绕过防复活。

## Migration Plan

OpenAPI→generated→migration/store/runtime→PG测试→dev→客户端接入。新增表纳入app-scoped删除；关写入回滚不丢墓碑。

## Open Questions

已冻结：不可变versions回放固定sequence边界；账号行锁持有到提交；账号历史/墓碑/回执不自动压缩，删号清除私人正文但保留最小epoch guard并永久关闭旧无epoch兼容；游标以持久化秘密签名、7天失效。详情见 `docs/public-frogsleep-personal-sync.md`。独立读/写开关缺省启用；只读回滚必须保留墓碑，不回到旧随机插入写端。

2026-10-11授权启动后端实现。94602cc的游客upgrade依赖可伪造guest_device_id、未指定kind默认sleep_invite且500条截断、无原子归属/幂等回执，不作为当前接入方案；occurredAt since不是提交位点，不能传播修改/删除。报告浏览保留recorded_at/ID降序，以固定版本视图实现数据库keyset；增量仅依据commit sequence。
