# 独立资料、版本历史与跨研究引用验收

2026-11-07。本切片只使用本机专库、合成账号/来源和确定性模型替身；保留原投资/原生未提交修改，不读取真实历史或凭据、不导入真实数据、不 push、不发布。整体任务仍为 **21/27**；完整专题、全域迁移/兼容/混合负载及外部门禁未代签。

## 固定候选

- Zook 领域/合同/迁移：`95806a0ee05163145e59de97aeac7d67ff59a8d0`，旧资料范围与覆盖截止日保留修复 `6524779eb1bd0a0d636a1b1496a6f1005389950d`；验证 driver `a5f2a5d9165e12d88a48c7be4689d9de1bb228d4`。
- Grow 最终 `0fa0ac80d3446bb94e01318802352229a7d832bc`，合同固定到 Zook 6524779e；干净 detached 工作树构建。安装后重启既有 Web，已核对实际 `/grow/runtime-config.js` SHA；迁移 099、静态 manifest 和文件摘要见相邻 JSON。
- 三个仓库沿用当前候选分支；Grow 原 staged patch 按字节核对保留，plan 原生 gitlink 与原 WORKING.md 未提交。没有 Python 服务或独立 Grow 后端。

## 行为与边界

资料有独立 owner＋ID、最多 100 个不可变版本和内容摘要；保留原文空白/换行、来源 URL、定位、可获知时间与反证。承接旧 ResearchInput 的可选所属账户/标的及 period_end；省略保留旧值，显式 null 清除。指定范围的固定版本只允许匹配研究引用；未指定归属时可跨标的/账户研究复用。资料本身不要求资产账户。URL 不自动抓取；未导入真实文件或旧私人来源。

`/api/v1/lighttick/investments/materials` 提供完整保存/读取、精确版本读取、分页目录/历史/当前入链、归档/恢复。正式变更复用 owner 事务、CAS 和持久原 key/body 回执；所有读取及错误走现有鉴权，成功响应 no-store。归档/恢复沿用同 ID 并生成版本，归档保留历史和原引用，阻止新引用及新 AI 任务/采用；不是删除。当前入链包含已归档研究，历史关系保留于研究历史，不将当前列表当作全部历史关系。

研究新增可选 material_sources（ID＋版本＋摘要），每资料 ID 至多一个版本，最多 30 项。明确选择/读取后才进入本机草稿，保存研究后才成为正式关系；改版不自动替换旧引用。旧客户端省略字段保留原引用，显式 [] 才移除。版本/摘要、所属 owner 和范围均由服务端重查；归档资料的原引用可保持不变，不能借修改研究切换为另一个归档版本。

研究 AI 复用既有 dispatcher/worker，创建时冻结所选资料原文、版本与摘要；材料改版后保持旧版本，归档后拒绝新的生成/采用，已有确认成果保留历史。仍受 18000 字节场景输入限制，超限明确拒绝，不截断。本次实际 application 装配/worker 的运行态验证通过，未请求真实模型。

授权导出在非空时添加 investments.materials，覆盖当前资料、全部版本及原请求回执，并保留研究引用与已确认 AI 成果；未保存本机草稿不进入导出。没有资料时兼容旧空包结构，超过 5000 版本/8 MiB 拒绝完整包。共用 owner/平台/全 App 删除清单覆盖新表。通用 push 保持 task-only，新实体不进入旧客户端 pull。

React 提供独立资料库、完整编辑、三方正文比较、分页历史、归档恢复、精确版本选择/移除、跨研究回看及授权读取。切号补测发现并修复每表单仅继承上一次文档的问题：现在每个标签页按环境/owner/表单记录最后槽位；多个账号/页面重载后仍恢复原正文和原 key/body，不覆盖另一标签页，也不向 B 重放 A 请求。索引仅保存槽位 ID，原数据仍按原 owner 隔离。

## 验证

- 后端最终全量 **2465 通过、1 既有跳过、0 失败**；资料/研究/AI 领域与 HTTP 共 **16 项**，风险专项 **113 项**。AJV 验证合同、未入会/撤权/跨 owner、原回执、范围/日期、旧客户端省略、游标重放和失效、未知版本/摘要以及崩溃回滚。
- 真实 PostgreSQL/Redis 联合 **20 项通过、0 跳过**；新的资料测试覆盖并发 CAS、原回执事务回滚、晚持有 owner 锁后归档提交、迟到引用拒绝、重连、历史/入链/导出和共用删除。专库 a3 与 HTTP 业务库 a1 分离，没有在活动验收库重跑整组 DDL。
- Grow **31 项通过**、类型和干净构建通过；包括新资料原请求/三方副本、旧研究 pending body 不变、版本引用及账号隔离的多次文档继承。合同 generate/check/lint 和 971 源文件行数门禁通过；lint 保留六项既有警告/16 项忽略。
- 最终 Chrome 资料主流程：丢响应/重载后同原 key/body、长正文 CAS 三方核对、两种标的研究分别固定资料 v1/v3、正文改版不替换、当前入链、归档拒新留旧、同 ID 恢复、分页历史、离线重载留草稿、全部版本/回执/关系导出且 SHA 正确；无资产账户。
- 最终 Chrome 范围/切号专项：可选范围和覆盖截止日保存/恢复；账户/标的不符分别拒绝而不产生事实，匹配后可引用；切到 B 不可见/不重放 A 请求，回到 A 后精确重试原请求。两组 pageerror=[]；主流程 320/375/768/1024 无横向溢出。截图已实际检查。
- 最终包研究 AI 三类生成/审阅/采用、所选个人模型、取消、丢响应恢复、来源/模型变更拒绝、额度拒绝后恢复通过；后端运行态另外确认独立资料冻结、改版后旧版本采用、归档拒绝新增/采用及已确认成果导出。进程重启前后资料/历史/入链的整体摘要完全一致。
- 旧十三组 Chrome 的最终结果与每组产物固定在 JSON，包含 U2、学习、记录、计划、行动、实践、回看、正式课程、投资账户/账本、行情/管理和原研究故事。

## 验收中发现的问题与保留风险

前期新合同 envelope 错用了 SUCCESS，已按既有 OK/requestId 结构修正；成功读取起初未接 no-store 路径，已改走既有研究聚合 handler，不改 599 行 v1 主路由。未入会 fixture 使用了不存在的用户而收到 401，已建立真实存在但无 membership 的合成用户验证 403。新增 Source schema 改归实际使用它的 canonical 文档，未新增 lint 警告。

最终包切换时最早两个新 driver 早于监听就绪发起登录，原失败日志保留；已增加有界 readiness/SHA 核对。另一次资料复跑使用了已被旧账户故事建立资产的合成 owner，前置条件正确拒绝，换用无账户的专用合成 owner，没有清库或放宽断言。

联合本机环境曾出现课程 file_ingest 持有 owner 锁、后续登录等待；正常退出等待未释放后终止了仅属于本轮的合成 fixture 进程，由 PG 回滚开放事务。重启后同一持久任务按原 ID、第二次尝试成功，未恢复旧库或创建替代任务。诊断时及恢复后重复课程/最终包联合故事通过，未证明最初锁等待的根因；此观察继续保留在 U0/混合负载门禁，**不能据此声称已通过其他 App 双态/P95 或全部并发验收**。临时诊断代码已删除，最终验收运行正式 fixture。原失败与恢复证据完整保留。

## 本机复验

入口 `http://127.0.0.1:58631/grow/investments`，合成账号 `course11@example.com` / `Password1234`，查看“独立合成资料…”及历史/引用；该账号没有资产账户。范围/切号专项账号 course9@example.com 有合成范围账户。fixture 不连接真实模型或行情，勿填真实秘密/私人数据。

```bash
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --check
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --unit
python3 test/support/grow_web_materials_acceptance.py \
  --url http://127.0.0.1:58631 --account course11@example.com \
  --expected-grow-revision 0fa0ac80d3446bb94e01318802352229a7d832bc \
  --output .artifacts/materials-recheck
python3 test/support/grow_web_material_scope_acceptance.py \
  --url http://127.0.0.1:58631 --account course9@example.com \
  --expected-grow-revision 0fa0ac80d3446bb94e01318802352229a7d832bc \
  --output .artifacts/material-scope-recheck
```

主流程要求无资产账户，scope 流程明确创建合成范围账户；正式课程与研究 AI 各有日预算，复验选未耗尽相应额度的合成 owner，不重置预算。日志根 `.artifacts/materials-20261107/`；PG 完整联合复验只在专用 a3 库执行。完整旧规则/筛选/预测/监控/回测、账本补偿、其余设置、全部迁移/兼容/P95 和真实模型/设备/读屏/长期/发布继续独立待执行。
