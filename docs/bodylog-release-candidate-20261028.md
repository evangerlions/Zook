# BodyLog 独立发布候选（2026-10-28）

从远端 `origin/main` 的 `b91b07c80a0d2ff218e7f109b865bcd00bfd9e2e` 建立独立候选，仅移植 BodyLog `a35edc5` 的增量。原本机 main 的34个未推送提交、原工作区与客户端其他改动保持原状，不纳入候选。

适配远端新的窄数据库端口，并将鼓励实现提取为每次调用独立上下文的模块，保留原事务边界、身份/屏蔽检查、稳定ID、通知与返回值；未放宽源码行数门禁。拒绝从旧分支带入额外 LightTick 私人学习代码或文档。

## 合入前验证

- 全量单测1610项：1609通过，0失败，1条既有数据库条件跳过。
- BodyLog/Postgres-adapter专项152/152通过。
- 独立新建本机 PostgreSQL 数据库：真实HTTP、双账号、跨实例重试、重启、回滚与删除共8/8通过。
- 管理端typecheck/build通过。
- OpenAPI生成一致性和lint通过；197条既有告警未伪称已修复。
- 源码行数684文件通过；阈值/豁免不变。
- 独立iPhone QA bundle已编译，通过原生客户端代码执行验收，不替换原App或访问原App Group；真机结果另行记录。

后续按 main合入复验→origin/main固定SHA→release_dev.sh→真实dev验收执行。online放行仍须域名/签名、Watch、完整设备与观测门禁；未完成前不把 dev发布当作生产放行。
