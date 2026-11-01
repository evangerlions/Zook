# FrogSleep 隔离发布候选（2026-10-28）

## 范围

从 `origin/main` 的 `7e942f49481f7d583bb5a1b5dfd1b0a2e183cac0` 建立独立 checkout/feature 分支。保留原工作区、原本机 main 的未推送历史与所有客户端未提交文件。本候选不合入其他产品待发布业务；为消除现有 8 个源码超长阻断，复用纯职责提取，外部方法、初始化顺序、SQL 与事务回调保持不变，未放宽门禁。

- 共同睡眠：拒绝非法活动 ID；保留双方身份检查；活动过期后仍恢复原会话并核对窗口内的真实晨间完成事实，重试不重复累计。
- 私人历史：加入固定恢复、分页增量/墓碑、双设备重试及注销 epoch 回归。
- 留言/小花：迁移 075、事务仓储、独立接收许可、跨域配额、持久操作结果、清理与无正文遥测；canonical OpenAPI、生成合同与 README_API 同步。
- dev/online 模板显式设置 `FROGSLEEP_BUDDY_SUPPORT_ENABLED=false`；这不代表已修改部署服务器的实际配置。开关、关系 enrollment、接收许可是独立条件，部署不会自动完成试点验收。

## 本地验证

| 检查 | 结果 |
| --- | --- |
| 全量后端单测 | 1569 项：1568 通过、0 失败、1 条数据库条件跳过 |
| 邀请未读时钟数据库补验 | 专用本机库 7/7 通过、无跳过，包含上述跳过场景；不与全量计数直接相加 |
| Sleep PostgreSQL 集成 | 15 文件、93/93 通过、无跳过 |
| BodyLog PostgreSQL 回归 | 2 文件、2 项父测试通过，覆盖共享数据库拆分后的行为 |
| 共同睡眠/身份/领域专项 | 19/19 通过 |
| 留言与观察专项 | 50/50 通过 |
| 模块提取行为回归 | 118/118 通过 |
| 管理端 typecheck/build | 通过 |
| 合同生成一致性与 lint | 通过；lint 零错误、197 条既有告警，未将告警记为已整改 |
| 源码行数 | 677 文件通过；阈值与豁免不变 |
| OpenSpec changes strict | 3/3 通过 |

证据保存在本独立 checkout 的 `.artifacts/sleep-release-20261028/`。每个数据库文件使用新建的 localhost 一次性库，运行后清理；未使用真实 dev/online 数据库。本地 HTTP/替身提供方不能代替真实邮件、APNs/FCM 送达或真机证据。

## 发布与放行

先合并 main 并复验、推送 origin/main，再仅通过 `./release_dev.sh` 更新 dev 发布分支及版本 tag，由已有 webhook 自动部署。保存固定 main SHA、dev release SHA/tag、健康版本、迁移/worker及验收证据。真机使用隔离 QA bundle 和既有 XCUITest，不能把 fixture UI 当作真实 dev API 旅程。

当前记录仅证明发布候选本地通过，不表示 dev 已部署或生产放行。真实 dev 双账号/错误账号、明确可销毁正式账号注销、双设备恢复、SES delivered、APNs/FCM 真机 deep link、回滚目标仍需按实际证据复核；留言跨设备试点与观察任务保持未完成。仅在 dev 验收通过且 origin/main 仍为同一已验证 SHA 时，才运行 `./release_online.sh`。没有这些证据则停在 dev，不能跳过到 online。

## 首次 dev 发布与真实 HTTP 验收

- main `e0cfa79cbeb85fcb5ca87d519962d7baa808e52e` 已推送。由 `./release_dev.sh` 创建 `version/20261028_001`，dev release 为 `cab6c5f78a8661ce5bc043f7df7413c1e86bd663`；origin/gitee 均由脚本更新，健康接口确认 `20261028_001`。online 仍为 `20261009_005`。
- 合并 main 后相关回归 569 项：568 通过、0 失败、1 项数据库条件跳过。新留言 HTTP 和共同完成数据库回归分别 1/1、3/3；未读时钟补验 7/7，无跳过。
- 真实 dev 的 80 项同步、游客升级、碰撞回滚及游客注销恢复检查通过，清理失败 0。缺少明确可销毁的正式 QA，结果保持 `complete:false`、`registered_deletion:false`。
- 另有 Alice/Bob 账号、邀请/关系/通知路由及拒绝路径 33 项通过，确认新留言接口关闭、非法活动 ID 返回 400。没有清理既有搭子关系或发送新邀请。第三注册 QA 账号 charlie 不存在，不能将第三账号旅程记为通过。
- 两台真实 iPhone 已尝试既有 XCUITest，使用独立 QA bundle，未替换原安装包。首次及解锁后的运行器均未进入业务测试，报告 IDE 连接中断/code 74 或 automation mode 超时。Mac 为 Xcode 26.3，设备为 iOS 27；尚未确定单一根因，UI 自动化保持未通过。
- 独立 QA 包在 aphone（iOS27.0）上直接调用现有原生客户端：首次健康请求网络失败；后续 13 项通过、Bob 留言状态读取超时；连接稳定后重跑 15/15 通过，含两账号登录、账号解码、邀请收发列表、共同睡眠状态、留言关闭解码及退出。没有 fixture transport。真机回执单独保存在本地，不等于完整 UI、跨设备或真实推送验收。
- 原生 iOS16 目标直接使用 iOS17 `symbolEffect`，造成 `BuddyQuickShareSheet.swift:137` 编译失败。本轮仅将隔离 QA 构建最低版本设为 iOS17，未修改原客户端源文件，不声明 iOS16 兼容通过。

本节记录上述固定版本的历史验收。后续 main 前进后，必须重新发布 dev 并核对新 SHA，不能直接以 001 的结果放行后续 online。真实邮件、APNs/FCM、正式账号注销、双设备完整旅程及受控留言试点仍未放行。
