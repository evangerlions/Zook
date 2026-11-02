## Context

2026-11-02，Zook 代码基线 `13fa860`。当前 Grow 工作区有未提交功能改动，必须以原仓库当前文件核对，不能以已删除的 Zook 导入副本为真值。源码摘要和 AST 路由声明见 `current-grow-source-inventory.json`；历史导出的 511 个 HTTP 操作仅作辅助基线，不能把 AST 声明数当作已注册操作数。

旧前端共 93 个 static 文件，业务逻辑同时分布在 `index.html`、独立脚本和服务端。旧测试目录有 269 个文件（不是测试用例数）。现有 `index.html` 直接混合主题、日期计算、数据保存和页面逻辑；重构必须重新划分状态、业务规则与 API 边界，不能只把旧 DOM 操作放进 React 组件。

本轮已移除 Zook 中 Python Grow 源码副本、专用部署链与代理；原 Grow 仓库保留，服务端实际运行状态未核验。重构实现另分阶段，不把代码清理视为功能完成。

## Goals / Non-Goals

**Goals:** 保留用户可观察的现有业务功能和明确的完成/发布/版本语义；Grow 前后端分仓；Zook 作为多 App 模块化单体承载后端；可独立扩展领域、数据源与 AI 场景；复用既有 Web/API/worker，无新增服务。

**Non-Goals:** 不同轮升级 Zook 全平台架构、改其他产品合同、引入微服务/微前端/通用插件市场；不自动按用户名合并账户或把 LightTick 私人数据授权给 Grow；不将所有旧 Python 接口原样平移。

## Decisions

### 1. 前端推荐 React + TypeScript

| 维度 | React 方案 | Vue 方案 |
|---|---|---|
| 当前团队代码经验 | Zook admin 已使用 React、TypeScript、React Router，可复用维护经验 | 需要增加 Vue 的约定和维护工具 |
| 模块化实现 | 函数组件、hooks、按领域组织路由与 API | Vue 3 Composition API、SFC、Vue Router、Pinia 同样可行 |
| 与旧页面关系 | 都需要拆分旧 DOM 操作、内联事件和全局状态 | 不会因为模板形式接近 HTML 就自动保留业务语义 |
| 本次建议 | 选用 React，减少技术体系数量 | 若团队有明确 Vue 偏好，可以替换展示层而保持合同和后端设计 |

推荐 React + TypeScript + Vite + React Router，构建静态 SPA，不新增 SSR/Node 前端服务。组件库可采用与现有团队一致的 Ant Design，阅读器和移动页面使用自己的版式；Admin 的权限与会话不得随 UI 复用进入 Grow。依赖版本在实施时按兼容矩阵锁定，不在分析中随意升级全平台。

React 官方建议按组件与最小状态组织 UI，避免冗余状态；Vue 官方为完整应用推荐 Composition API/SFC，并推荐 Pinia 管理复杂共享状态。选型依据是本仓库维护成本，不声称某个框架天然更可扩展。

参考：https://react.dev/learn/thinking-in-react 、https://react.dev/learn/choosing-the-state-structure 、https://vuejs.org/guide/introduction 、https://vuejs.org/guide/scaling-up/state-management 。

建议前端结构（待实施）：

```text
/Volumes/肖豪/project/grow/
  src/
    app/                    # router、启动、会话、公开能力配置
    features/
      records/ actions/ planning/ learning/ reading/
      cognition/ knowledge/ investments/ research/ settings/
    shared/
      api/                  # HTTP envelope、401 单飞刷新、取消、requestId
      contracts/            # 固定 Zook commit 生成的类型/client；非合同源
      ui/ lib/              # 无产品权限依赖的组件和纯工具
    test/
```

每个 feature 包含 pages/components/api/hooks/types；跨 feature 只通过显式公开接口组合。先实际需要再提取共享代码，不为每个页面创建完整抽象层。路由级懒加载，编辑器/图表按需加载；布局与主题不耦合数据仓储。

状态分三类：服务器数据通过统一 query/cache 层读取（可选 TanStack Query，实施时锁定版本）；表单、弹窗、选择等本地状态在组件或 feature；过滤/分页/资源 ID 放 URL。跨页草稿与生成任务保存服务器，前端只是缓存。缓存 key 必须包含真实 appId/userId，切号时取消请求、清缓存和草稿作用域，不把整站业务塞入一个全局 store。列表和表单共用统一数据源，避免多份副本分别修改。

### 2. Zook 是多 App 框架，Grow 是独立产品模块

新增产品 namespace `grow`，实际 appId 由 app registry 管理；服务端验证 app 存在/状态、成员关系、权限与 `(appId,userId)`。共享同一 Zook 用户身份不等于跨产品数据默认互通。注册/加入策略复用 AppRegistryService，不能绕过 INVITE_ONLY、BLOCKED 或 DELETED 状态。

```text
公共平台：auth / app-registry / config / files / LLM / jobs / audit
                        ↑ 依赖稳定平台接口
产品模块：grow         lighttick         frogsleep / bodylog / ...
          ↓
路由 → 应用服务 → 领域规则 → repository 接口
                           ↓
               PostgreSQL / 文件 / 数据源 adapter
```

建议新增 `src/modules/grow/{records,actions,planning,learning,reading,cognition,knowledge,investments,research}`；路由在 `src/app/grow-*`，仓储实现在现有 PostgreSQL 基础设施，DDL 进入既有 migrations。模块在现有 application factory 组装，后台 handler 注册进现有 worker。

产品模块不能直接读写另一个产品的表或仓储。LightTick 与 Grow 的记录/行动即使名称相同，也先比较含义；纯算法或稳定基础能力确实一致时抽取中立服务，分别传 owner/context，先保持现有 LightTick 合同和行为。需要共享私人学习数据、行动或导入时使用显式授权与版本协议；不继续依赖旧 Grow Python bridge 构建新产品。

### 3. 按业务不变量保留功能

| 领域 | 需要保留的用户能力 | 核心不变量与验收 |
|---|---|---|
| 记录与复盘 | 创建、编辑、归档、历史、反思、总结 | 原文和版本保留；AI 总结不覆盖用户原文；基于版本拒绝并发覆盖 |
| 目标/行动/规划/节奏 | 目标拆解、安排、执行、延期/取消、周月复盘 | 日期/时区一致；显式完成；幂等重试；来源关联可追溯 |
| 课程与私人学习 | 调查、草稿、生成、发布、版本、阅读、笔记、作答、反馈 | 草稿与发布分离；发布版本不可变；阅读/有笔记不等于学完；正文版本与私人记录分别管理 |
| 阅读与词汇 | 采集、收藏、正文、导读、词汇和复习 | 来源与版本保留；重复导入去重；复习状态明确 |
| 认知与知识 | 行为应用、错误、预测校准、报告、图谱、搜索/时间线 | 统计公式黄金样例一致；来源/版本可追溯；搜索受 owner 限制 |
| 投资与研究 | 复盘、账户/交易/持仓、估值、规则筛选、预测、监控、数据集、策略/回测、归档/比较/导出 | 金额精度、交易日/公司行为/复权口径一致；输入与结果版本绑定；回测可复现；预览确认与审计保留 |
| 设置与管理 | 账号、配置、导入导出、备份/恢复、主题、功能开关 | 机密留服务端；数据按 App 与用户归属；能力缺失明确提示，不自动付费生成 |

每项账本登记旧页面/路径、触发动作、前后状态、字段/排序/日期/异常、新合同、用例和结果证据。对用户确认的功能取消/替代须记录原因，隐藏菜单不算迁移。页面路由、教材和非 HTTP 后台任务也进入账本。

### 4. 合同与数据边界

公共能力沿用 `/api/v1/auth/...` 等已有平台合同；新业务 canonical 路径 `/api/v1/grow/...`。namespace 不是鉴权来源，浏览器 owner/app header 不得覆盖 token/membership 归属。错误 envelope、requestId、分页、权限检查和方法兼容复用 Zook 规范，不另建前端 BFF 或 Python API。

合同唯一源为 Zook `api-contracts/openapi/grow/**`（待创建），同一切片运行 generate/check 并提交 `src/generated/openapi/**` 与客户端；前端消费固定 commit 的生成物。运行时不能读取 api-contracts 目录。新增或变化的公开接口同步 README_API；管理接口仅在 admin spec；实现概览与产品能力同步。

数据使用现有 PostgreSQL、迁移 runner 和仓储约定，新增 Grow 领域表/归属字段及复合索引，不延续旧每用户 schema 的专用 Python 适配。DDL 是加法迁移，不改写已有产品表。

写入保留幂等 key 和请求摘要，CAS/revision 明确冲突；同 key 同请求返回已接受结果，异载荷冲突。金额用精确数值/字符串合同，禁止 JavaScript float 累加账本。业务日期与时间戳区分，明确产品时区。

课程规划、正式课程与不可变正文版本、用户学习记录分别建模；大文件/数据集由既有文件服务管理，数据库只引用 fileId/摘要/版本/owner。异步任务记录稳定的 jobId、输入版本和幂等键；对外读模型可聚合，不把所有模块写入一个巨型 JSON workspace。

### 5. AI、采集与计算的扩展点

Grow 场景注册自己的 sceneKey、预算和权限；复用平台逻辑模型/provider routes，不能复制模型 key 或修改其他 App 默认模型。AI 请求状态和流式 buffer 在局部 context，不放单例。前端展示 job 状态与 SSE 增量，取消、断线恢复和重试不重复计费或正式发布。

数据源用明确 adapter：行情、文章抽取、文档解析和模型能力分别有输入/输出/超时/来源版本。优先平台已有实现；缺口在 Node 中实现或接受受控外部 API，不重新启动 Python/sidecar。AKShare 替代需先验证历史行情、复权和交易日 fixture；不能因前端能显示价格就认定研究能力已迁完。

任务复用现有 worker 的持久机制，但租约/取消/幂等/重启恢复与每 App 预算必须实测；缺失先补。回测使用有界 worker_threads 等既有进程内机制，不能占用 API 事件循环；策略只接受受控 DSL/参数，不承接任意用户代码执行。

扩展一个新模块的标准路径：新增领域规则/仓储 → canonical 合同 → App 配置和权限 → 必要任务 handler → 前端 feature 路由 → 功能与隔离验收。新数据源只换 adapter，新模型只加 scene/provider 配置，新客户端消费同一合同。暂不实现通用低代码系统或动态插件容器。

### 6. 不丢功能的重构方法

先保全当前 Grow 未提交改动和文件摘要。用合成 fixture 重现现有关键行为，拆分纯算法测试与真实 DB/浏览器测试；历史 269 个测试文件要逐项决定复用 fixture、移植或明确替代，不能整套删除后只测新首页。

每批交付完整纵向切片：合同 → 后端/仓储 → React 页面 → 真实 PostgreSQL → 浏览器。原 Grow 在原仓库供对照，新环境完全走 Zook。每个切片独立开关、唯一写入方，未迁功能列为待完成；正式切换前不让新旧系统对同一数据双写。

先做记录/身份闭环，再迁行动/规划、课程/AI/阅读、认知/知识，最后投资/研究。数据源、精度、重计算和跨 App 身份风险在第一阶段提前验证，不拖到最后才评估能否替代。

历史账号/内容/私人记录导入单独设计：本人身份确认、source instance/account/id → Grow canonical ID 映射、版本/完成时间保留（未知不补造）、预演差异报告、数量/摘要/关系核对、重复导入幂等。不能按同名账号/标题合并。生产切换时单写入与增量水位明确；回退应用或关闭 Grow 仍保留已写数据，不恢复整库或向旧服务回写新用户数据。

### 7. 静态交付与 Zook 发布规范

Grow 构建输出 dist + manifest（前端 commit、包摘要、合同兼容范围）；静态目录不含 .env、私人数据和 Python。由现有 Web 进程挂载 `/grow/`，不是复制前端源码到 Zook。构建绑定 Grow 产物和 Zook commit，拒绝可变 latest、缺包和合同不兼容；运行时不读取相邻源码仓库。产物存放/获取渠道在实施时确定。

前端路由基准与 asset base 使用 `/grow/`；缺失资源404、API不得返回 SPA HTML，精确前缀匹配并覆盖 HEAD、深链、缓存及路径安全。后台 Admin 会话/样式/入口独立，保留既有 API/handoff/SSE。

开发遵循 Zook AGENTS/CLAUDE：先 fetch、最新 main、保留已有改动；跨模块用 feature 分支，合回 main 重验。公开合同生成/校验、Node 测试、类型/构建、专用 PostgreSQL、浏览器与存量 App 回归同轮完成。main → release_dev.sh → dev → 同 SHA release_online.sh，前后端验证组合不变。

Grow 专属配额、超时、分页、AI 预算、上传/采集和 CPU 上限默认保守；开关关闭不启动 Grow 任务或要求额外秘密。混合负载实测其他 App P95、5xx、DB 等待、队列延迟，初始 P95 增幅门槛10%，在基线固化；同进程有共同故障域，不承诺绝对隔离或零停机。

## Risks / Trade-offs

- 多 App 数据边界：独立 Grow app scope，旧 LightTick 数据显式授权/导入；既有客户端合同不可改坏。
- 重构丢功能：行为账本 + 状态机/公式 fixture + 逐切片浏览器验收；历史 HTTP 数量不是完成度。
- Python 能力替代：数据源和回测先做可行性/精度验证，不用隐藏 Python 服务填缺口。
- 旧部署状态：本轮只清理源码；服务器旧实例、.deploy 状态、数据卷和回退依赖须读状态后制定退役步骤，不直接用旧组发布凭据驱动新三服务脚本。
- 大量删除的审查：清理与新功能分开提交；原源码可从 Git 历史追溯，原 Grow 工作区保留。

## Open Questions

- Grow 正式注册的 appId、加入策略、公开名称与 dev 合成账号，需要在身份切片固化；namespace 提议为 grow。
- 历史数据需要延续到哪些模块和账号，切换窗口及增量策略，需结合实际数据授权确认，不能默认导入。
- 行情/文档/采集 Node 替代与任务公平调度能力待实测，静态产物渠道及保留周期待在交付切片固化。
