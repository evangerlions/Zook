# LightTick V4.1：真实三端手动计划与严格验收断言

2026-11-08。V4.1本地切片通过，完整V4／最低系统／真机待验，基础版本HOLD、全量21/27保持。本轮无生产运行时／公开合同／DDL改动，没有执行发布或真实历史导入。

工具提交`62bd796a`在完整PG＋Redis core fixture增加可选现有Web静态代理侧车；三端路径使用同一领域服务。`--with-web`只允许专用`joint_three_surface_qa`／58671与Redis58674，拒绝误用已保存的上一轮数据库。无该参数时原负载fixture边界保持。

实际浏览器保存v1→iOS UI精确替换行动标题并保存v2→Android UI修改并审阅确认v4→原浏览器v1旧写409、输入保留、云端未改变→明确采用云端后Web确认完成同一唯一任务；未知预计投入保持null。服务中实际资源18份与固定干净Web `7a64273`逐文件HTTP SHA256一致，合同快照`5d5a13bf`。375宽页面无横向溢出。

新增`verify-lighttick-three-surface.py`核对计划／目标／草稿行动ID、严格版本、精确字段、唯一任务、409无副作用和最终同任务完成。旧iOS helper可能把新文字插入旧文字前，原断言只查版本／状态会误报通过；错误v2作为反例明确被验证器拒绝。iOS测试提交`332695b`改用公开键盘全选和完整字符串相等断言，最终全新安装后针对性UI通过；Android针对性UI通过。用户原有UI／tracked patch不变。G1有界风险227、合同生成核对及行数门禁通过。

本轮trace另有登录前401和共享行动fixture默认未启用导致`GET /action-plans` 503，不声明整应用无5xx；手动计划／任务链路无5xx。公开API拒绝／草稿保护规则未放宽，后续学习／实践须按正式开放配置继续验收。当前最低iOS17／API26未在安装的最低runtime上测试，历史debug包不冒充正式发布旧包。

完整JSON、成功与失败日志、截图、源码保护和差距：

- [plan专项报告](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/three-surface-plan-verification.md)
- [当前基础版本放行差距](../../../plan/docs/04-planning/grow-lighttick-remaining-2026-11-08/current-version-release-gaps.md)

只保存一个专题的本地工程证据，不关闭完整G1–G6。下一片V4.2独立记录及其余V4矩阵、正式候选封版、真机读屏／实际窗口和授权后的发布链路继续待验。
