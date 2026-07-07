# API Contracts Sync

Zook 通过 API-only submodule 引用外部接口合同定义，不依赖整个 workspace。

## 路径

- submodule: `third_party/zook-api-contracts`
- FrogSleep canonical contract: `third_party/zook-api-contracts/openapi/frogsleep/api.yaml`

## 命令

```bash
npm run sync:api
```

这个命令会：
1. 更新 API-contracts submodule
2. 输出当前引用的 contracts revision

本仓库的 TypeScript 合同生成命令为：

```bash
npm run generate:public-contracts
```

该命令从 `third_party/zook-api-contracts/openapi` 读取 common、AINovel 与 FrogSleep OpenAPI schemas，并生成 `src/generated/openapi/public-contracts.generated.ts`。

说明：
- Zook 是接口实现方，不在本仓库里生成消费端 SDK
- 对外合同的唯一来源在 API-contracts 仓库
