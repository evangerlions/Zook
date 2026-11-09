# LightTick基础版本：当前双端与其他App联合补证

2026-11-08。基础版本仍HOLD；完整工程仍21/27，G1–G6不代勾。本轮仅增加验收工具与证据，不改生产运行时、公开合同、DDL或发布配置，不执行真实历史导入／dev／online／商店发布。

业务代码基线 `c2488929faca229fd76c30cb79405e9e6004d70b`。正式合同生成核对通过，G1有界风险227项通过。双端测试提交iOS `ad31107`、Android `d4e2baa`只保存本轮测试；运行的业务源码还含保留的用户UI快照，逐文件和二进制摘要单列，不能以测试提交替代完整候选封版。

iOS222执行、1既有跳过、0失败；Android173通过、debug和instrumentation APK构建通过。旧合同 `155464c0ca475d40b7521ede56b5bafcc0ce5a71`实际HTTP解析新增`runtime_scope`及实际`data:null`的范围错误，不靠升级生成模型掩盖兼容问题。iOS→Android→iOS同计划v1→v2→v3、确认丢响应／强停恢复、同任务完成回读、双端本机转属丢响应与只读来源、同库进程重启保持ID／字段通过；另补iOS全新安装重新登录建草稿。

## 可复验的共享后端实验

- `scripts/lighttick-basic-joint-server.ts`使用生产application factory、完整PostgresDatabase、全部真实迁移和独立Redis；不使用其他App内存持久化。
- 数据源固定为本轮自建的`127.0.0.1:58671/joint_acceptance_qa`，Redis58672，HTTP3107；脚本拒绝其他数据库地址。文件存储亦指向新建合成目录。
- `scripts/lighttick-basic-mixed-load.py`按固定到达每操作5RPS；FrogSleep睡眠写入／状态／列表、BodyLog档案读写、OrangeWrite模型／额度，共35RPS；core开启另加Today／独立记录写入10RPS。使用与原生一致的`X-LightTick-Task-Schema: 2`。
- `scripts/lighttick-basic-joint-acceptance.py`执行off/core/core/off两组；8轮每轮10秒预热、30秒测量；每轮恢复同一个专用数据库快照并只清空独立Redis，避免初始数据和运行顺序混淆。32个客户端线程，保留每次状态、耗时、到达至完成耗时和调度延迟，200ms最大起始滞后控制。
- 同时每秒通过实际NotificationService入队并由实际队列consumer更新其他App通知状态；这是本机合成邮件元数据，不宣称真实供应商送达。core加入一个旧AI队列信封，经正式LightTickWorker延期且不计尝试次数；不宣称凭此验证了所有真实历史任务。
- 门槛保持无新增5xx、同等其他App混合负载P95增幅≤10%；额外检查全部请求200、到达控制和其他App队列继续。负载期间停止了本轮原生模拟器；不干预其他用户设备／进程。

**本机有界门禁通过：** 最终8轮共9600次计量请求全部200；其他App每操作两态各600样本，最大P95增幅+1.67%，全部≤10%；无新增5xx，固定到达控制通过。其他App共享队列完成320个合成通知元数据任务，core四轮旧AI信封均延期保留且attemptsMade=0、worker错误0。逐操作结果与每轮原始样本见下列plan证据。

## 证据和发布差距

完整JSON、每轮逐请求样本及日志摘要、双端源码／二进制固定和串行ID均保存在plan：

- [联合验收报告](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/joint-acceptance-verification.md)
- [当前基础版本放行差距](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/current-version-release-gaps.md)

仍须正式候选封版、实际旧客户端／最低系统、当前全部核心三端路径、真机／读屏／实际窗口、目标资源与真实业务矩阵及授权后的发布链路。本机35＋10RPS局部实验不代签生产容量或真实推送／模型／支付；core不运行高级生成，不消除full范围历史file_ingest锁等待根因。不开AI／不切历史数据时，真实模型与全域历史迁移不被额外变成基础版本的前置任务。

首次工具预检漏发任务schema头，被426正确拒绝；控制连接空闲复用亦已修正。中止实验保留；只用修正后的完整8轮判门禁，不挑单轮、不放宽阈值。日常目录旧17资源产物未作为本轮固定18资源候选使用，也未替用户覆盖。
