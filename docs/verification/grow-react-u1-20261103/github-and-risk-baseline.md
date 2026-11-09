# GitHub 设置与 U0 风险基线增量

2026-11-06；整体仍为 **21/27**。这是已验收的设置和基线切片，未完成全部六个大项。本轮保留原分支、旧投资/原生未提交改动，没有真实历史读取、真实 GitHub/模型调用、迁移切换、push 或发布。

## 固定实现

Zook 公共合同/实现 `ccdd537d94f23ed4a926b20de42895f29f4b3e80`，迁移 097；Grow 最终 `5265e8219a9a28c31fb2e87ef7cda66fb96d0a70`，合同固定到 ccdd537d，干净 detached 工作树构建并导入本地既有静态挂载，17 份资产，`source_dirty=false`。源码仍分属 Grow/Zook，未新增服务或 env 密钥入口。

恢复旧 `/api/account/github` GET/PUT 和 `/test` 对应的配置/检查行为，canonical 为 `/api/v1/lighttick/account/github`：仓库、分支、Token、留空沿用、保存前只读校验、不初始化仓库；扩展 CAS/原请求、账号加密、持久测试/取消和刷新恢复。GitHub 固定 API 主机、GET ref、拒绝跳转、总期限 15 秒/响应 1 MiB，错误正文不下发。只读成功不代表 Contents 写权限。独立私有 KV 主密钥＋AES-GCM 绑定 owner/修订/仓库/分支；Token 不进普通回执、任务 payload、本机存储或导出。临时测试密文在终态清除。

默认模式明确改为 Zook 原生内容。**设置与测试已承接，GitHub 内容读取、写入、发布及旧 prefix/来源映射尚未接入。** 保存不迁移或发布课程，清除不删除课程。因此旧三项操作仅附部分实现证据，仍不签署全部存储等价。

React 保存非秘密草稿、三方基线、原 key 和加盐正文摘要。丢响应先查原回执；Token 丢失时重输同一 Token、摘要相符才发送原 key/body。错误 Token 不发送，CAS 保留本机仓库/分支。留空沿用绑定原修订，不能自动借用另一个设备的新 Token。手机标题与按钮改为纵向排列。模型与 GitHub 的云端基线字段恢复前校验，损坏时保留原始本机数据并阻止提交。

## 当前验收

- GitHub 领域/HTTP 专项 7 项通过；包括无网络重放、事务外检查、加密/回执回滚、CAS、取消/fence、恢复耗尽、临时秘密清除和 AJV/鉴权。最终后端全量 2453 通过、1 既有跳过、0 失败；风险 98 项与全量有重叠，不叠加。
- PG/Redis 联合 18 项通过，覆盖学习/路线/私人输入/任务、金额/行情/研究、owner 提交顺序、一致 Today、sync 回滚/原请求、共用删除及两种秘密重连。首次命令漏传个人模型 Redis 专用参数，17 通过/1 参数门禁失败；补齐参数后 18/18，通过日志另存。
- Grow 28 项单测、类型与干净构建通过。初次新增测试未收窄请求 union 导致干净构建失败，导入器拒绝旧包；修复后重建通过。失败日志保留，未绕过产物版本门禁。
- Chrome 最终包 GitHub 主流程通过：未保存测试、丢保存响应恢复、空 Token 沿用、跨设备 CAS 保留输入、刷新后正确 Token 重输/错误 Token 阻止、运行中取消、仓库不可读不保存、明确清除。320/375/768/1024 无横向溢出；页面异常为空。首次两次脚本分别遇到“云端修订”和嵌套 status 定位歧义，改为精确语义定位后从新账号完整重跑，未重置已有账号。
- 原个人模型 Chrome 主流程重新通过，实际课程/规划 worker 仍使用个人选择；原十三组 Chrome 回归均有最终包通过证据：十二组首次通过，复用课程账号已预约 1950000 微美元预算，下一课再预约 450000 超过 2000000 日限额被拒绝；保留该拒绝，换未消耗预算的 course0 完整通过，不提高限额、不清空记录。首次完整功能回归使用 0a33d4a；随后 91f7b46 优化手机标题，5265e82 增加损坏基线校验，均保留各自结果。最终包按实际服务 SHA 核对后，重新运行主流程和旧功能回归，分别记录在相邻 JSON。
- Zook 重启后，PG 同修订配置和 Redis 私有密钥可直接完成已存仓库测试，无需重输 Token。静态挂载在进程启动时加载资产；只导入磁盘包而未重启时会继续服务旧包。验收中发现并纠正了这一版本错配，新增脚本先比对 `/grow/runtime-config.js` 实际修订，导入工具也提示重启。损坏输入专项初次还误选了旧文档的草稿槽，改为按当前 session document ID 定位后，验证刷新继承副本保留原始损坏数据且无写入。
- 合同 generate/check/lint、专项类型、行数门禁通过；lint 仍为 6 项既有警告、16 项既有忽略。

## 风险基线与复验入口

`test/fixtures/lighttick/risk-baseline.json` 固定 7 份 SHA256 样本：私人学习双正文版本/原未决命令与回执、课程草案/双发布/旧课节关联、精确金额、行情指标、内置回测和其他 App 静态合同。其他 App 固定 222 个非 LightTick 公共 schema 与后台 API 文档摘要；这只是静态基线，不是开关双态或混合 P95 通过证明。

新入口默认只读核验，打印全部 516 条来源追踪与未审完数量，不把候选映射变成等价证据：

```bash
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --check
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --unit
```

`--unit` 98 项通过，固定学习/课程输入漂移、金额/行情/回测、同步回执/身份和秘密/取消边界。PG 模式请使用单独的空合成库；既有迁移测试会建表，不与手工验收同库执行：

```bash
LIGHTTICK_TEST_DATABASE_URL=postgresql://grow_web_qa@127.0.0.1:58630/grow_web_u1_20261106_risk \
GROW_WEB_MODEL_TEST_REDIS_URL=redis://127.0.0.1:58632 \
node --experimental-transform-types scripts/verify-grow-risk-baseline.ts --postgres
```

入口统一兼容两类专项的 Redis 测试参数，18 项通过。HTTP fixture 使用 `application_name=grow-web-fixture`；入口发现同库存在该连接即拒绝 DDL/迁移重放，拒绝门禁也已验证。不要用生产连接或填真实密钥。

## 本机手工验收

入口 `http://127.0.0.1:58631/grow/settings`，合成账号 `course6@example.com` / `Password1234`。个人仓库填 `fixture/content`，分支 `main`，Token 填以 `SYNTHETIC_` 开头的假字符串；fixture 不连接 GitHub。分支含 slow 模拟慢检查，含 failed 模拟不可读取。读取现有研究可用 course10 合成账号。

```bash
python3 test/support/grow_web_github_settings_acceptance.py \
  --url http://127.0.0.1:58631 \
  --account course0@example.com \
  --output .artifacts/github-settings-recheck
```

完整 driver 要求该账号尚未设置 GitHub（修订 0）；不会为通过测试清空已有配置。日志/截图在 `.artifacts/grow-remaining-20261106/`，相邻 JSON 保存摘要、候选和结果。

## 仍未关闭

U0 全行为等价、全部故障/游标客户端场景及其他 App 运行基线；U5 GitHub 内容存储、其他旧设置、研究 AI/导读/报告、独立资料身份、规则/筛选/预测/监控/正式回测/补偿；全模块合成迁移、兼容矩阵及混合 P95。真机/读屏、真实模型、长期、真实迁移和发布继续独立待执行。没有将七份样本、单测或静态合同等同完整门禁。
