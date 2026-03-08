# PostgreSQL 单机双环境配置说明

## 1. 这份方案解决什么问题

你的场景是：

1. 只有一台服务器。
2. 这台服务器上同时运行 `dev` 和 `online` 两套环境。
3. 你不想把事情做复杂。

在这个前提下，最简单且足够稳妥的 PostgreSQL 方案是：

1. 只安装一个 PostgreSQL 服务。
2. 只开一个 PostgreSQL 端口，默认 `5432`。
3. 在这个实例里创建两个数据库：
   `zook_dev`
   `zook_online`
4. 每个环境分别使用自己的运行账号和迁移账号。

也就是说：

```text
一个 PG 服务
  -> 一个实例
  -> 两个数据库
  -> 四个账号
```

## 2. 为什么这个方案最适合现在

因为你的目标是“简单可用”，而不是“做成云厂商级别隔离”。

这个方案的优点：

1. 简单。
   只维护一个 PostgreSQL 服务。
2. 成本低。
   只占用一个 PostgreSQL 实例的资源。
3. 隔离已经足够。
   `dev` 和 `online` 分属不同数据库、不同账号。
4. 运维清晰。
   备份、监控、升级都只需要处理一个 PostgreSQL 服务。

## 3. 最终结构

默认命名如下：

### 3.1 数据库

1. `zook_dev`
2. `zook_online`

### 3.2 账号

1. `zook_dev_app`
2. `zook_dev_migrator`
3. `zook_online_app`
4. `zook_online_migrator`

### 3.3 端口

1. PostgreSQL 统一端口：`5432`

### 3.4 监听地址

默认只监听本机：

1. `127.0.0.1`
2. `::1`

这意味着：

1. 数据库不会直接暴露到公网。
2. 同机部署的 API / Worker 可以直接走本机连接。

## 4. 最终连接方式

### 4.1 dev 环境

运行时：

```env
DATABASE_URL=postgresql://zook_dev_app:密码@127.0.0.1:5432/zook_dev?schema=public
```

迁移：

```env
DIRECT_URL=postgresql://zook_dev_migrator:密码@127.0.0.1:5432/zook_dev?schema=public
```

### 4.2 online 环境

运行时：

```env
DATABASE_URL=postgresql://zook_online_app:密码@127.0.0.1:5432/zook_online?schema=public
```

迁移：

```env
DIRECT_URL=postgresql://zook_online_migrator:密码@127.0.0.1:5432/zook_online?schema=public
```

## 5. 脚本会做什么

执行：

```bash
python3.14 db_doc/scripts/setup_postgres_dual_env.py
```

脚本会自动完成：

1. 安装 PostgreSQL。
2. 启动 PostgreSQL。
3. 配置开机自启。
4. 配置只监听本机。
5. 配置 `pg_hba.conf`，只允许本机登录。
6. 创建 `dev` 和 `online` 两个数据库。
7. 创建每个环境的 `app` 和 `migrator` 账号。
8. 设置基本权限。
9. 生成连接配置文件。
10. 在每个关键阶段打印日志，方便观察当前执行进度。

## 6. 生成的文件

脚本执行后会输出：

1. `db_doc/generated/dev/postgres.env`
2. `db_doc/generated/online/postgres.env`

这两个文件分别包含：

1. 数据库名
2. 用户名
3. 密码
4. `DATABASE_URL`
5. `DIRECT_URL`

## 7. 服务器重启后怎么办

脚本已经把自动恢复做好了。

### 7.1 Linux 服务器

脚本会执行：

```bash
sudo systemctl enable --now postgresql
```

以后服务器重启后，PostgreSQL 会自动拉起。

常用命令：

```bash
systemctl status postgresql
systemctl restart postgresql
systemctl stop postgresql
systemctl start postgresql
```

### 7.2 macOS 本机

脚本会使用：

```bash
brew services start postgresql@16
```

这样重启电脑并重新登录后，也会自动恢复。

## 8. 为什么不拆成两个 PostgreSQL 实例

因为对你当前这个场景来说，没有必要。

拆成两个 PostgreSQL 实例的缺点：

1. 复杂度更高。
2. 配置更多。
3. 端口和配置文件更多。
4. 升级和备份更麻烦。

而你现在真正需要的只是：

1. `dev` 不污染 `online`
2. 配置简单
3. 能自动恢复

两个数据库已经足够满足这三个目标。

## 9. 安全建议

即使只有一台服务器，也建议保留这些做法：

1. PostgreSQL 只监听本机。
2. `dev` 和 `online` 使用不同账号。
3. `app` 和 `migrator` 使用不同账号。
4. 生产发布前备份 `zook_online`。

## 10. 验证命令

检查服务：

```bash
psql --version
```

验证 `dev`：

```bash
psql "postgresql://zook_dev_app:密码@127.0.0.1:5432/zook_dev"
```

验证 `online`：

```bash
psql "postgresql://zook_online_app:密码@127.0.0.1:5432/zook_online"
```

## 11. 参考资料

1. PostgreSQL 官方 `createuser`：
   [https://www.postgresql.org/docs/current/app-createuser.html](https://www.postgresql.org/docs/current/app-createuser.html)
2. PostgreSQL 官方 `createdb`：
   [https://www.postgresql.org/docs/current/app-createdb.html](https://www.postgresql.org/docs/current/app-createdb.html)
3. PostgreSQL 官方连接参数：
   [https://www.postgresql.org/docs/current/runtime-config-connection.html](https://www.postgresql.org/docs/current/runtime-config-connection.html)
4. PostgreSQL 官方 `pg_hba.conf`：
   [https://www.postgresql.org/docs/current/auth-pg-hba-conf.html](https://www.postgresql.org/docs/current/auth-pg-hba-conf.html)
