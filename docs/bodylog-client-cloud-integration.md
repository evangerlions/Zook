# BodyLog 客户端与云端衔接

日期：2026-09-10。代码接线与本地验证说明；不表示已发布、真实推送已送达或商店购买已完成验签。

## 已实现的衔接

| 链路 | iOS | Android | Zook |
| --- | --- | --- | --- |
| 环境与认证 | Auth 与产品 API 使用同一 host；Debug dev / Release online；社交前缀含 bodylog | Auth、社交、订阅默认统一到 app.youwoai.net，可用 dart-define 覆盖 | 公共认证保持 `/api/v1/auth/*`，业务保持 `/api/v1/bodylog/*` |
| 搭子邀请 | 正确读取 invitationUrl，创建后分享；深链打开详情，由用户确认接受 | 选择 1–3 个非私密共享习惯、提交并分享完整 URL；深链进入有效路由 | 接受仍校验真实接收者；不因打开链接自动接受 |
| 搭子打卡 | 本地记录进入账号隔离的持久队列；前台、登录、网络恢复重放 | SQLite v15 独立 outbox，与日志在同一事务写入；前台/登录/定时重试 | eventId 去重；保留 occurredAt；相同 ID 不同内容返回 409 |
| 共同习惯 | 语义键与本地 UUID 分开保存 | 水、运动、站立、睡眠、阅读、冥想映射到相同语义键 | sharedHabitIds 匹配语义键，旧的任意 ID 仍兼容 |
| 搭子等级 | 沿用 3/7/30/60/180 天 | 补 legend，纠正 gold/diamond 门槛 | 同一套门槛与权益额度 |
| 排行榜 | 按冻结快照时区重算本周每日完成情况 | 从 SQLite 重算每个已排期日期 | 新增本人 snapshot 查询；聚合覆盖更新和计分在事务中执行 |
| 七日成长 | 无计划展示报名入口；任务确认、领奖、刷新；任务/奖励中心读真实数据 | 最新计划查询保留已完成计划；既有任务/领奖接口继续使用 | 新增 latest 读取已完成计划，避免重启后找不到领奖入口 |
| 云端权益 | 查询产品内 subscription/status，社交失败不回退本地付费状态 | 解析统一信封和 camelCase；搭子配额使用云端状态 | 读取已有有效订阅，与搭子/小组配额的判断来源一致 |
| 推送 | APNs 注册回调、权限已授予时注册、退出解绑、点击进搭子详情 | 可配置 Firebase 初始化、token 获取/刷新、账号切换删除 token、通知点击恢复路由 | BodyLog 自有设备表、类别偏好、静默时间、失效 token 清理、真实 dispatcher；未配置不会冒充送达 |

## 数据约定

1. `habit-water`、`habit-exercise`、`habit-stand`、`habit-sleep`、`habit-read`、`habit-meditate` 是搭子共同习惯语义键。客户端按对应模板图标映射，用户仍需明确选择共享类别。自定义习惯不自动与别人的本地 UUID 匹配。排行榜继续使用用户本地 habitId，并不使用这些跨用户语义键。
2. 本地日志是记录事实来源。队列保存原账号和不可变事件 ID；发送前再次检查账号和隐私。旧账号的待发送数据不会换用新账号 token。
3. 重复搭子事件不会增加活动或通知；发生时间在关系接受之前的日志不加入新关系。补报保留 UTC 日期，但不会追溯重新结算已结束的历史搭子积分。
4. 排行榜是每日完整聚合覆盖，支持撤销和当前周离线补报；没有完整本地参赛习惯的第二台设备不应覆盖已有聚合。这不是多设备日志合并/云备份协议。
5. 成长任务保持现有的用户确认完成协议，不把普通一次打卡伪装成 8000 步、2000 ml 或 480 分钟。领奖必须以云端状态为准。growth 开关继续由服务端控制。
6. quietHours 当前合同没有时区字段，后端按 UTC 小时过滤。窗口内通知直接跳过，不在窗口结束后补发；需本地时区静默时应单独扩展合同。

## 部署和真机配置

### iOS

- `project.yml` 是构建配置源，已同步生成 Xcode 工程。Debug 使用 `https://app-dev.youwoai.net/api/v1/bodylog`，Release 使用 `https://app.youwoai.net/api/v1/bodylog`。本地调试可显式覆盖 `BODYLOG_API_BASE_URL`，Auth 自动使用相同 host。
- `APS_ENVIRONMENT`：Debug development、Release production。签名描述文件必须具有实际 APNs capability。
- APNs 服务端沿用 `APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_PRIVATE_KEY_PATH`、`APNS_BUNDLE_ID` / `APNS_TOPIC`、`APNS_SANDBOX`；额外设置 `BODYLOG_APNS_BUNDLE_ID=com.youwoai.habittap`，防止错误使用其他产品 topic。
- HTTPS 邀请链接自动拉起还要求域名提供匹配的 apple-app-site-association，且签名 App associated domains 覆盖链接 host。此次本地构建未验证域名关联文件；自定义 `bodylog://buddy/{pairId}` 可用于显式深链联调。

### Android

- 用 `--dart-define=BODYLOG_API_BASE_URL=https://app-dev.youwoai.net` 指向 dev。参数使用 host 根地址，不添加 `/api/v1/bodylog`。
- Firebase 客户端需注入 `BODYLOG_FIREBASE_APP_ID`、`BODYLOG_FIREBASE_API_KEY`、`BODYLOG_FIREBASE_SENDER_ID`、`BODYLOG_FIREBASE_PROJECT_ID`。这些配置必须来自 BodyLog Firebase 项目；缺少配置时不初始化远程推送，原本地提醒继续可用。
- 服务端需 `BODYLOG_FCM_PROJECT_ID` 和 `BODYLOG_FCM_SERVICE_ACCOUNT_PATH`，服务账号只在服务端使用。
- Firebase token 和点击恢复接线依据 [Firebase 官方 Flutter FCM 接入文档](https://firebase.google.com/docs/cloud-messaging/flutter/get-started)。实际送达仍需带 Google Play 服务的真机及通知权限。
- Android SQLite 从 v14 升到 v15，只新增 `cloud_activity_outbox`。不重建习惯/日志表；回退客户端前应保留数据库备份，避免旧版本遇到更高 schema 版本。

## 验证与限制

- 对外合同已同步 `api-contracts/openapi/bodylog/api.yaml`、`README_API.md`；执行生成与合同一致性校验。运行时代码继续不依赖 api-contracts 目录。
- 后端专项覆盖邀请接收者确认、重复/冲突事件、最新计划恢复、账号隔离、推送偏好与设备失效等；另跑既有 BodyLog 和 APNs/FCM 回归。
- iOS 已跑 Release 模拟器构建和账号、队列、邀请、API 路径及成长入口专项测试；Android 已跑静态分析、账号/队列/迁移/深链/权益测试和全量测试。具体最新结果以任务交付记录为准。
- 原客户端工作区有大量未提交开发，已保留；本次不将用户原有代码混入 Zook 提交。
- 此次不新增商店购买凭证验签 API。端上商店购买成功不能据此宣称已获得云端权益；仅已有云端订阅/奖励会体现在新 status 查询。需要商店项目配置与后端验签实现才能完成购买→云端授予→恢复购买的完整闭环。
- 不包含全量健康记录云备份、多设备合并、小组 UI 从零建设；这些能力不能通过本次社交聚合接口推导为已实现。
- 尚未运行发布脚本。应按仓库流程在 main 推送后发布 dev，完成真机账号、双账号搭子、离线重试、推送及领奖验收，再使用同一 SHA 发布 online。


### 本轮验证记录

- Zook：185 个测试文件分 7 批运行，1,048 项全部通过；所有批次退出码 0。合并 main 后 53 项相关回归再次通过；最初磁盘耗尽时的失败结果未计作通过。相关 BodyLog、APNs、FCM 与 FrogSleep 通知回归已覆盖。
- iOS：Release 模拟器构建通过；最终 Debug 代码专项 25 项全部通过。测试覆盖账号状态、持久队列、真实邀请 URL、最新计划无数据入口和业务 URL 前缀。
- Android：账号、搭子、深链、SQLite 队列/迁移及权益专项 75 项通过。全量执行曾为 421 通过、5 失败：其中 3 项旧路由/schema 断言更新后已通过；剩余布局与颜色断言来自未修改的界面。静态检查仅剩 `primary_page_components.dart` 原有未使用变量警告。ARM64 Profile APK 构建通过，产物约 54.3 MB；Debug 多架构构建曾因磁盘耗尽中断，未记为通过。
- 真实 PostgreSQL 多连接验证和真机推送送达尚未执行；不能由内存 API 测试推断通过。
