# Sleep API、能力与本地分支整合审计（2026-10-18）

## 结论

FrogSleep后端的账号、个人报告同步、私人专注、搭子邀请/方向授权、共同守护、成长与通知、运营后台均有实际实现和自动化验证。续作已补原始终态睡眠同步与独立凭据的云游客升级，设备ID单独仍不能认领数据。真实提供方/真机/dev验收和客户端二期恢复仍未完成，不能据此声明整个Sleep产品或线上能力已全部完善。

审计基线为 `origin/main` 的 `35ad30a`。开始时当前分支 `feature/frogsleep-data-ownership` 与远端main各有独立提交，多个工作树仍有未提交工作，答案是“当时尚未全部合并”。本轮按用户确认将未提交内容一起保存为快照后整合，不丢弃原工作树文件或暂存区。最终核对发现搭子工作树在任务期间仍有并行写入，额外冻结 `7dfbedd`（`feature/integration-snapshot-buddy-completion-late`）作为本轮追加整合边界；其后最后一次同类旧ID防绕过补丁另保存为 `598230d`，由主线统一关系解析器覆盖并补齐兼容helper防护；涉及完成时间边界、旧关系遮蔽、查询提取和双人晨间终态。

## API覆盖

canonical OpenAPI为 `api-contracts/openapi/frogsleep/api.yaml`；统计126条路径、146个方法操作，不含admin与代码提供的兼容别名。实际HTTP主路径统一 `/api/v1/frogsleep/...`，下表省略该前缀。

| 能力 | 代表路径 | 完整性与边界 |
| --- | --- | --- |
| 账号/会话/设备 | `auth/*`、`me`、`me/account`、`devices` | app membership隔离，刷新/登出/删号、设备当前归属和旧token拒绝；删号保留全局身份及其他产品 |
| 私人报告和偏好 | `product-data/sleep-reports`及`/{id}`、`progress/report_preferences` | 稳定逻辑ID、账号内幂等、revision/If-Match、epoch、墓碑，完整分页无500条截断 |
| 原始终态睡眠 | `product-data/sleep-sessions`及`/{id}` | 有界原始JSON与事件、终态/时间校验、完整修订及墓碑，禁止恢复活动设备锁 |
| 可信云游客升级 | `account/guest-sessions`、`account/upgrade` | 独立密钥、受限身份、正式目标证明、确认/epoch/幂等、原子迁移与会话撤销 |
| 多设备私人恢复 | `product-data/personal-sync/{state,restore,changes}` | 固定边界restore、提交有序changes、签名/账号/epoch/查询绑定游标；原始终态睡眠、报告摘要与报告偏好 |
| 私人专注 | `focus-buddy/sessions`、`stats/week`、`achievements` | 同账号ID并发去重、相同重放不重复统计、跨账号隔离；正常上报保留修正能力，确认导入不可变 |
| 搭子邀请 | `buddy/invitations`、`preview`、`/{id}/domains/{domain}/{accept,decline,cancel}` | 邮箱正确账号认领、独立域CAS/幂等、原关系回执、slot并发、终态重放；接受不授予共享 |
| 方向授权/安全 | `buddy/relationships`、`/{id}/grants`及生命周期命令、blocks/reports | 双方独立授权，暂停/恢复/解除/静默，撤权/拉黑关闭共享协调与旧通知访问 |
| 共同守护 | `sleep-buddy/shared-sessions`、事件、summary/recap | 两人独立晨间状态、双方完成才终态、事件重放去重、按查看者过滤；无授权可显示关系但无共享session |
| 专注共享 | `focus-buddy/relationships/current`、comparison、shared-moments | canonical关系直接读取，方向授权，双人重叠记录派生且幂等；个人保存不依赖搭子服务可用 |
| 成长/共同目标 | `buddy/growth-hub`、shares/interactions/joint-activities/joint-goals/milestones/reports | 完成和进度来自真实终态事实，禁止客户端贡献数字制造完成；活动/目标/worker使用关系锁和授权重验 |
| 通知 | `buddy/notifications`及read/route、preferences | 稳定outbox/job身份、每设备回执、失败补偿、发送前重验、偏好/静默/撤权抑制，无设备站内回退；provider接受不等于设备送达 |
| 群组/陌生匹配 | group和matching相关接口 | 已有基础实现及能力开关，不作为已完成上线能力默认放开 |
| 运营后台 | `/api/v1/admin/apps/frogsleep/...` | 聚合/分页元数据、用户级读与重试的二次授权及审计、排除敏感正文和设备token；规范见admin文档 |

`since`是报告发生时间的严格下界，不是完整数据变更协议；修改和删除应使用changes。游标固定读取边界，翻页时不能换筛选。新canonical接受持久化八条revoked/version1授权；客户端应先读版本，不能把不存在时的version0默认值硬编码。

## 本次修复的整合缺陷

- 保留报告修订、固定恢复和墓碑协议，并兼容since完整数据库分页；增加严格时间边界与筛选游标回归。
- 专注周统计消费week_start；上传与删号共用membership锁，确认导入标记持久化，省略binding也不能覆盖既有确认数据。
- 禁止仅凭guest_device_id转移云端记录；`account/upgrade`认证后返回409 `FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED`。用户确认的本地导入复用标准报告和终态专注上传。
- 睡眠通知入队/投递复核本人偏好；完成晨间状态不能通过重新accept回退。
- 共同活动与目标恢复关系锁、授权和版本重验；目标调整不能跨域；里程碑/周报忽略任意贡献回执，使用真实终态事实及其发生时间，修复DST周窗口。
- BodyLog迁移重放不再取消新计划，修复DATE/非法日期、事务adapter和新增聚合清理；历史迁移按schema检查，避免并行数据库测试交叉污染。
- 保留main更新的LightTick复盘/规划行为，清除过时重复测试，补齐旧PG测试所需迁移；OpenAPI去重并重新生成。

## 本地分支与未提交工作

原18个非发布本地分支（含main和backup）均纳入整合历史：`backup-before-squash`、`codex/buddy-first-completion`、`codex/dazi`、BodyLog三个feature分支、FrogSleep三个feature分支、LightTick七个feature分支、`feature/sleep-phase2a-readiness`、`main`。

其中 `backup-before-squash` 与 `460af50` 文件树完全相同，只记录已squash历史，避免覆盖后续主线。LightTick unified和coach分支的部分内容也已由主线后续工作覆盖，冲突以最新已实现功能和行为测试为准。

未提交工作用独立Git index生成提交快照，原工作树文件和暂存区保持原样：

| 原工作树 | 快照分支 | 内容 |
| --- | --- | --- |
| sleep-phase2a-backend | `feature/integration-snapshot-sleep-phase2a` | 报告同步、邀请/生命周期、通知、后台及规范 |
| frogsleep-phase2-isolation | `feature/integration-snapshot-sleep-isolation` | 确认导入、授权竞态、账号删除 |
| frogsleep-backend-loop-fixes | `feature/integration-snapshot-buddy-completion` | 首次真实完成、共同活动和成长事实 |
| bodylog-social-growth-readiness | `feature/integration-snapshot-bodylog` | 本地目标聚合和能力开关 |
| lighttick-unified-backend | `feature/integration-snapshot-lighttick` | 规划上下文、复盘节奏 |
| bodylog-account-social-20260728 | `feature/integration-snapshot-legacy-email` | 旧邮件worker重复文件，与主线耐久worker核对 |

`node_modules.bak-20260830/`是依赖备份目录，不作为源代码提交。开发分支整合不删除旧分支/工作树。`release-dev`、`release-online`按AGENTS禁止反向合并；未执行发布或修改发布分支。`release/v1-buddy-launch`的业务内容已在历史squash中，无需把环境发布历史再次反向合并。

## 尚未完成的产品/环境能力

1. 运行中设备状态及客户端二期持久恢复/离线多设备冲突流程；后端已支持原始终态历史，但双端仍需接入与验收。
2. 客户端云游客安全凭据存储、明确确认与升级后的恢复接入；后端凭据创建/恢复/原子转移协议已在续作实现。
3. 当前dev多账号/双设备/删号旅程，SES真实delivered回调、APNs/FCM真机deep link与系统通知无权限回退。测试中的provider替身不等同于这些证据。
4. 二期灰度与回滚负责人、同一main SHA先dev后online的发布门槛。OpenSpec 2A §3与2B 4.5仍未完成，不能自动勾选上线。
5. `../sleep/docs`最新搭子中心设计中的二维码/系统分享包含客户端工作和草案路径；当前可复用统一邀请的share_link/code及结构化shares，草案 `/v1/buddy/...`不是新增后端合同或可宣称已上线的接口。

## 验证记录

首批整合 `8fad464` / `b8a01f0` 之后，追加整合 `091bee6`、测试夹具 `31d12df` 与最终兼容helper防护 `bb69108` 均已合并main。验证结果如下；所有上线/provider/真机未完成项仍保留。

| 检查 | 合并后main结果 |
| --- | --- |
| `npm test` | 1457项通过，0失败/取消/跳过 |
| FrogSleep真实PostgreSQL | 11套文件、70项（含父测试）通过 |
| LightTick真实PostgreSQL | 6套文件、25项（含父测试）通过 |
| BodyLog真实PostgreSQL | 2套文件、2项父测试通过；覆盖事务、并发、迁移重放 |
| `npm run admin:typecheck` | 通过 |
| `npm run admin:build` | 通过 |
| `npm run check:api-contracts` | 通过，与生成物一致 |
| `npm run lint:api-contracts` | 0错误、196条警告 |
| `git diff --check` | 通过 |
| `npm run check:line-count` | 未通过，见下方既有9项维护问题 |

PG共19套文件，累计TAP统计97项（含父测试），无失败/跳过。追加整合后FrogSleep的11套70项全部重新通过；LightTick/BodyLog代码与首批main相同，沿用已通过的25+2项数据库验证。最终兼容helper防护又在合并后main完成15项授权/旧ID/会话回归；全量1457项零失败。分别给每套测试新建一次性数据库，避免跨套污染；报告完整恢复、301条微秒边界、独立连接并发/删除/授权/通知专项未连接线上数据。

可复验入口：`test/integration/frogsleep-*.test.ts`、`test/integration/lighttick-*.test.ts`、`bodylog-growth.postgres.test.ts`和`bodylog-postgres.test.ts`。按产品设置各自 `FROGSLEEP_TEST_DATABASE_URL` / `LIGHTTICK_TEST_DATABASE_URL` / `BODYLOG_TEST_DATABASE_URL` 到独立一次性库，运行 `node --experimental-transform-types --test <file>`。不要把测试URL指向已有业务数据库。

源码行数门禁未通过：原main基线已有9个超限文件，整合后仍为同9个，两个旧数据库汇总文件因新增委托继续增长；没有放宽门禁或新增allowlist。该维护项与功能测试结果分别记录，不把“功能已验证”写成“所有仓库门禁全绿”。


最终整合边界：末次原工作树快照 `598230d` 的旧ID授权补丁在main通过统一关系解析器实现，兼容SleepRelationshipService也补齐同一拒绝规则；避免重复维护两套授权真值。原工作树文件与index保持原样，快照及合并记录可追溯，不代表原工作树变成干净状态。主工作区已切到main；发布分支未修改。本次生成的一次性数据库已清理。

## 原始同步与游客升级续作

在已整合main基础上补齐终态原始sleep_session资源和独立密钥云游客。原始数据支持统一修订/固定恢复/changes/墓碑；游客身份30天、仅私人数据权限，正式账号凭独立证明/确认/epoch/idempotency key原子升级，相同数据去重、冲突全回滚，来源失效。迁移072/073可重放，公共合同与专题同步。上文设备ID拒绝仍适用于旧兼容请求，不再代表所有云游客升级均未提供。

feature验证：首轮全量1463项通过，随后新增/修正的原始、游客、合同及个人同步专项17项通过；原始JSON深度/非有限数与时间精度再补2项验证通过。三套独立一次性PostgreSQL数据库测试共24项通过（新增10项、个人同步9项、账号删除5项，含父测试），覆盖505条原始分页、双连接并发/回滚、上传与删号竞争、来源封禁、迁移重放。独立复核发现的数组枚举、封禁来源、时间精度和删除envelope问题均修复；合同生成一致、lint零错误194条警告。行数门禁仍为相同9个既有超限文件，未新增超限文件或放宽限制。最终main验证另记。
