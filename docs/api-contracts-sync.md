# API Contracts Sync

Zook 通过 API-only submodule 引用外部接口合同定义，不依赖整个 workspace。

## 路径

- submodule: `third_party/zook-api-contracts`

## 命令

```bash
npm run sync:api
```

这个命令会：
1. 更新 API-contracts submodule
2. 输出当前引用的 contracts revision

说明：
- Zook 是接口实现方，不在本仓库里生成消费端 SDK
- 对外合同的唯一来源在 API-contracts 仓库
