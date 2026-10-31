# Zook P0 v2 合同与内部运行时实施记录

日期：2026-10-20。基线：同步后的 `origin/main` / `53cf8d3d2559531a6a4b6a07ec033f928d519496`。

实现提交：`37fe3ce`。实施分支：`feature/lighttick-p0-v2-contract-runtime`；目录：`Zook/.worktrees/lighttick-p0-v2-backend`。本轮只实施最小改造清单中的C0/C1及必要保护，不修改Grow或原生代码，不部署、不迁移真实账号，不开放连接写入，不扩展P1/P2。

## 本阶段结果

字段、状态流转、完成规则、实际事实日期、统计/复盘、稳定错误码与canonical生成资产已对齐。本地Node与隔离PostgreSQL验证见下表。**这是合同和内部运行时完成，不是连接端P0整体完成或可放行写入。**

| 范围 | 实现与证据 |
| --- | --- |
| 字段 | day日期和at可空；三模式条件字段；time标准/可空起步，content/check不以分钟判断完成；无21:00假时间；来源身份归一化 |
| 状态 | 四状态与唯一running会话分开；revision、祖先阻断、执行后配置锁、终态只读；改期/null日期/取消与来源去重 |
| time | 多session累计本人确认分钟；minimum/partial/interrupted独立；中断达标仍需complete-time，不从墙钟推算完成 |
| check | 零分钟completion，reopen追加reversal，不删历史；有效完成按行动去重 |
| content | 只消费内部受信持久来源事件；账号/来源/origin/时间范围/一次绑定校验；running不静默结束，recorded投入与零分钟完成分开 |
| 日期/旧数据 | v2使用开始/确认实际日期并保留planned_date；v1 business_date与完成结论不重算。读适配不持久改写；其他新写入保留已结束v1事实的原始数据 |
| 统计与复盘 | 会话分钟、当前有效完成行动、minimum/partial/interrupted分别计；撤销影响实时结果，旧快照不改；允许补做实际范围 |
| 错误 | 保留标准Zook envelope；新增九个P0稳定code，仅按需返回安全reason/current_revision/existing_plan_id；外账号资源继续404 |
| 保护 | 公共行动写入、新连接码、签名claim/import/转发写入硬关闭；旧enable开关不能绕过；旧导入器拒绝v2或未知版本/事件/来源清单，拒绝时不改workspace |

公共字段与方法详见 [共享行动API](../../public-lighttick-actions.md)；唯一可生成合同为 [OpenAPI](../../../api-contracts/openapi/lighttick/api.yaml)，没有新增平行合同源。内部完成测试使用明确装载的受信来源/事件清单，**没有新增可由浏览器注入确认事件的API，也未声称已完成真实来源可读性证明或事件投递**。

读取声明 `action_schema_version:2`，同时明确 `content_receipts:[]`、`connection_write_enabled:false`、`source_delivery_enabled:false`、`v2_import_enabled:false`。POST正确声明schema2仍被拒绝，返回409/CONTRACT_UPGRADE_REQUIRED及CONNECTION_WRITES_DISABLED。旧无版本头的写调用也不能继续写入，因此本阶段不能直接作为已启用写入实例的线上替换版本。

## 执行清单

- [x] 固定时钟、账号隔离、失败先行的P0测试。
- [x] nullable/mode校验与旧数据读适配。
- [x] 累计计时、勾选撤销、配置锁与状态矩阵。
- [x] 受信来源清单、日期桶去重、证据核对消费。
- [x] 实际日期、统计、复盘、提醒与日历规则。
- [x] canonical字段/操作/版本头/错误样例及生成资产。
- [x] 公共写入与新接管关闭，独立于既有enable开关。
- [x] 旧导入器对v2的失败保护和无副作用测试。
- [x] 专项单元/API/合同与真实PostgreSQL验证。
- [x] 全量回归、合同lint/check与源码门禁执行及结果记录。
- [x] 公共文档、复现命令、剩余阻塞同步。

这里的勾选表示本阶段任务已执行并有证据；不表示全仓库门禁全绿或真实连接端已验收。

## 最终验证

| 检查 | 结果 | 证据 |
| --- | --- | --- |
| P0及既有行动、摘要、接管、API、合同生成专项 | 27通过，0失败/跳过 | [focused.log](focused.log) |
| PostgreSQL专项 | 1个完整集成场景通过，0跳过 | [postgres.log](postgres.log) |
| 全量Node回归 | 1497通过，0失败/跳过 | [full-regression.log](full-regression.log) |
| canonical生成与一致性 | generate/check通过 | 生成资产与全量中的生成一致性测试 |
| OpenAPI lint | 通过，有工具报告的204条warning；不当作零warning | [contract-lint.log](contract-lint.log) |
| 差异空白与OpenSpec格式 | 通过 | `git diff --check`、严格OpenSpec验证 |
| 全仓库源码行数门禁 | **未通过：8个基线已有超限文件**，均未被本轮修改 | [line-count.log](line-count.log)、[基线字节一致性](line-count-baseline.json) |

PostgreSQL验证使用显式localhost URL，在随机独立schema重复运行迁移074，验证并发start、服务重建恢复、外账号隔离、同key重放及回滚。新增故意让saveOperation在workspace保存后失败的检查，证明行动/事实/回执，以及内容事件绑定均共同回滚；重试后只产生一个有效完成。未连接真实来源、未调用收费模型。

失败先行证据：[原v1不支持P0](red-runtime.log)、[只读请求曾写回恢复状态](red-readonly.log)、[无关新写入曾持久化旧事实适配字段](red-legacy-preservation.log)。这些是修复前的历史失败，不是当前专项结果。

全量验证曾出现Frogsleep模块的间歇失败，原始结果保存在 [full-regression-intermittent.log](full-regression-intermittent.log)。定位于既有 `frogsleep-buddy-growth-hub.api.test.ts:101`：对整个已脱敏对象JSON搜索字符串“420”，生成的随机UUID含420时也会失败。已在未修改的基线53cf8d3上，仅用测试预加载器令随机UUID前缀为420，复现该断言失败；对象只有id/artifact_type/redacted/unavailable_reason字段，证据见 [基线复现](baseline-redaction-assertion.log) 与 [测试预加载器](uuid420-preload.mjs)。普通单独复测2项通过：[frogsleep-recheck.log](frogsleep-recheck.log)。本轮未修改该Frogsleep测试或业务代码，也没有跳过它；即便最终全量绿灯，仍保留这项既有不稳定性记录。

当前独立工作树借用与锁文件相同的主库Node/admin依赖目录进行只读测试；api-contracts依赖使用独立 `npm ci --prefix api-contracts --ignore-scripts`。没有改依赖清单或锁文件。首次全量因独立工作树缺admin的typescript而报错，补齐相同锁定依赖后该8项检查通过，未通过跳过测试解决。

## 复现

在实施工作树中，使用已有锁定依赖和本机临时PostgreSQL环境：

```sh
npm run check:api-contracts
npm run lint:api-contracts
node --experimental-transform-types --test test/unit/lighttick-action-p0*.test.ts test/unit/lighttick-action*.test.ts test/unit/public-contract-generation.test.ts
LIGHTTICK_ACTION_TEST_DATABASE_URL='postgresql://hao@127.0.0.1/postgres' node --experimental-transform-types --test test/integration/lighttick-actions-postgres.test.ts
npm test
npm run check:line-count
```

PostgreSQL用例会自行创建并清理独立schema；勿将测试URL改为远端或生产实例。最后一条命令当前仍会因上述8个未修改文件失败。

## 剩余阻塞

| 后续工作 | 未完成内容与放行标准 |
| --- | --- |
| C2：来源证明与投递 | Grow事务性outbox、来源可读性证明、签名绑定账号/target/origin、稳定事件ID及payload冲突检查、事件唯一性与可恢复投递；真实HTTP/DB故障和重试验收。当前私人清单是内部前置条件，不是浏览器可提交的证明 |
| C3：v2接管与恢复 | 完整计划/事实/事件/消耗关系/旧key/claims清单、版本与哈希计数、原子导入、失败重试、旧/新回执分流；旧包保持拒绝v2 |
| Grow消费侧 | 继续保留现有配对拦截；后续同时检查写入与来源能力，映射Zook标准envelope中的code/message/data，不能只看schema2就放行 |
| 原生消费者 | iOS/Android的共享行动DTO/API/必要操作、账号隔离草稿与未知请求恢复、来源打开上下文与设备能力；本轮完全未改 |
| 真实双端/设备验收 | Grow→Zook→两原生端、断网/杀进程/旧revision/跨午夜；实际系统通知/日历未验证，不能用内部fixture替代 |
| 仓库全局门禁 | 行数门禁8项基线超限仍未解决；本轮不跨域重构来消除此结果。Frogsleep整JSON子串断言的随机不稳定性亦保留 |

未合并主线、未推送发布分支、未部署、未迁移真实数据。所有连接写入限制继续有效；后续放行必须作为独立变更，在以上阻塞消除并通过真实集成验收后进行。
