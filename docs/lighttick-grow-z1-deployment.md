# Grow Z0/Z1：锁版兼容部署与验收

2026-11-02 补充：H5 运行源码已迁入 Zook `services/grow`，构建改用受摘要锁定的
仓库内源码，不再需要 Grow mirror。子路径入口和当前操作见
[Grow H5 部署](grow-h5-deployment.md)。下文 mirror 前置仅适用于历史 mirror 锁。

2026-11-01。本轮只实现 legacy 权威下的部署基础设施；不执行私人数据导入、不切内容/私人学习权威、不关闭 Render。Grow Python 仍从独立源码构建，后续业务实现只在 Zook LightTick。公共 API/DDL 未新增。

## 已实现

- `deploy_configs/grow-source.lock.json` 固定仓库、40位提交、归档/文件摘要、官方 Python 镜像 digest、协议版本；受管 Git mirror 只能获取指定对象。白名单打包过滤运行数据、隐藏工具目录及测试材料。
- `compose.grow.yaml` 是显式选择的第四服务，私有回环端口、独立 env/镜像/数据库、单 worker。开关关闭时不读取 Grow 文件、不取源码，原三服务 Compose 不变。
- `.deploy/<slot>/groups/<config_revision>/runtime.compose.json` 保存实际解析后的私有配置，文件600/目录700，支持字面 `$`。包含秘密，不能上传 Git、工单或聊天。备份需纳入服务器受控加密备份。
- 最终配置必须与预检的数据库/凭据一致；构建期间改 env 或 overlay 覆盖这些字段会在迁移前拒绝。迁移从同份冻结配置生成私有 env，不再读取可变文件。
- 全组件镜像ID、源码 main/tree、锁摘要、配置版本、迁移包摘要、legacy authority 进入发布凭据。迁移前持久化 journal；迁移失败不替换容器，保留现场供人工核对。
- Compose部分失败/健康失败恢复上组私有快照；不恢复数据库。中断后先恢复 journal，再接受新部署。清理保护dev/online的活动、上一组及pending镜像ID和标签；状态损坏则拒绝清理。
- dev显式验收绑定实际容器配置与镜像；online需要同main/tree/锁的凭据并提升同一组镜像ID，不重新构建。提升后建立online标签供原三服务回退兼容。

## 适用限制

Z1只允许 `authority=legacy` 且迁移包摘要不变的自动整组回退；Grow源码升级也拒绝自动通过。它不是Z2 live authority coordinator。已启用组后如需新增DDL，先在同迁移包版本下走一次关闭Grow的组发布和双槽位验收，退出组模式后再按既有三服务流程变更；不能用此路径越过业务权威迁移。退出后的服务端仍是legacy权威，并不意味着Render可停。

dev和online当前须在同一服务器Docker镜像存储中；跨主机部署需先实现受控镜像仓库传输和digest校验。此处验收凭据是受信任服务器上的操作员文件，并非远程签名证明。服务器所有者仍可改变文件或容器；需沿用服务器访问控制。

数据库名必须不同，即使主机/角色不同也拒绝同名，以便保守防误连。dev/online Grow还要求不同数据库名、Fernet密钥及origin。Grow DB与Zook DB中的同名账号不自动合并，旧密码不迁入Zook。所有配置使用单行 `KEY=value`（值可包引号），不支持shell命令或插值。

## 运维前置

1. 保留当前 Render。建立隔离 dev Grow 数据库、专用测试内容仓库和合成账户；不可把真实 Render 的桥接目标全局改到dev。
2. 核实服务器CPU/内存/磁盘、PostgreSQL/Redis、dev/online既有项目名和端口。先完成当前三服务基线发布（含相同迁移包），旧镜像须带可验证的源码标签。
3. 设置受管只读 Grow Git mirror；`GROW_SOURCE_MIRROR` 填服务器实际.git目录。origin必须为锁定义仓库的SSH或HTTPS URL，凭据由Git/SSH管理，不放URL。确保锁定对象长期保留。
4. 为dev网页配置真实HTTPS域名和代理，映射到Grow回环端口8757（online默认8756）。保留正确Host/端口，设置 `X-Forwarded-Proto=https`；Grow的`FORWARDED_ALLOW_IPS`只允许受控代理的实际对端IP，禁止 `*`。不把私有端口暴露公网。
5. 在原dev.env保留Zook现有变量，增加下方配置；Grow新建独立私有env，参见example。`LIGHTTICK_SEED_ENABLED=0`。LightTick后台delivery_config仍需单独启用及配置offlineSync。配置文件600，不提交。

```dotenv
GROW_DEPLOY_ENABLED=1
GROW_SOURCE_MIRROR=/absolute/server/managed-grow.git
GROW_APP_ENV_FILE=/absolute/server/Zook/deploy_configs/grow-dev.env
GROW_HOST_PORT=8757
# GROW_ACTION_BRIDGE_SECRET 与同槽位Grow私有env一致；不在此写真实值。
```

## 沿用Git发布链

仍是feature→main→原release_dev.sh→GitHub/Gitee release-dev与版本tag→现有CICD→build_and_push_docker.py。首次只发布dev；main push不会被当作online验收。不得直接推release分支或从feature发布。

服务器变量填写完成且本地及隔离dev门通过后，部署入口与原参数相同：

```sh
python3 build_scripts/build_and_push_docker.py \
  --branch release-dev --slot dev \
  --env-file deploy_configs/dev.env --app-env-file deploy_configs/dev.env
```

开关自动追加compose.grow.yaml，不需要再手工追加。额外受控overlay用`--compose-overlay`；命令不可从个人路径照抄生产执行。先用`--dry-run --skip-git-sync`检查，dry-run不会构建、冻结秘密或切服务；它也不替代实际验收。

在完全不经过Render的dev上实际验证后，建立私有证据文件：

```json
{"config_revision":"取实际dev发布凭据中的值","checks":{
  "course_same_id":true,"note_source_receipt":true,"plan_same_id":true,
  "account_isolation":true,"restart_retry":true,"https_verified":true}}
```

六项分别要求课程ID/版本回读、App笔记收到来源终态且网页回读、基础计划同ID、第二账户不能读写、重启及原key丢响应重试、真实HTTPS验证。不能凭health全部填true。记录对应测试日志及对象ID，避免包含私人正文。关闭Grow的过渡组改为`api_healthy/worker_healthy/admin_healthy/restart_retry/https_verified`五项，不伪造Grow故事。

```sh
python3 build_scripts/accept_grow_release.py --evidence /private/path/dev-evidence.json
```

只有成功后、origin/main仍是该候选，才运行原release_online.sh；online服务器自身配置也需准备。接受后任何代码、锁或配置变化都需重新dev验收。实际部署前读`.deploy/<slot>/grow-pending.json`；migrating/migration_failed保留时先核对数据库迁移日志，不手删journal、不恢复旧库继续写。恢复命令仍用原部署入口；完成恢复会要求重跑新部署。

## Z0离线映射与恢复工具

`build_scripts/grow_mapping.py`只验证离线审核清单，不导入数据库、不创建第二份API合同。字段为：

- `schema_version=1`，`objects[]`；每行(source_instance,source_account,module,legacy_id)唯一。
- `app_id/user_id/canonical_id/owner_verification_ref`必须显式给出。验证ref指向本人双身份关联记录，不能是凭用户名匹配的推断。
- `source_version`与`canonical_revision`分别保留；`authority=legacy/authority_epoch=0`。未知completed_at为null；不由计时、打开或笔记推导学完。
- module区分record、goal、plan_cycle、task、action_workspace、action_link、course_route、lesson、learning_private。重复相同映射幂等，不同source对象不得按标题或正文并为一个目标。
- 清单属于私有迁移审核资料，不能写入凭据、Token、密码或私人正文。来源授权、GitHub repo/ref/path/commit、未终态操作原key/hash/receipt、模块水位另行盘点，Z2定义实际导入协议。

实际双库演练命令（仅合成数据，新目录、新本机PG集群，结束自动停止）：

```sh
python3 test/support/grow_z0_postgres_restore.py \
  --root /private/new/qa-directory \
  --grow-server /approved/locked-grow/知行成长/server
```

需要本机PostgreSQL15工具、Node锁定依赖、Grow Python运行依赖。运行全部Zook迁移及LightTick PG测试，调用实际Grow笔记保存与原key重试，建立两个租户同课笔记和一条合成pending outbox；分别pg_dump/pg_restore到两个新库，逐表计数及内容摘要比较。此测试不替代真实租户全库/所有模块恢复。生产backup及加密密钥备份由服务器所有者完成；备份包含授权和用户资料，禁止发聊天。

## 本轮验收状态

源码/配置/故障注入专项测试及合成双库恢复已留证。全容器启动和真实HTTPS课程/笔记/计划故事尚未通过：本机Docker可以构建/创建容器，启动最小无网络容器也挂起，未重启承载其他项目的Docker。没有生成dev功能验收凭据，也没有开启服务器Grow开关或运行online发布。实际状态见plan的2026-11-01 Z0/Z1实施报告；旧20261031_001只代表前轮dev发布。
