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

支付宝不再配置 `ALIPAY_AI_NOVEL_ENVIRONMENT` 或两个密钥路径 env 字段。支付环境权限
只从可信部署身份派生：`DEPLOY_SLOT` 优先于 `APP_ENV`，local/dev/test 支持正式与沙箱，
online/未知环境只支持正式。部署脚本按实际部署槽位生成 `api`、`worker` 的只读挂载；
`admin-web` 不挂载密钥。既有 env 文件中的旧三个支付宝字段应删除。

宿主机使用部署用户的固定 Secret 目录：

- 正式：`~/.zook/secrets/ainovel-alipay/production`
- 沙箱：`~/.zook/secrets/ainovel-alipay/sandbox`

每个目录保留 `app-private-key.pem`、`alipay-public-key.pem`，分别映射到容器的
`/run/secrets/ainovel-alipay/{production|sandbox}/`。online 从不挂载沙箱目录；dev 可同时
挂载两套已有凭证。同一部署的两种支付环境共用一份后台价格，不新增 env 字段或开关。

文件必须能被容器的 `node` 用户（UID 1000）读取；密钥不进入仓库或镜像。未提供某环境
目录时，该环境不能新下单；已提供目录却缺少文件或不可读时部署失败。脚本不会自动创建
空密钥目录。挂载配置生成在 `.deploy/<slot>/alipay-keys.compose.json`，供正常部署、回滚
和 Grow 发布快照共用。完全未提供支付宝 Secret 的部署不增加挂载。

本地开发直接使用 `npm run dev`，加载已有 `deploy_configs/local.env` 的缺省配置，默认
`APP_ENV=local`，不再使用专门的沙箱启动参数/配置文件。本机使用同样的
`~/.zook/secrets/ainovel-alipay/{production|sandbox}/` 布局。正式支付在本地通过验签查询
与补单确认，不伪造公网通知地址。首次升级目录布局前，先将既有密钥安全迁移到上述位置；
不更换密钥，不把 PEM 内容写入 env。旧版发布的自动任务可能仍加载旧部署脚本：等待其
完成后，再按本文已有显式部署命令运行新脚本，核对两套目标路径及只读挂载。

首次跨密钥布局升级前，保留旧 env 和完整渲染的 Compose 快照（包含凭证时必须以
0600 权限存放在仓库外的私密备份目录）。旧单环境镜像依赖原三个 env 字段及平铺
容器路径；回退时必须同时恢复对应 env 与挂载快照，不能只切回旧镜像。常规健康检查
成功不代表旧镜像的支付密钥可读，跨布局回退后还须检查支付目录及查询签名。

容器网络统一使用 Docker 默认 bridge 网络。若 Redis / PostgreSQL 部署在宿主机上，
请在 `REDIS_URL` / `DATABASE_URL` 中使用 `host.docker.internal`，并确保宿主机服务
监听的是容器可达地址，而不是只监听 `127.0.0.1`。

默认还支持这两个清理参数：

```text
DEPLOY_KEEP_RELEASES=5
DEPLOY_BUILDER_PRUNE_UNTIL=168h
```

## FrogSleep 发布前置条件

`release-dev` 和 `release-online` 对应的 `DEPLOY_SLOT=dev|online` 会默认启用 FrogSleep；如果需要显式覆盖，可以在槽位 env 中设置 `FROGSLEEP_ENABLED=true` 或 `FROGSLEEP_ENABLED=false`。FrogSleep 外部 App / H5 / Web 客户端必须使用 canonical `/api/v1/frogsleep/*` 路径，根 `/v1/*` 只作为服务端内部归一化路径，不作为线上联调合同。

发布 FrogSleep 前确认：

1. `DATABASE_URL` / `DIRECT_URL` 指向目标槽位 PostgreSQL，且迁移脚本会执行到 `src/infrastructure/database/postgres/migrations/006_frogsleep_app.sql`。
2. `REDIS_URL` 指向目标槽位 Redis；API、Worker 和通知队列必须连接同一槽位的 Redis。
3. API 和 Worker 都使用同一个槽位 env 文件启动，避免 API 接受请求但 Worker 不能分发 FrogSleep push。
4. iOS push 需要补齐 APNs 变量：`APNS_KEY_ID`、`APNS_TEAM_ID`、`APNS_BUNDLE_ID` 或 `APNS_TOPIC`、`APNS_PRIVATE_KEY_PATH`；online 槽应设置 `APNS_SANDBOX=false`。
5. 发布前跑后端门禁：`npm run check:line-count`、FrogSleep focused tests、`openspec validate --changes --strict`。
6. 发布后记录目标 URL 的 `/api/health` 响应版本，并运行 canonical smoke：

```bash
ZOOK_BASE_URL=https://app.youwoai.net \
SMOKE_A_EMAIL=alice@example.com SMOKE_A_PASSWORD=Password1234 \
SMOKE_B_EMAIL=bob@example.com SMOKE_B_PASSWORD=Password1234 \
SMOKE_C_EMAIL=charlie@example.com SMOKE_C_PASSWORD=Password1234 \
npm run smoke:frogsleep-zook
```

如果线上 QA 账号不同，用真实保留账号替换 `SMOKE_*`。需要验证过期邀请时，再额外设置 `SMOKE_EXPIRED_INVITE_DB_MUTATION=1` 和目标库的 `SMOKE_DATABASE_URL` / `DATABASE_URL`。

## 服务器准备

建议在服务器上只保留一个仓库目录，例如：

```bash
/home/ubuntu/app/Zook
```

不要再为不同分支维护不同目录。分支和 commit 由部署脚本自己切换。

先准备运行环境：

```bash
cd /home/ubuntu/app/Zook
cp deploy_configs/online.env.example deploy_configs/online.env
cp deploy_configs/dev.env.example deploy_configs/dev.env
sudo mkdir -p /var/lib/zook/appRunData
sudo chmod -R 777 /var/lib/zook/appRunData
```

Docker Desktop 或其他无法写入 `/var/lib` 的开发机，可在槽位环境中设置
`ZOOK_APP_RUN_DATA_HOST_PATH` 为宿主机可写目录；容器内路径仍固定为
`/app/appRunData`。

然后分别把 `deploy_configs/online.env` 和 `deploy_configs/dev.env` 中的业务配置补齐。

持久化运行目录固定为：

- 宿主机：`/var/lib/zook/appRunData`
- 容器内：`/app/appRunData`

`api` / `worker` 会通过 bind mount 共享这一目录。启动前会先执行文件系统冒烟测试：覆盖写入 `/app/appRunData/hello_world.txt` 并立即读回；如果失败，容器会直接启动失败，部署脚本按现有健康检查失败链路处理。

确保服务器上已经安装并可直接执行：

```bash
git
docker
docker compose
python3
```

## 手工发布命令

### 部署脚本有更新时的首次发布

当前部署入口会先加载 Python 脚本，再在同一进程里切换 Git checkout；切换代码
不会重新加载已经运行的部署脚本。新增密钥挂载等部署逻辑时，必须先准备服务器 checkout，
再触发 release webhook，确保首次发布就执行新脚本。

先将待发布功能合回并推送 `origin/main`，记录已验证的 main SHA。确认服务器没有进行中的
部署且 checkout 干净，然后在服务器执行：

```bash
cd /home/ubuntu/app/Zook
git fetch origin --tags
git checkout --detach <已验证的_origin/main_SHA>
```

这一步更新部署脚本及其依赖模块，现有容器继续运行。随后在本地按仓库发布规范执行
`./release_dev.sh`；webhook 或下面的手工命令必须使用它生成的 `release-dev` SHA。
不得把功能分支直接作为 release 来源。

### 执行部署

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
cd /home/ubuntu/app/Zook && python3 build_scripts/build_and_push_docker.py --branch release-online --commit <commit_sha> --slot online --env-file deploy_configs/online.env --app-env-file deploy_configs/online.env
```

如果你的 CICD 服务仍然是 Node/Express，可以把执行命令收敛成这种形式：

```ts
const repo = req.body?.repository?.name;
const branch = req.body?.ref?.split('/')?.pop();
const commitSha = req.body?.after || req.body?.head_commit?.id;

const repoPathByName: Record<string, string> = {
  zook: '/home/ubuntu/app/Zook',
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
LOCAL_DEPLOY_REPO_PATH_ZOOK=/home/ubuntu/app/Zook
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
