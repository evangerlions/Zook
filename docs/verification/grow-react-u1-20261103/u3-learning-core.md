# U3 原生学习与合成迁移核心

本地候选，默认关闭。唯一后端 Zook；课程正文不可变，私人数据按 owner/lesson/contentVersion 隔离，笔记/位置/明确学完分开 CAS 和回执。新增 085/086 不改已应用迁移。原有 binding 或镜像保留 legacy，不自动迁移；旧终态回执和原请求 body/hash 保留。旧 draft_version 不因新正文自动重写。

迁移工具默认 offline dry-run，远程预检使用现有 adminSession，写入复用 sensitive grant lighttick.learning.migrate。固定身份映射、来源冻结证明/清单摘要和水位；冻结→导入→对账→激活，各阶段 CAS/幂等。源冻结是明确的操作员证明，工具并未控制真实旧源。激活后禁止直接恢复旧库，后续只能经审阅导出/补偿。

## 已验证

- 全量单测 2287 项：2286 通过、1 跳过；本轮随后重构为领域小文件和补充 source-binding 边界后另跑专项回归。
- 合同 generate/check 通过；新增严格 schema 的 HTTP 响应经 AJV 验证。
- learning 专项 TypeScript、actions 类型检查、源码行数门禁通过。仓库全量临时 tsc 仍有历史类型错误，未作为全量通过宣称。
- 专项含不可变发布、新版正文与旧答案、分组件 CAS、初始历史、崩溃回滚、原结果重放、私人撤权、目录游标重建、旧题目解析黄金样本。
- 真 PostgreSQL：晚提交顺序 + native learning + synthetic migration 共 3 项通过；连接重建、Unicode 来源 ID、旧内容和答案、未决请求应用/冲突、故障回滚、数量/摘要/关系/回执对账，激活后有新写入时 abort 返回 409 且新数据保留。
- 管理 HTTP：用户 token 无管理权限；管理员无 sensitive grant 不能变更；重复请求仍检查有效 owner，审计不含私人正文。
- CLI：默认无网络/无数据库；remote 默认只预检；正式命令必须显式 apply+digest+base+原 request ID；重试传输一致。

日志在 .artifacts/grow-unified-20261103/u3-*。使用合成账号、合成文本、专用 localhost grow_web_u1_20261103 数据库，没有读取真实历史或发布。

## 尚未验收

React 课程 UI 与浏览器另补证据；原生旧接口兼容不等于双端完整分页新入口。课程 AI/采集/文件 worker、全领域导出/撤权处理、U4 知识回看和 U5 投资研究仍待实现。导入上限 6 MiB/200 课节，未实现分块增量协议，不能用于超限迁移。真实模型、真机/读屏、长期窗口、真实迁移及发布独立待执行。原 14/27 大任务暂不因核心切片通过而提前勾选。
