## Context

基线：Zook `aae6160`。Grow 包含191个 Python 文件，以及网页脚本、样式和教材。OpenAPI 导出511个 method/path 操作，AST 扫描429个装饰器声明；`api_route` 多方法、隐藏路由及框架声明使两种口径不同。清单是范围证据，不是行为兼容证明。

已完成的工作是源码纳入仓库、独立 Python 运行兼容、PostgreSQL 内容后端和本地验证库接入。它们没有实现统一账号、统一业务 API 或取消独立运行进程。上一轮dev `/grow` 的兼容代理返回过未启用503；不能将该状态当作最终产品。

用户约束：原 Grow 的历史数据及配置保留；新 Grow 与 admin-web 并行，由当前服务部署；复用 Zook 系统服务；不影响其他 API、产品和管理后台。

## Goals / Non-Goals

**Goals:**
- 同一 Zook 镜像与既有 api、worker、admin-web 进程交付两套 Web；不新增 Grow 容器、后端进程或独立部署端口。
- Grow 所有业务能力都有目标归属和验收；现有用户认证、服务、数据库和任务设施成为新版唯一权威。
- 现有 API 响应、权限、默认开关和管理页面路由兼容；新增任务有资源边界和可观测性。

**Non-Goals:**
- 本轮不导入旧 Grow/Render/Supabase/GitHub 历史数据，不修改其账号、密钥或浏览器配置，不停旧服务。
- 不合并管理员和普通用户身份，不按同名账号自动关联，不把管理权限赋给 Grow 用户。
- 不在首阶段重构后台全局主题、认证模块、既有产品路由或默认模型配置。
- 不承诺同镜像部署零重启或同进程绝对故障隔离；这些需要另外的部署能力。

## Decisions

### 1. 保留现有 Web 入口，增量承载两套前端

新增 `apps/grow-web`，使用与后台兼容的 React/TypeScript/React Router/Ant Design。沿用 `apps/admin-web/server.ts` 和既有端口；本轮不搬迁成 web-server，也不把两套应用嵌套在同一个 AdminSessionProvider 中。

```text
app-dev.youwoai.net
 ├─ /login、/config、既有路径 → 原 admin-web build
 ├─ /grow/、/grow/login、/grow/learning → grow-web build
 ├─ /grow/assets/* → Grow 独立资源目录
 └─ /api/* → 原 Zook API 代理

Zook API → 普通用户认证 → LightTick业务/系统服务 → 现有PostgreSQL
既有worker → Grow任务专属类型、并发和配额
```

Grow router basename与资源base均为 `/grow/`。请求按解析后的 pathname 匹配精确 `/grow` 或 `/grow/` 前缀，不能匹配 `/grower`。`/grow`定向到`/grow/`；只有 Grow 页面 GET/HEAD 才使用 Grow SPA fallback。缺失资源、API、非法路径和不支持方法不得返回 SPA 200。处理 URL 编码、路径穿越、缓存和 HEAD；所有现有 health/handoff 处理顺序和行为保持原状。

新增 Grow build stage，现有 Admin build命令与锁文件继续保留。初期两个前端维持各自依赖安装，不改根workspace、不重解后台依赖树；只有确有共享模块时再增量建立明确的本地包构建方式。Grow缺失/开关关闭时只影响 `/grow`，后台始终可启动。开启且产物缺失时预检拒绝候选切流。

备选：新容器不符合目标；iframe或仅提供静态旧HTML不能解决Python API依赖；移动既有入口会扩大回归面，均不采用。

### 2. 普通用户身份、产品作用域和管理员权限

新版复用 `/api/v1/auth/*` 的用户认证及现有Web刷新约定；访问令牌保存在内存，使用现有Bearer鉴权与HttpOnly刷新Cookie机制，前端刷新单飞、注销及多标签切号状态独立于Admin会话。编码前核实多app刷新Cookie的scope与并存行为，不能直接改变全平台Cookie名称、Path或SameSite来适配Grow。

Grow是现有LightTick产品Web端，沿用 `LIGHTTICK_APP_ID` 与应用成员关系。所有数据由服务端确认 `(appId,userId)`；前端请求中的owner字段不能替代鉴权。所有新查询、文件和任务均验证归属，已删除/禁用成员的异步任务在执行和提交前复查权限。管理员入口和session保持原实现。

新版登录后的用户获得新的产品数据空间。现有 `grow_h5_local` 演示账号和schema不自动映射到Zook账号；若仍需演示数据，单独导出、经双身份确认后关联。旧Grow账户、密码、邀请和恢复逻辑不搬到新版作为第二权威。

### 3. 系统服务接入清单

| 能力 | Zook目标 | 接入约束 |
|---|---|---|
| 登录/注册/找回/会话/成员状态 | 现有auth、users、app registry | 不修改现有登录响应和管理员认证 |
| 手动记录、复盘 | LightTick record/reflection | 逐字段比对日期、版本、标签和归档语义 |
| 目标、行动、日程、周月节奏 | LightTick goal/action/manual/planning/rhythm | 对齐ID、完成定义、日期与幂等；新旧含义不同则新增合同 |
| 草稿、课程规划与内容发布 | 扩展LightTick learning/planning | 数据库版本与发布日志，保留来源和显式发布流程 |
| 课程阅读、笔记、答题、学完、反馈 | 现有learning-library/private + 缺口扩展 | 打开/计时/有笔记不等于学完 |
| 文章采集/导读/词汇复习 | 新增LightTick reading子模块 | 抓取来源安全、正文清洗、持久任务与复习状态 |
| 认知副驾驶、多轮建议、反思 | 现有AI场景/提案 + 新增业务场景 | 模型输出先校验，涉及正式写入须保留原确认语义 |
| 行为应用、重复错误、认知校准 | 新增LightTick cognition子模块 | 保留事件、校准和统计公式，不等价替换成普通记录 |
| 知识索引/图谱/检索/时间线 | 新增LightTick knowledge/查询投影 | 来源版本可追溯，所有搜索限制owner范围 |
| 股票复盘、投资台账/持仓/估值/预测 | 新增LightTick investments子模块 | 金额精度、交易日期、版本、预览确认和审计专项验证 |
| 数据集、CSV、回测、策略IDE、研究归档 | investments/research + worker | 能力较大，单独验收；不得在API事件循环做CPU重计算 |
| LLM生成/流式输出/预算 | 现有LLM manager、逻辑模型与provider路由、usage/日志 | 注册专属sceneKey；保留既有模型key/provider配置，不覆盖其他产品默认模型 |
| 凭证与AI设置 | 现有服务端配置/密钥管理 | 新版使用平台模型选择；旧浏览器API key不上传、不迁入日志；BYOK另行明确合同 |
| 文件/上传/教材/导出 | 现有file service/PersistentFileStore | 路径仅服务端生成、owner授权、备份；禁止任意路径导入和任意URL抓取 |
| 后台采集/生成/重试/监控 | 现有worker、JobQueue/持久任务机制 | 验证租约、取消、幂等和重启恢复能力，缺失先补；仅接口存在不算已支持 |
| 日志/安全/审计/埋点/通知 | 现有服务及产品适配 | scene/app/user/requestId关联；正文和秘密脱敏；不自动开启发送通知 |

矩阵中的“新增/扩展”不表示已经实现。每个旧操作在ledger中记录目标、差异、fixture与验收结果；语义相同才归并，不能用同名接口推断能力等价。

Python依赖单独列账：AkShare行情、网页抽取、PDF/字体、Markdown/词汇处理、CSV及回测逻辑需要Node可运行实现或既有受控外部数据API。不能以隐藏Python子进程/sidecar恢复独立后端，也不能未经审核开放任意策略代码执行或网络访问。未找到合适实现时该能力标记阻塞，最终整体迁移不能宣布完成。

### 4. API与数据模型

新增产品接口均在 `/api/v1/lighttick/...`。先复用现有records/actions/learning等合同，缺口按独立子模块加法扩展。投资域优先 `/api/v1/lighttick/investments/...`，不创建根 `/api/investments` 平台接口。现有App字段、鉴权、错误码、默认功能开关、排序、分页和完成语义保持兼容；必要时新建子资源或显式版本协商，不改变旧客户端结果。

`/grow/api/*` 仅作为有范围和退出条件的过渡适配路径；不新增永久平行协议。不通过全局catch-all重写其他产品API。既有旧网页兼容代理只在旧模式继续工作；迁移模块使用显式入口，各模块仅一个写入方。

元数据、笔记、正文、版本、发布日志、任务和幂等记录存现有PostgreSQL仓储。较大二进制/导出/数据集使用既有文件服务，表内保存归属、版本、摘要和文件ID。新表带app_id/user_id及适合查询的复合索引。迁移均加法DDL，不重命名/删除既有字段；大索引考虑线上锁和迁移runner的事务能力。仅关闭功能或回退应用，不回滚/恢复整库，不运行down迁移破坏已写数据。

### 5. 资源隔离与“不影响”的验证定义

新增前端挂载开关和独立Web功能开关，不使用或自动翻转 `LIGHTTICK_ENABLED` 等现有总开关。复用能力仍遵循已有产品开关，缺失时报告对应能力不可用，不能为Grow静默放开App功能。前端配置仅含公开能力，秘密只在服务端。

Grow关闭：不注册/启动Grow专属任务、不探测外部数据源、不要求Grow凭证、不建立额外连接；原服务启动与响应保持基线。

Grow开启：对请求体、上传、超时、分页、AI预算、抓取并发、任务重试和CPU研究任务设专属上限。复用数据库连接池但以并发信号量限制Grow使用量；现有队列若无公平调度/配额，先在既有worker内补专属队列或handler预算，不能声称已隔离。CPU密集任务可用现有worker内有界worker_threads，不能阻塞API事件循环。

记录固定机器和负载的基线P95、错误率、连接等待与队列延迟。暂定门禁：既有产品P95增加超过10%或出现新增5xx即拒绝放量；阈值在基线采集阶段固化，同轮对照验证。相同进程/数据库仍有共同故障域，该方案降低并验证风险，不保证数学意义零影响。

### 6. 组件复用与用户状态

初期直接使用相同Ant Design版本及少量独立tokens，Grow保持阅读和移动布局。只有不依赖AdminSessionProvider、app选择器及admin API的Field/Notice等组件才抽取为共享模块；不优先重写后台组件以追求形式统一。HTTP envelope/error/requestId处理可复用机制，认证重试和错误事件按普通用户/Admin分别适配。

`GrowSessionProvider`只包裹Grow入口。加载、空态、错误、重试、401/403、慢请求、请求取消、切号、未保存草稿保护必须具备。关闭/卸载模块不得重放有副作用的提交或自动生成付费AI请求。

## Risks / Trade-offs

- [能力漏迁] → ledger覆盖全部511操作及非HTTP任务、导出和静态教材；每项标记已复用/已实现/明确替代/待处理，未完成项不能以隐藏菜单消除。
- [账号误关联] → 新用户空间与旧账号分离，历史关联需要双身份确认及专门数据迁移协议。
- [同域Cookie冲突] → 保留Admin cookie约定，验证现有普通用户刷新cookie多app并存；不扩大任何cookie作用域。
- [单进程资源争用] → 配额、预算、有界线程、限流和混合负载回归，不在API进程执行回测。
- [AI成本与信息泄漏] → 场景预算、输入校验、取消、敏感信息脱敏；不改其他产品模型路由，不导入旧密钥。
- [DDL或shared组件影响存量] → 加法迁移、固定后台依赖、旧合同快照和关闭/开启双态回归。
- [同镜像部署会重启现有容器] → 沿用现有健康检查/自动回退；发布中断窗口单列，零停机另行建设。

## Migration Plan

P0：冻结当前路由、API合同、后台构建和任务/数据基线；为ledger填候选映射、差异和测试fixture；验证旧系统只读边界。

P1：仅新增Grow构建、静态挂载与能力配置；默认关闭；不移动后台文件或改既有接口。实际部署镜像可在无Python条件下启动两套静态入口。

P2：接入Zook普通用户认证，完成登录/刷新/退出/禁用/跨账号隔离/草稿保护；新用户空数据空间。

P3：完成首页→记录保存→回读→编辑归档→重启恢复这一条原生Node闭环。实际请求不得落到Python代理。

P4：行动/目标/手动计划/节奏/复盘；逐项比对原生App语义和幂等，保留旧客户端行为。

P5：课程规划/副驾驶/发布/阅读/笔记/词汇/教材；接入平台LLM和worker并做无凭证、故障、取消、重启演练。

P6：知识/检索/认知校准/行为报告、股票/投资台账/研究/数据源/策略IDE与导出。研究功能全部过精度、性能、权限和回放验收才能完成整体迁移。

P7：ledger全部处置、无Python运行依赖、关闭/开启回归和混合负载通过后，明确切换 `/grow` 为原生模式。检查既有环境Grow组状态、journal、挂载卷和回退依赖；仅清理新部署路径中不再需要的overlay/代理/开关。旧独立服务继续保留，其数据和配置不删除。

发布仍执行 feature→main→release_dev.sh→dev验证；online仅在同一已验证main SHA且全部门禁通过时发布。逐模块失败时保持当前写入方，禁止回退到旧服务写入新版用户数据。切流后关闭Grow或恢复兼容应用版本，保留数据库和文件；若数据所有权/协议变化使旧版本无法安全访问，使用前向修复，不假定整组回退自动安全。

## Open Questions

- P0实测需固化Node数据源与重计算替代方案、各模块历史API精确语义、普通用户refreshCookie多app行为，以及队列公平调度/租约支持情况。
- dev验证需有专用Zook普通账号A/B与一次性注销账号；不得用真实用户验证删除或跨账号清理。
- 历史账号、GitHub课程、Supabase私有数据、浏览器AI key均不在本次迁移范围。未来接入需用户另行明确授权。
