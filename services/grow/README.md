# Grow H5

运行源码已从 `/Volumes/肖豪/project/grow` 迁入本目录，由 Zook 维护和发布。
导入包含当时工作区尚未提交的运行代码，来源 HEAD 和逐文件原始摘要见
`docs/grow-h5-import-20261102.json`。原 grow 工作区未改动。

这仍是 FastAPI 服务，推荐以 `PLAN_CONTENT_BACKEND=postgresql` 接入 Zook 的 PostgreSQL，
设置独立 `GROW_DATABASE_SCHEMA=grow_h5_dev`。记录、规划、课程正文与版本均在数据库内，
不需要 GitHub 凭证。根 schema 与各账号 schema 均显式固定，不回落到 Zook 的 public 表。
本次不把私人学习数据迁入 LightTick，
不连接或导入原 Render 数据库，不变更既有账户的加密密钥。
正式教学资料仅包含原 Dockerfile 已使用的三个教材目录，不包含个人学习记录。

部署入口为 `https://app-dev.youwoai.net/grow`。Zook Admin server 将
`/grow` 及 `/grow/*` 流式转发到同槽位 Grow 容器；`/config` 沿用管理后台。
构建时将静态资源和浏览器 API 路径转为 `/grow`；ASGI 包装层在鉴权前剥离
前缀，并给登录跳转、会话 Cookie 和退出 Cookie 添加相同作用域。
API JSON、下载、AI 事件流不经正文改写或缓冲。

后续修改本目录源码后，在仓库根目录执行：

```sh
python3 build_scripts/refresh_grow_source_lock.py
python3 build_scripts/refresh_grow_source_lock.py --check
python3 -m unittest discover -s build_scripts/tests -p 'test_grow*.py'
node --experimental-transform-types --test test/unit/admin-web.grow.test.ts test/unit/admin-web.server.test.ts
```

构建白名单和摘要校验继续生效，不再需要服务器上的 Grow Git mirror。
镜像来自当前 Zook 发布树；锁的 `commit` 保留导入来源，实际内容由摘要和
Zook release commit 共同确定。测试、环境文件和运行数据不会进入构建包。

隔离真实浏览器及 PostgreSQL 验收（需要已安装 Python 锁定依赖与 Playwright）：

```sh
python test/support/grow_h5_smoke.py --output .artifacts/grow-h5-smoke \
  --pg-bin /absolute/path/to/postgresql/bin
```

该测试使用全新本地数据库、合成账号、临时源码副本，不读取个人配置。
测试默认使用 PostgreSQL 内容存储，不配置 GitHub；所有模块必须 ready，首屏接口不得出现503。
还覆盖已有旧根路径 Cookie 的登录、写入后重启回读。AI 生成仍需要单独配置。
`test/support/test_grow_postgres_content.py` 通过 `TEST_GROW_POSTGRES_DSN` 指定本地测试库，
仅创建和清理随机 `grow_test_*` schema，验证版本不可变、并发冲突、租户隔离和发布恢复。

服务器配置及发布步骤见 `docs/grow-h5-deployment.md`。
