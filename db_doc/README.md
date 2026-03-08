# DB Doc

这个目录现在只服务一个目标场景：

同一台机器同时承载 `dev` 和 `online` 两套运行环境。

基于这个场景，当前采用的最简方案是：

1. `PostgreSQL` 只启动一个实例。
2. `PostgreSQL` 里创建两个数据库：
   `zook_dev`
   `zook_online`
3. `Redis` 启动两个独立实例。
4. `Redis dev` 和 `Redis online` 使用不同端口。
5. 所有服务默认只监听本机地址 `127.0.0.1` / `::1`，不对公网开放。

## 文件说明

1. `postgres_single_host_dual_env.md`
   单机双环境下 PostgreSQL 的配置说明。
2. `redis_single_host_dual_env.md`
   单机双环境下 Redis 的配置说明。
3. `scripts/setup_common.py`
   PostgreSQL 和 Redis 安装脚本共用的 Python 工具函数。
4. `scripts/setup_postgres_dual_env.py`
   安装并配置一个 PostgreSQL 实例，同时创建 `dev` 和 `online` 两套数据库与账号。
5. `scripts/setup_redis_dual_env.py`
   安装并配置两个 Redis 实例，同时创建 `dev` 和 `online` 两套连接配置，并支持自动重启。
6. `generated/`
   脚本生成的连接配置文件和密码文件，不提交到 Git。

## 推荐拓扑

### PostgreSQL

一个服务，一个端口：

```text
postgresql
└── 5432
    ├── zook_dev
    └── zook_online
```

### Redis

两个服务，两个端口：

```text
redis-online -> 6379 (maxmemory 0, noeviction)
redis-dev    -> 6380 (maxmemory 128mb, allkeys-lru)
```

## 直接使用

```bash
python3.14 db_doc/scripts/setup_postgres_dual_env.py
python3.14 db_doc/scripts/setup_redis_dual_env.py
```

这两个脚本都会在每个关键阶段打印步骤日志，所以安装、重启、验证时不会像“卡住”。

## 生成结果

执行完成后会得到这几份文件：

1. `db_doc/generated/dev/postgres.env`
2. `db_doc/generated/online/postgres.env`
3. `db_doc/generated/dev/redis.env`
4. `db_doc/generated/online/redis.env`

把同环境的 PostgreSQL 和 Redis 配置合并后，就可以给应用直接使用。

## 自动启动

脚本已经把“服务器重启后自动恢复”考虑进去了：

1. `PostgreSQL`
   macOS 使用 `brew services`
   Linux 使用 `systemctl enable`
2. `Redis`
   macOS 使用 `launchctl`
   Linux 使用自定义 `systemd` service
