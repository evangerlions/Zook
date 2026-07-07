# AGENTS

## API Documentation

- 任何 API 的新增、删除、重命名，或 request / response / header / auth / app scope / error code 行为变更，都必须同步更新文档后才算完成。
- 对外接入接口文档只写到 `README_API.md`，面向外部 App / Web / H5 接入方。
- `admin`、运营后台、内部配置管理相关接口文档只写到 `docs/admin-api-spec.md`，不要混写到 `README_API.md`。
- 如果接口实现范围或后端能力矩阵发生明显变化，还应同步更新 `docs/current-backend-implementation-overview.md`。
- 如果改动的是某个复杂公共协议专题，例如扫码登录这类单独流程，除总入口文档外，还应同步更新对应的 `docs/public-*` 专题文档。
- 不允许出现“代码已改，但文档后补”的收尾方式；接口改动必须在同一轮任务里完成文档同步。

## Backend service lifetime

- 后端 provider / manager / service 可以在 application factory 中创建一次并复用，前提是实例字段只保存稳定依赖或配置，例如 logger、database handle、fetch implementation、base URL、API key、静态 parser / mapper。
- 不要把 request / user / stream / job / tool call / retry loop 的运行时状态挂到单例 service 实例字段上。典型禁止项包括 current request、current user、chunk count、last stream event、first token time、累计 token、retry attempts、临时 buffer、当前 tool call 参数、当前事务状态。
- 如果某段逻辑需要跨多个 callback / async iterator / stream chunk 共享状态，必须创建 request-scoped / session-scoped context 对象，并把它显式传给这次执行链路。不要用 service 单例字段“临时放一下”。
- 复盘过的错误：AI stream 日志曾经把 `chunkCount`、`lastStreamEvent`、首个 delta 时间等字段放在 provider/logger 单例上；并发 stream 时，一个请求失败日志可能读到另一个请求的 stream 状态。这类问题必须通过每次 stream 创建独立 session 解决。
- 可以放进单例的逻辑：纯函数式转换、协议解析器、配置读取、无状态 adapter、稳定依赖包装、只依赖方法参数的 request builder。
- 不能放进单例的逻辑：任何会随单次调用变化、需要在 finally/catch 中回读、或可能被并发请求同时更新的数据。遇到这种需求，优先定义局部变量、闭包内状态、或专门的 `*Session` / `*Context` 对象。

## Source file size

- Zook has a source-wide line-count gate enforced by `npm run check:line-count`.
- The current gate is implemented in `scripts/check-source-line-count.mjs` and limits scanned source files to `599` lines.
- This limit applies to backend and frontend source files covered by that script, not only to UI widget files. Tests, generated output, build output, and other explicitly excluded paths follow the script's exclusions.
- When a production source file is already over the limit and the task touches it, prefer splitting the touched responsibility into a focused module instead of growing the oversized file.
- Do not add a touched file to a line-count allowlist to make CI pass. A temporary exception is allowed only for legacy untouched files, and the exception must include an owner, reason, and cleanup trigger in the same change.
- Treat a passing line-count check that depends on expanding an allowlist as unresolved maintainability debt, not as a clean pass.

## Admin Frontend

- `apps/admin-web` 的前端界面默认使用 Ant Design (`antd`) 作为组件与交互基础。
- 在 admin 前端开发中，优先复用现有的 Ant Design 组件、模式和交互，不要引入新的 UI 组件库。
