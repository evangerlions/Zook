# U4 来源与单次实践

Zook 现有 ActionService 承接实践，不新增服务。lesson/record 来源保留 kind/id/version；lesson 在原生权威下直接读取不可变发布，record 读取对应历史修订。当前版本另列 current_version，不能以新版正文替代实践原来源。旧 binding 激活后仍按原映射追溯，冻结期拒绝回退旧镜像。

React `/grow/practice` 支持来源核对、明确创建、执行/撤销、实际结果/证据/下一步、来源重读和明确审阅后续建。保存复用原请求 method/path/body/key，丢响应重载原样重试；CAS 冲突保留本机与云端。建议不创建行动，反馈不自动排程，课程学完、实践执行、应用效果分别记录。撤权隐藏来源及已经打开的后续审阅正文，但保留实践、反馈、草稿和未决请求。

iOS/Android 在 zook 权威下使用现有公开配置 grow_web_url，不依赖 legacy progress 的 web_url。冻结期不跳转、低 epoch 不覆盖新状态、缓存按 owner/环境隔离；原生链接由 React 按已授权行动/反馈定位。未配置正式地址时不猜测地址。本轮只设置合成 fixture 的回环地址。

## 证据

- 干净 Grow `d6bf677f134de8f87ab8609abca4eff4e196fb5a`，合同源 `071c0015fe4cb426285e6ab0fea5901b2ce5bf06`，source_dirty=false，14 个静态资源固定摘要；13 项前端测试、TypeScript/Vite 通过。
- Chrome + 专用 PostgreSQL：`grow_web_practice_acceptance.py` 覆盖原请求丢响应/重载、跨端反馈 CAS、事实独立、课程改版原版来源、公开配置链接直达反馈、明确续建、撤权、375px，pageerror=0。最新输出 `u4-practice-clean-final/result.json` passed=true。
- 学习改版回归 `u4-learning-clean-fixed/result.json` passed=true。首次重跑发现刷新未完成时能点击旧目录；阻止刷新期间打开并拒绝迟到目录响应后通过，不删除旧草稿。
- U2 Chrome 回归 `u4-u2-clean-regression/result.json` 通过。此前 U1 records/manual/Today/actions 的固定产物浏览器故事均有逐项通过证据。
- 后端全量 2293 项：2292 通过、1 跳过、0 失败；领域类型、合同 generate/check、行数门禁通过。真实 PG 的学习/迁移、晚提交顺序、Today 一致读取另见对应报告。学习迁移含新正文与旧答案、未决命令终态、回滚、重连、数量/摘要/关系与激活后禁止覆盖回退。
- 可信 Web 地址后的双端学习/实践/缓存专项 iOS 22、Android 20 通过（Simulator/JVM）。后续 U0 同步存储修复独立留证，不代替真机 UI。

本项验收只覆盖 U4 第一项“稳定来源与实践/反馈/下一步”。正式课程路线/阶段、双端完整新课程发布、AI/文件/采集 worker、知识/认知/搜索/时间线/成长投影、全领域导出和清理、投资/研究及分块增量迁移仍未完成。其他 App 开关两态混合负载 P95、真实模型、真机/读屏、长期观察、真实迁移和发布均未代签。

仅使用合成账号及正文、localhost 数据库；没有读取真实私人历史或执行 dev/online 发布。
