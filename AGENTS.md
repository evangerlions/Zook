# AGENTS

## API Documentation

- 任何 API 的新增、删除、重命名，或 request / response / header / auth / app scope / error code 行为变更，都必须同步更新文档后才算完成。
- 对外接入接口文档只写到 `README_API.md`，面向外部 App / Web / H5 接入方。
- `admin`、运营后台、内部配置管理相关接口文档只写到 `docs/admin-api-spec.md`，不要混写到 `README_API.md`。
- 如果接口实现范围或后端能力矩阵发生明显变化，还应同步更新 `docs/current-backend-implementation-overview.md`。
- 如果改动的是某个复杂公共协议专题，例如扫码登录这类单独流程，除总入口文档外，还应同步更新对应的 `docs/public-*` 专题文档。
- 不允许出现“代码已改，但文档后补”的收尾方式；接口改动必须在同一轮任务里完成文档同步。

## Admin Frontend

- `apps/admin-web` 的前端界面默认使用 Ant Design (`antd`) 作为组件与交互基础。
- 在 admin 前端开发中，优先复用现有的 Ant Design 组件、模式和交互，不要引入新的 UI 组件库。
