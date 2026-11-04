# U3 正式课程、阶段进度与既有 worker 验收

2026-11-04，本地工程切片验收通过。U3 的正式路线仓储/合同和平台任务两项更新为完成，总进度 19/27。Grow 为静态 React，唯一后端仍为 Zook；没有恢复旧 Python 或独立 Grow 服务。此结论不代表真实学习权威切换或发布放行。

## 实现与兼容

- `learning/routes` 提供周节奏/自由节奏、先修说明、阶段、连续课次蓝图、练习/自查和复盘；保存草案与明确发布分开，已发布版本不可变，已发布课次蓝图不能改写。暂停/归档保留历史。正文更新沿用稳定 lesson ID，旧正文、旧答案及其所属版本并存。
- 正式课次只通过路线命令原子关联和发布；旧通用 collection/publication 命令不能绕过正式路线。所有命令绑定 owner、资源、CAS 和原 Idempotency-Key；当前正文及课节修订通过原子读取接口核对。冲突保留本机、基线及云端副本，重试不换请求身份。
- 阶段/路线进度只计当前正文版本的明确完成，笔记、阅读位置、实践成果不计学完。旧 learning-progress 由当前正式路线投影，保留原容量、授权和舍入语义；无可信 Web 配置则为空，超容量明确要求分页，不回退历史镜像。新增课程/work 实体未进入 task-only push 或旧 pull。
- Grow 提供路线、课次、正文、版本历史、进度、资料及 AI 任务表单。iOS/Android 使用原生阅读、私人状态与阶段进度，并提供受信任的 Grow 课程编辑/发布入口；并非新增独立原生课程编辑器。入口绑定 owner/环境/单调 authority epoch 和当前路线快照，迁移冻结时清除只读旧快照，保留草稿与未决请求。
- AI、文本上传、HTTPS 资料采集复用平台模型路由/文件存储及既有 LightTick worker。PG 持久任务是派发依据，队列只含标识；扫描恢复丢派发和过期租约。45 秒租约、30 秒执行、最多三次、attempt/fence、防取消/撤权/账号删除后的迟到结果。外部 IO 不占 owner 事务；最终提交重新检查 membership、authority、路线修订及租约。
- 每 owner 每天 20 任务、2 美元等值保守预估预留，最多两个运行租约；并非提供商实际账单上限保证。模型只生成草案，路线需采用后再发布，课次需明确采用才发布，同一任务只采用一次。资料保持摘要和归属，文件限确认过的本人 UTF-8 文本，HTTPS 固定公共 DNS 并验证 TLS，拒绝内网、跳转、超限与静默换源。当前不支持 PDF/二进制解析。
- 合成迁移 format 1 的可选 routes 保留路线版本、未发布草案、课节映射及原始正文版本，历史缺失时间为 null；既有无 routes 包仍兼容。冻结/导入/核对/激活和激活前 abort 覆盖新表；激活后禁止恢复旧库覆盖。最多 6 MiB/200 课节/100 路线/1000 路线版本，超限拒绝。旧后台任务不伪作原生可执行任务导入。

## 验证结果

固定 SHA、静态文件和数据库 085–089 摘要见 [候选清单](candidate-slice.json)，浏览器逐项结果见 [结果 JSON](u3-course-browser-results.json)，原始日志摘要见 [证据摘要](u3-course-evidence-hashes.json)。前端由干净 detached worktree 构建，source_dirty=false，在 Zook 现有 `/grow/` 挂载验收。

| 验证 | 结果与范围 |
|---|---|
| 后端全量 unit | 2316 通过，1 既有条件跳过，0 失败；随后 CLI 课程计数增量 2 项通过 |
| 真实 PostgreSQL 学习/路线/worker/合成迁移 | 5 项通过、无跳过；关系与版本摘要、失败回滚、重连、丢派发恢复、过期租约、幂等采用、删除及非破坏回退约束 |
| 真实 PostgreSQL 事务回归 | owner 晚提交顺序、Today 一致快照 2 项通过、无跳过 |
| 合同与静态门禁 | generate/check、OpenAPI lint、actions/learning 专项类型、889 文件行数门禁通过；lint 有 6 个原有其他域警告，未声称全仓临时 tsc 通过 |
| Grow | 14 单测、类型、干净产物构建通过；课程资源/修订绑定与原请求恢复测试 |
| Chrome 固定产物 | 正式课程、原有学习、记录、手动计划/Today、共享行动、U2 AI/复盘/目标续排、实践七组通过；移动 375px 无横向溢出，浏览器错误检查通过 |
| iOS Simulator | 25 项学习/私人状态/缓存/共享行动/执行专项通过 |
| Android JVM | SharedActions 8、PrivateLearning 8、ReadingCache 5，共 21 项通过 |

Chrome 正式课程故事覆盖：保存成功但丢响应后 reload 原请求重放；路线 CAS 比较保留本机；手工发布及阶段进度；新版正文不继承学完、旧答案保留；上传→采集→下一课 AI 草案→明确采用；AI 路线采用仅建草案；慢任务取消不发布。切换新课程时任务组件按实际课程 ID 重建并校验请求资源，避免恢复旧草案后任务绑定另一课程。

原始日志在 `.artifacts/grow-u3-20261104/`。原生测试使用保留了用户原有 UI 改动的工作树，当前提交仅含本轮课程文件；没有把该结果当作干净商店二进制验收。Grow 原 staged binary diff 前后完全一致，既有未提交投资等修改未收进本轮提交。plan 根仓库未提交原生 gitlink。

## 可执行复验

Zook 根目录执行现有合同/专项类型/line-count/npm test 门禁。真实 PG 仅使用专用 localhost `grow_web_u1_*` 数据库：

```sh
LIGHTTICK_TEST_DATABASE_URL=<disposable-localhost-dsn> node --experimental-transform-types --test --test-concurrency=1 test/integration/lighttick-learning-routes-postgres.test.ts test/integration/lighttick-learning-work-postgres.test.ts test/integration/lighttick-native-learning-postgres.test.ts
node --experimental-transform-types scripts/lighttick-learning-migration.ts --bundle <synthetic-course-export.json>
```

第二条默认为 offline dry-run，无数据库/网络/隐式写入。合成包通过 `test/support/learning-route-migration-fixture.ts` 生成；不得换为真实账号导出。按固定产物启动 `test/support/grow-web-http.ts` 时显式启用既有 NativeLearning/Actions/V2 开关、专用 DSN 和 `GROW_WEB_TEST_AI=synthetic`，再执行：

```sh
python3 test/support/grow_web_course_acceptance.py --url http://127.0.0.1:58631 --output <local-artifacts> --account course5@example.com
```

每次完整课程故事消耗合成 owner 的预算，使用新的 fixture course0–course11 账号，不能通过清空真实预算绕过门禁。原有七组浏览器脚本见结果 JSON 与 support 目录，修改同一 owner 的组按顺序执行。

## 继续保留的门禁

U0 全行为账本/金融黄金样本/其他 App 双态混合负载 P95、U4 知识回看与全域清理导出、U5 投资研究及全模块增量迁移/补偿仍未完成。真实模型教学质量/来源质量、独立原生完整分页编辑器、真机与读屏、长期窗口、经授权真实迁移及 dev/online 发布独立待执行。本轮未读取真实私人历史，未部署或发布；不得用 19/27 放行生产。
