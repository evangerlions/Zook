# 旧 Grow 接入清理验证

日期：2026-11-02。代码基线 Zook `13fa860`，在已有 feature/grow-native-migration-plan 分支继续当前请求；fetch 后 HEAD 与 origin/main 相同。保留上一轮规划编辑和原 Grow 工作区已有修改。

## 已实现清理

- 删除 328 个 tracked 旧接入文件：`services/grow` 的完整导入副本、编译缓存、Grow 专属部署脚本/验收工具、Compose/Python 构建、源码锁/环境示例、Admin Python 代理、专属夹具和过时运维文档。
- `build_and_push_docker.py` 去掉 Grow import、发布组/overlay 分支和专用恢复逻辑，基于其接入前版本恢复三服务流程。保留一个通用的结构化发布状态拒绝检查：旧组状态不可被新脚本静默当作标准单镜像状态。
- LightTick dev 运维脚本使用独立纯函数 `runtime_env.py`，不再依赖已删 Grow 工具；原鉴权/数据库隔离/文件隔离检查及私有备份行为保留。
- 同步 README_API、admin spec 和当前实现概览。现有 LightTick bridge/学习/行动合同和业务不属于这次 Python 部署导入，保留并参与完整回归。
- 原 Grow 仓库、历史学习资料及其未提交代码未修改。新 Grow App/API/React 页面尚未实现。

## 验证结果

| 验证 | 结果 |
|---|---|
| `python3 -m unittest discover -s build_scripts/tests -v` | 12 通过；覆盖 LightTick 运维、纯 env 解析、原部署状态兼容/不兼容边界和既有域名验收工具 |
| `node --experimental-transform-types --test test/unit/admin-web.server.test.ts` | 4 通过；API SSE、handoff、绝对 URL 边界与失败响应 |
| `npm test` | 2194 项，2193 通过、1 跳过、0 失败；不是生产或独立 PostgreSQL 验收 |
| `npm run check:api-contracts` | 通过；现有合同和生成输出未更改 |
| `npm run admin:typecheck` | 通过 |
| `npm run admin:build` | 通过 |
| `openspec validate grow-zook-native-web --strict` | 通过；只代表规划格式有效 |
| `git diff --check` | 通过 |
| 剩余 import/路径搜索 | 非历史证据/规划目录中无已删除部署工具与代理依赖；服务目录已移除 |

完整 Node 回归最初因本地缺少已锁定的 alipay-sdk 无法加载；按 package-lock 执行 `npm ci --ignore-scripts --no-audit --no-fund` 后重跑得到以上结果。没有修改依赖清单或锁文件。

## 实际边界

未运行 Docker 发布、release 脚本或访问服务器，未停远程容器、迁移数据库或删除数据卷。若服务器仍留旧组状态/实例，应按实际状态单独完成退役；新部署脚本拒绝结构化组状态，不尝试自动转换。没有把本地清理或单元测试标为新 Grow 全功能交付。
