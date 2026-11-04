# U4 知识、回看与清理验收

2026-11-04：U4 剩余两项通过本地工程验收，总进度 **21/27**。只使用合成账号、专用 localhost 数据库与临时文件，没有读取真实历史、执行真实文件清理或发布。

知识/认知保存使用 owner 隔离的稳定 ID、CAS、原请求持久回执、不可变历史及明确归档/恢复；来源为明确 record/lesson/id/version，不用相同标题、关键词或模型建议伪造关系。认知笔记是本人解释，已确认 insight 是本人确认，不当作客观真理或能力掌握证明。归档/撤权来源的知识、历史和旧回执重新检查当前授权。

回看从同 owner 事务下的已保存记录、知识/认知、当前已发布正文、授权私人笔记/明确学完、已完成 task/action、已结束执行、自述实践反馈、复盘和确认观察聚合。模型候选、本机草稿、未决请求不入投影。每个事实有独立来源版本/信号，读原版时另列 current_version。笔记时间取真正的笔记历史，阅读位置变化不改变笔记时间和回看游标。记录按记录日、执行按业务日，其他时间按所选时区；缺历史日期返回 null。学完、行动完成、执行、反馈分别计数，不从数量推断实践成功。统计为当前确认事实投影，不是不可修改的全历史事件账本。

游标绑定 owner/筛选/时区及事实摘要。变化后 409 要求重建只读投影，保留本机基线/输入/未决请求。Grow 支持搜索、类型/日期筛选、时间线、分项统计、来源原文、知识编辑/历史/三份副本比较与导出；失效云端正文在刷新、重新联网或返回页面重查授权后收起，草稿不被删除/自动上传。iOS/Android 通过配置过且符合当前权威/owner/环境的 Web 入口接续，不宣称已有独立原生完整知识编辑器。

导出覆盖本人可读知识历史、记录及版本、历版课程/私人状态与历史、行动执行/反馈、任务/目标/复盘。关闭私人授权后不导出私人状态；来源失效的知识及相关旧版本不导出。导出 JSON 内容有 SHA256，浏览器保存前核验；不含工作密钥、平台配置、内部任务输入、原始回执。每域 5000 行、总体 8 MiB，超限明确 413，不能截断后称完整备份；分块与跨模块恢复仍属 U5。

## 删除与文件恢复

平台通用删除原先遗漏新领域表，已统一到 45 个 owner 表的 FK 安全顺序清单；专属、通用和全 App 删除共用，local adoption 映射按既有协议失效。PG schema 测试自动核对新增 owner 表必须纳入清单。平台删除取得 owner gate 后锁 membership；失败回滚同时保留领域数据、membership 及文件元数据/清理任务。其他 owner/App 不受影响。

091 新增平台文件删除 outbox：元数据删除与明确 storage_key 一起提交，既有 worker 每批 20、45 秒租约/fence、退避恢复；磁盘 IO 不占 owner 事务。仍有元数据引用的路径保留，不递归扫描或删除其他历史，不跟随父目录逃逸。迟到上传重新核验有效 membership 与元数据；删除后的文件不能确认，并再次登记清理，避免先清理后写入的残留。物理清除为 worker 恢复后的最终动作，不能承诺立即擦除或远程擦除离线设备，也不改变独立备份保留策略。

## 证据

固定代码、静态包与 085–091 摘要见 [候选清单](candidate-slice.json)。[Chrome 八组结果](u4-review-browser-results.json)和[原始日志 SHA256](u4-review-evidence-hashes.json)已提交；日志在 `.artifacts/grow-u4-20261104/`。

- 后端全量 unit：2346 通过、1 既有条件跳过、0 失败。合同 generate/check/lint、actions/learning/knowledge 专项类型、903 文件行数门禁通过；lint 的 6 个其他域既有警告保留，没有宣称全仓临时 tsc 通过。
- 真实 PG 联合 9 项通过、无跳过：知识 CAS/历史/回执失败回滚/重连，批量来源权限，历版/私人导出，学习/路线/worker/合成迁移，owner 晚提交及 Today 快照。账号删除专项还验证实际等待 owner advisory lock、整事务回滚、跨 owner 保留、outbox 与物理文件分离、丢租约重启及旧 fence 不覆盖新处理。
- 文件专项：来源平台/HTTPS 与文件清理共 7 项通过，包含删除过程中先清理再迟到写入、旧 owner 不能确认、再次登记并最终清除；路径/符号链接/目录拒绝与授权引用保留。
- HTTP 删除专项 2 项通过：通用删除也清空知识/学习；状态更新失败使领域历史和 membership 一起恢复，其他 App membership 保留。
- Grow 单测 15 项、类型及干净 detached 构建通过，source_dirty=false。Chrome 八组：回看、正式课程及新文件任务、U2、旧学习、记录、手动/Today、共享行动、实践全部通过；375px 无横向溢出。回看故事包含丢响应原样重放、三份正文、历史原文、导出、归档/恢复、分页失效重建保留草稿、真实 offline→online 后撤权收起云端与保留本机副本、跨 owner 拒绝，pageerror=0。
- iOS Simulator LearningPractice 6 项、Android JVM SharedActions 8 项通过，验证可信回看入口随冻结/切号失效。已有 U3 其他学习缓存/执行专项证据保留；真机/读屏与 Android 模拟器完整故事不由此代签。

回归曾发现 `/review` 误匹配旧 `/reviews`，以及静态深链白名单遗漏；已修正，并通过旧复盘合同/core 回归与静态路由专项。Grow 原 staged binary diff 前后相同，只提交本轮文件；原生现有未提交 UI 保留，不把这些工作树当作干净商店二进制。

## 复验与剩余范围

```sh
npm run check:api-contracts
node node_modules/typescript/bin/tsc -p tsconfig.lighttick-knowledge.json
node --experimental-transform-types --test test/unit/lighttick-knowledge.test.ts test/unit/lighttick-review.test.ts test/unit/lighttick-account-cleanup.api.test.ts test/unit/file-purge.test.ts
LIGHTTICK_TEST_DATABASE_URL=<disposable-localhost-grow_web_u1-dsn> node --experimental-transform-types --test --test-concurrency=1 test/integration/lighttick-knowledge-postgres.test.ts test/integration/lighttick-account-deletion-postgres.test.ts
```

按现有合成 HTTP fixture 与固定静态包运行 `test/support/grow_web_review_acceptance.py --url http://127.0.0.1:58631 --output <artifacts> --account course11@example.com`。只能使用 fixture 假账号；不会导入真实来源。回看使用已保存事实，不替代旧认知文章采集/投资研究的完整专题迁移；历史知识来源 ID/关系迁移及其逐行为处置仍受 U0/U5 账本门禁约束。U0 金融黄金样本与全域基线、U5 专题/全模块迁移/混合负载、真实模型、真机/读屏、长期、真实迁移和发布保持未完成。
