## Context

2026-11-02，修订基线Zook `5be5175`。用户明确Grow是LightTick Web端，上一版独立Grow App/API/数据设计撤销；旧Python部署清理保留。当前原生/Grow工作树存在原改动，读取HEAD不等于已验收组合。

产品/跨端完整设计见[plan统一架构](../../../../plan/docs/04-planning/grow-lighttick-unified-architecture-2026-11-02.md)，现行PRD是产品主文档。本文约束Zook实现与交付，不重新定义另一产品。

## Goals / Non-Goals

目标：同产品同对象同规则；三端可写，由唯一服务端权威裁决；保留原生本机模式与无Web/AI基础闭环；React前端留原仓库；复用Zook既有服务；不丢原功能、版本和历史。

非目标：新增grow appId/平行API、第二套主数据双写、恢复services/grow、重建原生客户端、引入微服务或通用插件框架。Web独有复杂工具不要求首批原生全量复制UI。

## Decisions

### 1. 身份和目录

沿用现有LightTick appId与membership，Web/iOS/Android是设备会话维度。服务端以token/app membership确定owner；URL命名、clientKind和deviceId不能授权。其他Zook App仍保持隔离。

后端新增/扩展落在 `src/modules/lighttick/{records,manual,actions,learning,reading,knowledge,cognition,investments,research}` 及既有基础设施。按实际领域复用，不强行把记录、共享行动、执行task、学习路线并表。纯算法确实复用时才提取中立服务。

Grow前端推荐React+TypeScript+Vite，按feature组织；服务器数据、本地表单、URL状态分开，路由级懒加载。跨页服务器草稿有显式保存语义，本机草稿不默认上传。Zook不维护另一份前端源码。

### 2. 同步覆盖必须逐领域验证

代码事实：LightTickSyncService的push只处理task命令；OpenAPI entity enum虽包含record，并不等于运行时接受其写入。记录通过LightTickRecordService和原生持久RecordPending请求提交，PostgresRecordStore写版本和change_log。learning-library为来源镜像，privateLearning将命令置pending，exchangePrivate才处理旧来源回执。

实施前建立矩阵：每种命令的领域入口、事务/版本、幂等与终态回执、变更日志、pull读取及客户端投影。先复用既有领域API；不为统一形式绕过领域校验，不让领域队列和通用push以不同key重复执行同一意图。

### 3. 事务、增量和离线恢复

统一owner内的正式变更、version、回执和change_log需要可证明的一致性；task命令与sync操作持久化跨调用的崩溃窗口须专项验证，不能宣称当前已无风险。

pull使用owner-bound cursor与服务端顺序。分页应用到本机持久存储后才推进cursor，重放幂等；验证晚提交事务不被提前推进游标漏掉。bootstrap快照与增量水位一致。过期游标显式要求重建服务端投影，保留未决请求/草稿。删除tombstone和撤权控制旧缓存恢复，不无界扫描全历史。

现有客户端对实体/字段的兼容需fixture证明；新实体能力协商或过滤后再放量，不能给旧版本推不可解析负载。前台/联网/手动刷新和成功写入触发补齐；可选SSE只做失效通知，丢失仍用cursor恢复，不以常驻连接保证后台实时。

### 4. 冲突与对象不变量

- records/notes/answers：CAS版本冲突保留本机、基线和服务端副本，由用户确认新的修改；不能自动LWW覆盖长文本。
- tasks/actions：状态机与当前版本裁决，不用“完成永远优先”；暂停/结束约束仍生效。
- manual/planning：同goalId/planId/taskId；草案保存/AI对话不等于确认；确认核算当前约束并原子生效。
- learning：发布正文不可变；notes/answers、显式学完、阅读位置、实践完成各自独立。正文新版不覆盖旧答案；同lessonId的contentVersion与privateRevision分别校验。
- progress：设备/版本作用域；支持向后阅读，不能取max(position)推断正确位置或课程完成。
- practice：稳定来源kind/id/version；反馈不自动创建下一步，课程学完不自动完成现实实践。
- investment/research：金额精确表示，交易日/复权、数据集/参数和结果版本可复现，CPU任务不占API事件循环。

### 5. 课程与私人学习权威切换

新增Zook原生内容/私人仓储和按owner+module权威路由，不能把已有JSONB镜像表改名就当完成。课程路线、lesson、发布版本、notes版本、完成事实、旧来源映射/授权/终态回执分别保留。

规划状态 `legacy→frozen→imported→verified→zook` 带单调epoch；冻结旧新增写/后台任务，登记待决操作，按原key迁移或核对，不一边排空一边开放新写。数量/摘要/关系/样本通过后原子激活；旧bridge迟到写受屏障拒绝。

保持旧learning-library/private响应含义；Zook原生handler可直接写入并给兼容终态，新用户无需旧Grow配对或等待Python服务。旧App不会因服务清理永久卡pending；旧授权不扩大，历史源binding映射到canonical来源保持实践可追溯。旧接口退出要有版本/能力依据，不直接删LightTick公共合同。

### 6. 认证与前端交付

Web使用同LightTick身份的独立安全会话，不共享手机token、不共享Admin权限。精确复用/新增会话接口在合同设计时核实；刷新凭证不进localStorage，通过Zook受控HttpOnly等现有规范适配，不新增BFF服务。CSRF/Origin、host-only cookie、多App会话及dev/online隔离专项验证。

本机模式和云端身份分别表达，登录不自动上传。缓存作用域包含canonical environment/appId/userId；切号取消旧请求并隔离草稿/队列，不能把A的请求交给B重试。删除云端账户覆盖共同云端数据与任务；离线设备恢复连接后按协议清理，不能承诺立即远程清除本机副本。

Grow静态包带commit/digest/合同范围，既有Web挂载/grow/，前后端组合可复现；无SSR/新增服务。精确前缀、深链、HEAD、资源404、API不落SPA、路径安全、后台/handoff/SSE兼容。运行时不读取相邻源码仓库或合同源目录。

### 7. 平台扩展与开发规范

平台auth/App/config/files/LLM/logging/worker复用，LightTick内按sceneKey和handler划分新领域预算。逻辑模型身份/provider routes遵循Zook规范；请求/user/stream/job状态局部化，不存单例。

新增领域按合同→规则/仓储→必要任务→前端feature→原生适用视图→联合fixture扩展。行情/抓取/文档通过adapter；不用隐藏Python/sidecar填缺口，不执行任意策略代码。文件仅fileId/owner授权，私文不自动进入模型。

后端遵循AGENTS/CLAUDE，DDL用既有migrations与runner；OpenAPI唯一源 `api-contracts/openapi/lighttick`，同轮generate/check、客户端快照及README_API更新，运行时只用src/generated，管理API仅写admin spec。feature→main→dev→同SHA online，合同兼容范围含已发布原生版本，不能假定服务器发布会升级App二进制。

## Migration Plan

对应plan的U0–U5：基线与同步覆盖→React/记录三端闭环→基础计划/行动→学习原生权威→实践/回看→Web专题及全量门禁。风险较高的数据源、游标原子性与未决来源命令先做合成fixture。

每切片包含合同、后端、React、双端适配及真实PG/浏览器/适用原生验收。关闭Web和AI时原生基础故事仍通过。未迁功能须显式处置，历史511路由和269测试文件是核对起点，不是完成度。

## Risks / Trade-offs

账号误关联、长文本冲突覆盖、旧源迟到写、课程版本与实践引用丢失、通用push覆盖误判、游标推进漏读是关键风险。使用显式归属映射、CAS/回执/事务/增量与authority屏障逐项证明；不靠重命名或页面可见认定完成。

服务共享有资源共同故障域。Grow/学习/研究预算与其他App混合负载要验证；初始P95增幅10%门槛在基线固化，无新增5xx，开启/关闭两态回归。不承诺绝对隔离或零停机。

## Open Questions

Web受控会话现有能力、实体读取/未知类型兼容、游标过期/保留策略、任务租约公平配额、真实旧源待处理操作与授权历史范围仍待实施核验。只读代码与历史报告不替代当前生产状态检查。

### U5 版本化筛选切片（2026-11-07）

规则与模板为独立 owner 资源，规则参数、条件来源及模板固定引用均进入不可变版本。模板只通过显式核对选择规则 id/version/digest；普通编辑不改变已冻结执行，归档/停用、撤权或标的版本变化阻止未完成结果发布。新能力统一在 screening.yaml，不扩展 task-only push 或旧 pull。

显式池最多20标的；复用既有 CSV/Node 日线快照和 worker，固定完整输入、交易日历、未复权口径、可获知/决策时点、算法和结果摘要。条件采用精确有理数和三值逻辑，缺失为未知，主次排序与日期窗口可解释；四配方为有限受控函数，不执行策略代码。本人声明 ST/停牌仍标注未独立验证。不需要资产账户，不生成交易/行动，不自动调用 AI。

owner 写锁与原回执包住定义/任务变更，计算和队列提交在事务外；30秒期限/60秒租约、最多三次执行，恢复与取消使用 fence 拒绝迟到结果。导出包含完整冻结输入和创建/取消原请求，省略内部 owner/租约/fence；超出有界容量明确失败，后续分块迁移仍单列。React 表单沿用 owner/环境/文档隔离的本机草稿、原 key/body、三方 CAS，云端列表重建不覆盖草稿。模板编辑和执行组件使用不同 key，防止保存版本后的重复旧 DOM。


### U5 不可变预测、复盘与日线监控切片（2026-11-07）

预测登记原判断、完整已知基准与来源精确版本后不可改写；实际核对和复盘各自为独立持久资源。核对固定后续交易日、行情、日历、算法和本人公司行动声明，原始未复权变化与方向判定分开；无声明/缺失/冲突/未到期不作为确认命中。复盘固定成功结果和周期，以CAS保留原文/历史；校准仅按已解决事实计算，不自动产生行动或交易。没有资产账户也可研究。

日线监控仅使用明确供应商的既有快照，自动选择当前来源必须唯一；供应商缺失、歧义、未收盘、零分母明确呈现，不自动取数/换源。复用worker的恢复扫描、持久任务和owner写锁，计算外置，按配置版本/来源日去重和冷却。owner UTC40/日、保留300、活动2，30秒期限/60秒租约/3次尝试；原请求重放不能消耗尚未过期租约的下一恢复队列ID。取消/停止/撤权/资源版本变化均拒绝迟到发布，恢复归档不自动重新启用。

独立observations合同及101三表承接当前资源/不可变版本/任务；新类型不加入旧pull、task-only push不变。导出原请求和完整冻结来源有明确容量上限，不含内部租约/fence/秘密，账号清理由共用owner入口覆盖。React以环境/owner/表单隔离草稿和原请求；读取序号使快速模式切换加载新范围并丢弃旧结果，游标失效重建保留本机输入。私人HTTPS报价/凭据/成本偏离、全账户简报与完整旧行为等价继续为后续工作，不能由此有界实现代签U5。


### U5 策略版本与有界回测切片（2026-11-07）

独立owner策略保留完整参数/说明的不可变版本、摘要、CAS、原请求和archive_epoch。执行采用精确版本而非隐式最新值，固定已存未复权日线/参考日历/标的版本/决策区间/执行事实/算法；threshold与ma_cross受控函数支持单次、2–4比较或双轴最多16组。本人历史执行/复权与公司行动声明未独立验证，缺事实或日历明确incomplete，不补正常、不自动采用最高收益、不生成交易/行动。任意代码和其他旧模板未认证等价。

复用现有worker队列与owner事务入口，计算在固定Node worker_threads模块执行且在锁外，输入2MiB/输出6MiB、30秒期限/60秒租约/3次尝试；owner活动1/UTC20日/保留100。归档epoch/撤权/标的变更/取消和冻结算法版本均参与发布屏障，普通改版不篡改历史；重复请求不抢占未过期恢复租约。102迁移三表及共享删除/授权导出覆盖持久定义/版本/任务。公共投影省略内部租约及整批输入，报告曲线/订单/成交/事实/原始行情分页且游标绑定摘要。导出有5000项/8MiB显式边界；完整分块迁移另行实现。独立strategies合同不加入旧pull或task-only push。

React沿用隔离草稿和原key/body、三方CAS、版本明确采用、逐日事实、不完整报告与局部横向表格；过期分页重建保留未决输入。此切片验收4/4不改变21/27，详见策略报告；估值/纠错、全域迁移/兼容/混合性能及外部发布门禁不代签。
