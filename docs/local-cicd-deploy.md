# Local CI/CD Deployment

这个方案适用于：

1. 同一台 Linux 服务器既负责 `git pull / docker build`，也直接承载线上容器。
2. 有一个常驻的 webhook 服务负责验签、筛分支、执行仓库里的部署脚本。
3. 接受短时间重建容器带来的秒级中断，但需要失败自动回滚。

## 核心思路

只保留一条部署链路：

1. webhook 收到推送事件。
2. CICD 服务校验 `repo / branch / signature`。
3. CICD 服务只执行一个命令：

```bash
python3 build_scripts/build_and_push_docker.py --branch <branch> --commit <commit_sha>
```

4. 仓库内脚本自己完成：
   - 获取部署锁
   - `git fetch` + `git checkout`
   - 本地 `docker build`
   - `docker compose up -d`
   - `/api/health` 和 Admin Web `/setup` 健康检查
   - 失败回滚到上一个成功版本
   - 成功后保留少量最近镜像并清理更早的旧镜像

这个方案有两个关键约束：

1. CICD 服务不要再自己做 `git pull`、`docker build`、`docker run`。
2. CICD 服务不要再按“latest 镜像”部署，必须传 webhook 里的明确 commit SHA。

## 仓库内新增文件

1. [compose.yaml](/Users/zhoukai/Projects/AI/codex/Zook/compose.yaml)
2. [build_scripts/build_and_push_docker.py](/Users/zhoukai/Projects/AI/codex/Zook/build_scripts/build_and_push_docker.py)
3. [build_scripts/deploy.local.env.example](/Users/zhoukai/Projects/AI/codex/Zook/build_scripts/deploy.local.env.example)

## 双环境约定

这套方案现在支持同机双槽位部署。推荐直接约定：

1. `release-online -> slot=online -> COMPOSE_PROJECT_NAME=zook-online -> HOST_PORT=3100 -> ADMIN_HOST_PORT=3110`
2. `release-dev -> slot=dev -> COMPOSE_PROJECT_NAME=zook-dev -> HOST_PORT=3101 -> ADMIN_HOST_PORT=3111`

仓库里已经提供了两个示例配置文件：

1. [deploy_configs/online.env.example](/Users/zhoukai/Projects/AI/codex/Zook/deploy_configs/online.env.example)
2. [deploy_configs/dev.env.example](/Users/zhoukai/Projects/AI/codex/Zook/deploy_configs/dev.env.example)

服务端建议复制成真实运行文件：

```bash
cp deploy_configs/online.env.example deploy_configs/online.env
cp deploy_configs/dev.env.example deploy_configs/dev.env
```

然后把各自环境变量补齐。`online.env` 和 `dev.env` 现在都会同时承担两件事：

1. 作为部署脚本的参数来源
2. 作为容器运行时的 `env_file`

容器网络统一使用 Docker 默认 bridge 网络。若 Redis / PostgreSQL 部署在宿主机上，
请在 `REDIS_URL` / `DATABASE_URL` 中使用 `host.docker.internal`，并确保宿主机服务
监听的是容器可达地址，而不是只监听 `127.0.0.1`。

默认还支持这两个清理参数：

```text
DEPLOY_KEEP_RELEASES=5
DEPLOY_BUILDER_PRUNE_UNTIL=168h
```

## 服务器准备

建议在服务器上只保留一个仓库目录，例如：

```bash
/home/ubuntu/app/zook
```

不要再为不同分支维护不同目录。分支和 commit 由部署脚本自己切换。

先准备运行环境：

```bash
cd /home/ubuntu/app/zook
cp deploy_configs/online.env.example deploy_configs/online.env
cp deploy_configs/dev.env.example deploy_configs/dev.env
```

然后分别把 `deploy_configs/online.env` 和 `deploy_configs/dev.env` 中的业务配置补齐。

确保服务器上已经安装并可直接执行：

```bash
git
docker
docker compose
python3
```

## 手工发布命令

发布某个分支最新代码：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --slot online --env-file deploy_configs/online.env --app-env-file deploy_configs/online.env
```

发布 webhook 指定的某次提交：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-online --commit <commit_sha> --slot online --env-file deploy_configs/online.env --app-env-file deploy_configs/online.env
```

发布 dev 槽位：

```bash
python3 build_scripts/build_and_push_docker.py --branch release-dev --commit <commit_sha> --slot dev --env-file deploy_configs/dev.env --app-env-file deploy_configs/dev.env
```

本地演练但不真正部署：

```bash
python3 build_scripts/build_and_push_docker.py --branch main --skip-git-sync --allow-dirty --dry-run
```

## 脚本做了什么

部署脚本会按下面顺序执行：

1. 获取 `.deploy/deploy.lock` 文件锁，避免同一个 Git 工作区并发部署。
2. `git fetch origin --tags`
3. `git checkout -B <branch> <commit or origin/branch>`
4. 根据 `branch + version + shortsha` 生成本地镜像 tag。
5. 本地构建镜像。
6. 按槽位写入 `.deploy/<slot>/compose.env`
7. 使用新镜像执行 `node --experimental-transform-types src/infrastructure/database/postgres/migrate.ts`，迁移优先读取 `DIRECT_URL`，并按顺序重放所有幂等 SQL 脚本
8. 只有迁移成功才继续执行 `docker compose up -d --force-recreate --remove-orphans`
9. 轮询 `http://127.0.0.1:<port>/<health_path>`，同时检查 Admin Web 的 `http://127.0.0.1:<admin_port>/<admin_health_path>`
10. 如果健康检查通过，则写 `.deploy/<slot>/deploy_state.json`
11. 成功后默认保留最近 `5` 个本地发布镜像，并额外保留各槽位当前与上一个回滚点
12. 成功后再执行一次温和的 `docker builder prune`
13. 如果健康检查失败，则收集日志并回滚到上一个成功版本

## CICD 服务怎么改

现有 webhook 服务最需要改的是：

1. 不要再自己执行 `git pull`、`python3 deployDocker.py`、`python3 runDocker.py`
2. 不要再按分支去查“最新镜像”
3. 直接把 webhook 里的 commit SHA 传给仓库内脚本

你现在的逻辑：

```text
git pull -> deployDocker.py -> runDocker.py -> prune
```

建议改成：

```text
verify webhook -> exec build_and_push_docker.py --branch <branch> --commit <sha>
```

推荐的命令行应该是：

```bash
cd /home/ubuntu/app/zook && python3 build_scripts/build_and_push_docker.py --branch release-online --commit <commit_sha> --slot online --env-file deploy_configs/online.env --app-env-file deploy_configs/online.env
```

如果你的 CICD 服务仍然是 Node/Express，可以把执行命令收敛成这种形式：

```ts
const repo = req.body?.repository?.name;
const branch = req.body?.ref?.split('/')?.pop();
const commitSha = req.body?.after || req.body?.head_commit?.id;

const repoPathByName: Record<string, string> = {
  zook: '/home/ubuntu/app/zook',
};

const supportBranchByRepo: Record<string, string[]> = {
  zook: ['release-online', 'release-dev'],
};

if (!repo || !branch || !commitSha) {
  return waitAndSend(res, 'cannot find repo / branch / commit in webhook payload', false);
}

if (!repoPathByName[repo]) {
  return waitAndSend(res, `unsupported repo: ${repo}`, false);
}

if (!supportBranchByRepo[repo]?.includes(branch)) {
  return waitAndSend(res, `unsupported branch: ${branch}`, false);
}

const repoPath = repoPathByName[repo];
const command =
  `cd ${repoPath} && ` +
  `python3 build_scripts/build_and_push_docker.py --branch ${branch} --commit ${commitSha}`;

res.status(202).send(`deployment accepted for ${repo}@${branch} ${commitSha}`);
execCommand(command, (code, out) => {
  sendEmail(code === 0, out, repo, branch, date, pusher, Date.now() - start);
});
```

如果你沿用我刚改好的 cicd 服务，新的本地部署接口会默认使用下面这套分支映射：

1. `release-online -> slot=online -> deploy_configs/online.env`
2. `release-dev -> slot=dev -> deploy_configs/dev.env`

如果服务器上的实际路径不一样，可以在 cicd 服务的环境变量里覆盖：

```bash
LOCAL_DEPLOY_REPO_PATH_ZOOK=/home/ubuntu/app/zook
LOCAL_DEPLOY_SCRIPT_PATH_ZOOK=build_scripts/build_and_push_docker.py
LOCAL_DEPLOY_ENV_FILE_ZOOK_ONLINE=deploy_configs/online.env
LOCAL_DEPLOY_APP_ENV_FILE_ZOOK_ONLINE=deploy_configs/online.env
LOCAL_DEPLOY_ENV_FILE_ZOOK_DEV=deploy_configs/dev.env
LOCAL_DEPLOY_APP_ENV_FILE_ZOOK_DEV=deploy_configs/dev.env
```

### 签名校验建议

如果接 GitHub webhook，建议改成校验 `X-Hub-Signature-256`，并且使用原始 request body 做 HMAC，不要先 `JSON.parse` 再 `JSON.stringify`。

如果当前主要是 Gitee，可以继续用 `X-Gitee-Token == secret` 这一套最简方案。

## Git Webhook 如何配置

### Gitee

仓库设置里添加 WebHook：

1. `URL`
   - `http://<your-server>:3000/api/git/local-deploy`
2. `密码 / Secret`
   - 填你 CICD 服务中的 `SECRET`
3. 触发事件
   - 只勾选 `Push`
4. 内容类型
   - `application/json`

Gitee 推送时会带 `X-Gitee-Token`，你的服务只需要验证它是否等于 `SECRET`。

### GitHub

仓库 `Settings -> Webhooks -> Add webhook`

1. `Payload URL`
   - `http://<your-server>:3000/api/git/local-deploy`
2. `Content type`
   - `application/json`
3. `Secret`
   - 填你 CICD 服务中的 `SECRET`
4. `Which events would you like to trigger this webhook?`
   - 只选 `Just the push event`

GitHub 侧建议使用：

1. `X-Hub-Signature-256`
2. `X-GitHub-Event=push`

## 为什么这套更稳

因为它把原来最容易出错的两个点去掉了：

1. 不再通过“找最新镜像”来猜本次应该部署哪个版本。
2. 不再把构建逻辑和运行逻辑拆成两个互相耦合的脚本。

最终变成：

```text
一次 webhook = 一次明确 commit 的部署事务
```

这是同机构建、同机发布场景下最简单也最稳的一种做法。
