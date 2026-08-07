# AGENTS

## Mandatory Development and Release Flow

- `main` 是唯一开发真值和唯一发布来源。任何业务功能、修复、配置、数据库迁移、API 合同和文档改动最终都必须先进入 `main`；严禁把 `release-dev` 或 `release-online` 当作开发分支。
- 开始工作前必须先确认工作区干净，执行 `git fetch origin`，切换到 `main`，并以 fast-forward 方式同步 `origin/main`。不得基于落后的本地 `main` 开始新的开发。
- 小提交是指单一目的、影响范围明确、能够在一轮内完成测试和复核的改动。小提交可以直接在最新 `main` 上开发；完成相关测试后提交并推送到 `origin/main`。
- 大提交是指跨模块功能、较长周期开发、重构、数据库或协议迁移，或需要多个中间提交的改动。大提交必须从最新 `main` 创建 `feature/<topic>` 分支，所有开发提交先进入该 feature 分支；开发期间应持续同步最新 `main`，完成完整测试和复核后再合并回 `main`，并在合并后的 `main` 上重新运行相关测试后推送 `origin/main`。
- feature 分支只能合并回 `main`，不得直接合并或推送到 `release-dev`、`release-online`。release 分支也不得反向合并回 `main`；需要保留的修复必须先在 `main` 实现。
- `release-dev` 只能通过仓库根目录的 `./release_dev.sh` 从 `origin/main` 更新；`release-online` 只能通过 `./release_online.sh` 从 `origin/main` 更新。禁止手工在 release 分支提交、手工执行 `git push` 更新 release 分支，或直接调用 `release_branch.sh` 改用其他 source branch。
- 发布前必须确认 `main` 工作区干净、目标提交已经推送到 `origin/main`，并且要求的单元测试、类型检查、构建或专项验证已通过。发布脚本负责创建版本 tag，并把 release 分支和 tag 推送到 `origin` 与 `gitee`。
- 标准发布顺序是：代码进入 `main` → 记录待发布的 `origin/main` SHA → 运行 `./release_dev.sh` → 在 dev 环境完成稳定性验证 → 确认 `origin/main` 仍是同一个已验证 SHA → 运行 `./release_online.sh`。如果 dev 验证期间 `origin/main` 已前进，禁止直接发布 online；必须以新的 `main` SHA 重新运行 dev 发布和验证。
- 如果发布合并出现冲突，不得在 release 分支发明一套仅供该环境使用的业务实现。必须以 `main` 为正确结果来源，检查并消除 release-only 改动；确需修复的代码先回到 `main`，通过测试后再重新运行发布脚本。
- 紧急 hotfix 也不得直接修改 release 分支。hotfix 应先进入 `main`，完成最低必要验证后，再依次通过发布脚本同步到 dev 和 online；任何例外都必须由仓库负责人明确确认并留下原因记录。

## API Contract Ownership

- 对外 OpenAPI 合同的唯一来源是本仓库的 `api-contracts/openapi/**`；不要再从旧的 API 仓库、submodule 或 workspace fallback 读取，也不要恢复双向同步脚本。
- `api-contracts/` 是维护期资产，必须与 Zook 运行时代码和根 Node 构建隔离。`src/`、`apps/` 和运行时容器不得直接 import、读取或依赖该目录。
- Zook 运行时使用提交到仓库的 `src/generated/openapi/**`。修改 OpenAPI 后，同一提交内必须运行 `npm run generate:public-contracts` 并提交生成结果。
- `api-contracts/package.json` 仅用于独立 lint；不要把它加入根 npm workspace、根依赖树或生产镜像。
- 合同改动完成前至少运行 `npm run check:api-contracts`。需要验证 OpenAPI 规则时，先运行 `npm ci --prefix api-contracts --ignore-scripts` 在隔离目录安装锁定依赖，再运行 `npm run lint:api-contracts`。
- 外部消费者需要合同快照时，应固定 Zook commit 并导出 `api-contracts/`，不要把整个 Zook 运行时仓库作为应用依赖。

## API Documentation

- 任何 API 的新增、删除、重命名，或 request / response / header / auth / app scope / error code 行为变更，都必须同步更新文档后才算完成。
- 对外接入接口文档只写到 `README_API.md`，面向外部 App / Web / H5 接入方。
- `admin`、运营后台、内部配置管理相关接口文档只写到 `docs/admin-api-spec.md`，不要混写到 `README_API.md`。
- 如果接口实现范围或后端能力矩阵发生明显变化，还应同步更新 `docs/current-backend-implementation-overview.md`。
- 如果改动的是某个复杂公共协议专题，例如扫码登录这类单独流程，除总入口文档外，还应同步更新对应的 `docs/public-*` 专题文档。
- 不允许出现“代码已改，但文档后补”的收尾方式；接口改动必须在同一轮任务里完成文档同步。

## API Path Shape

- 新增产品业务 API 必须使用 `/api/v1/{productKey}/...`，例如 `/api/v1/ai_novel/...` 或 `/api/v1/frogsleep/...`。
- 根路径 `/api/v1/{commonScope}/...` 只用于可复用的平台公共能力，例如 `auth`、`users`、`files`、`logs`、`notifications`、`analytics`。
- 不要把某个产品独有的业务接口加到 `/v1/*` 或根层 `/api/v1/{capability}/...`。
- 如果为了兼容旧客户端必须保留非标准路径，它只能作为临时 alias；必须在 `README_API.md` 中明确标注为兼容路径、非 canonical 路径，并同时提供 canonical `/api/v1/{productKey}/...` 路径。
- URL 中的 `{productKey}` 是产品 API namespace；运行时鉴权仍以 token/app membership 中的 `appId` 为准。不要把“appId 是鉴权真值”误读成“产品业务路径可以省略 productKey”。

## Backend service lifetime

- 后端 provider / manager / service 可以在 application factory 中创建一次并复用，前提是实例字段只保存稳定依赖或配置，例如 logger、database handle、fetch implementation、base URL、API key、静态 parser / mapper。
- 不要把 request / user / stream / job / tool call / retry loop 的运行时状态挂到单例 service 实例字段上。典型禁止项包括 current request、current user、chunk count、last stream event、first token time、累计 token、retry attempts、临时 buffer、当前 tool call 参数、当前事务状态。
- 如果某段逻辑需要跨多个 callback / async iterator / stream chunk 共享状态，必须创建 request-scoped / session-scoped context 对象，并把它显式传给这次执行链路。不要用 service 单例字段“临时放一下”。
- 复盘过的错误：AI stream 日志曾经把 `chunkCount`、`lastStreamEvent`、首个 delta 时间等字段放在 provider/logger 单例上；并发 stream 时，一个请求失败日志可能读到另一个请求的 stream 状态。这类问题必须通过每次 stream 创建独立 session 解决。
- 可以放进单例的逻辑：纯函数式转换、协议解析器、配置读取、无状态 adapter、稳定依赖包装、只依赖方法参数的 request builder。
- 不能放进单例的逻辑：任何会随单次调用变化、需要在 finally/catch 中回读、或可能被并发请求同时更新的数据。遇到这种需求，优先定义局部变量、闭包内状态、或专门的 `*Session` / `*Context` 对象。

## Admin Frontend

- `apps/admin-web` 的前端界面默认使用 Ant Design (`antd`) 作为组件与交互基础。
- 在 admin 前端开发中，优先复用现有的 Ant Design 组件、模式和交互，不要引入新的 UI 组件库。
