# Zook Backend Build / Server Commands

这个仓库当前落地的是一个可运行的 TypeScript MVP 骨架，默认使用内存适配层来验证设计规则。
本地开发可以直接用下面这些命令：

```bash
npm test
npm run dev
npm run worker
```

## 本地运行

启动 API：

```bash
npm run dev
```

启动 Worker：

```bash
npm run worker
```

执行单元测试：

```bash
npm test
```

## 生产发布常用命令

### 同机构建并发布

如果你的服务器同时承担构建和线上运行，推荐直接使用：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --commit <commit_sha>
```

这条命令会在本机完成：

1. 获取部署锁
2. `git fetch` / `git checkout`
3. `docker build`
4. `docker compose up -d`
5. 健康检查
6. 失败自动回滚

完整说明见：

[docs/local-cicd-deploy.md](/Users/zhoukai/Projects/AI/codex/Zook/docs/local-cicd-deploy.md)

补充说明：

虽然文件名还是 `build_and_push_docker.py`，但现在它已经收敛成仓库内唯一的本地部署入口。

它会负责：

1. `git fetch` / `git checkout`
2. 本地 `docker build`
3. `docker compose up -d`
4. 健康检查
5. 失败自动回滚
6. 成功后默认保留最近 `5` 个本地发布镜像，并清理更早的旧镜像

本地镜像 tag 默认按以下规则生成：

```text
<git-branch>-<version>-<git-short-hash>-localdeploy
```

如果工作区存在未提交改动并使用了 `--allow-dirty`，脚本会自动追加 `-dirty`，避免把脏构建误认为干净的 Git 版本。

版本号默认按下面顺序自动识别：

1. 最近一次提交信息中的版本标记
2. `HEAD` 上的版本 tag
3. 当前分支可达的最近版本 tag

支持的版本 tag 例子：

```text
20260310_001
version/20260310_001
1.2.3
v1.2.3
version/1.2.3
version/v1.2.3
```

支持的提交信息例子：

```text
release: 20260310_001
version: 20260310_001
chore: publish version/20260310_001
release: 1.2.3
version: 1.2.3
chore: publish version/1.2.3
```

例如识别到 `version/20260310_001` 后，镜像 tag 会得到类似：

```text
main-20260310_001-133581-localdeploy
```

如果暂时没有版本 tag 或版本提交信息，脚本会回退为：

```text
<git-branch>-<git-short-hash>-localdeploy
```

如果只想先检查会生成什么镜像名和 compose 注入变量，不真正执行 Docker 命令：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --slot online --skip-git-sync --allow-dirty --dry-run --env-file deploy_configs/online.env --app-env-file deploy_configs/online.env
```

如果你只想强制从 tag 取版本，或只想强制从提交信息取版本，也可以显式指定：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --version-source tag
python3 build_scripts/build_and_push_docker.py --branch release-online --version-source commit
```

如果你想调整清理策略，可以在部署 env 中设置：

```text
DEPLOY_KEEP_RELEASES=5
DEPLOY_BUILDER_PRUNE_UNTIL=168h
```

也可以临时通过参数覆盖：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --keep-releases 8
python3 build_scripts/build_and_push_docker.py --branch release-online --skip-image-cleanup
python3 build_scripts/build_and_push_docker.py --branch release-online --skip-builder-prune
```

文档里约定的生产发布命令建议保留为以下顺序：

拉取镜像：

```bash
docker compose pull
```

如果是服务器本地构建：

```bash
docker compose build
```

执行数据库迁移：

```bash
prisma migrate deploy
```

发布 API 和 Worker：

```bash
docker compose up -d api worker
```

查看容器状态：

```bash
docker compose ps
```

## 日志查看命令

实时查看 API 日志：

```bash
docker compose logs -f api
```

实时查看 Worker 日志：

```bash
docker compose logs -f worker
```

查看最近 1 小时 API 日志：

```bash
docker compose logs --since 1h api
```

## 回滚与健康检查

健康检查：

```bash
curl http://127.0.0.1:3100/health
```

按上一个稳定镜像 tag 回滚后重新拉起服务：

```bash
docker compose up -d api worker
```
