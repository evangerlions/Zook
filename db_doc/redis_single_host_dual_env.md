# Redis 单机双环境配置说明

## 1. 这份方案解决什么问题

你的场景是：

1. 只有一台服务器。
2. 这台服务器同时跑 `dev` 和 `online`。
3. 你想要简单，但是不想让 `dev` 影响 `online`。

在这个前提下，Redis 最合适的方案不是“一个实例两个逻辑库”，而是：

1. 同一台机器上运行两个 Redis 实例。
2. `online` 一个端口。
3. `dev` 一个端口。

也就是说：

```text
redis-online -> 6379
redis-dev    -> 6380
```

## 2. 为什么不是一个 Redis 实例 + 两个逻辑库

因为虽然那样更省一步配置，但对你这个项目不够稳妥。

如果共用一个 Redis 实例：

1. 内存是共享的。
2. 持久化配置是共享的。
3. 淘汰策略是共享的。
4. 一个实例异常，`dev` 和 `online` 一起受影响。

而你这个项目未来 Redis 不只是缓存，还会承载：

1. BullMQ 队列
2. 配置缓存
3. 可能的 token 黑名单

所以“两个实例、两个端口”是当前最简单但又不容易踩坑的方案。
同时把 `dev` 的内存上限主动压小，也能避免它在单机上挤占 `online` 的资源。

## 3. 最终结构

默认命名：

### 3.1 online Redis

1. 服务名：
   `redis-zook-online`
2. 端口：
   `6379`
3. 连接地址：
   `127.0.0.1`

### 3.2 dev Redis

1. 服务名：
   `redis-zook-dev`
2. 端口：
   `6380`
3. 连接地址：
   `127.0.0.1`

### 3.3 key 前缀

1. `online` 缓存前缀：
   `zook:online:cache`
2. `online` 队列前缀：
   `zook:online:bull`
3. `dev` 缓存前缀：
   `zook:dev:cache`
4. `dev` 队列前缀：
   `zook:dev:bull`

## 4. 最终连接方式

### 4.1 online 环境

```env
REDIS_URL=redis://:密码@127.0.0.1:6379/0
CACHE_PREFIX=zook:online:cache
BULLMQ_PREFIX=zook:online:bull
```

### 4.2 dev 环境

```env
REDIS_URL=redis://:密码@127.0.0.1:6380/0
CACHE_PREFIX=zook:dev:cache
BULLMQ_PREFIX=zook:dev:bull
```

## 5. 脚本会做什么

执行：

```bash
python3.14 db_doc/scripts/setup_redis_dual_env.py
```

脚本会自动完成：

1. 安装 Redis。
2. 创建 `online` 和 `dev` 两套实例配置。
3. 为两个实例分别生成密码。
4. 默认都只监听本机地址。
5. 为两个实例配置自动重启和开机启动。
6. 生成连接配置文件。
7. 在每个关键阶段打印日志，方便观察当前执行进度。

## 6. 两个环境的默认差异

### 6.1 online

`online` 默认更稳妥：

1. 端口 `6379`
2. `appendonly yes`
3. `appendfsync everysec`
4. `maxmemory 0`
5. `maxmemory-policy noeviction`

### 6.2 dev

`dev` 默认更轻：

1. 端口 `6380`
2. `appendonly no`
3. `maxmemory 128mb`
4. `maxmemory-policy allkeys-lru`

## 7. 生成的文件

脚本执行后会生成：

1. `db_doc/generated/dev/redis.env`
2. `db_doc/generated/online/redis.env`

分别包含：

1. `REDIS_URL`
2. 密码
3. 端口
4. `REDIS_MAXMEMORY`
5. `REDIS_MAXMEMORY_POLICY`
6. `CACHE_PREFIX`
7. `BULLMQ_PREFIX`

## 8. 服务器重启后怎么办

脚本已经把自动恢复做好了。

### 8.1 Linux 服务器

脚本会创建两个 systemd 服务：

1. `redis-zook-online.service`
2. `redis-zook-dev.service`

并执行：

```bash
sudo systemctl enable --now redis-zook-online.service
sudo systemctl enable --now redis-zook-dev.service
```

所以服务器重启后，这两个 Redis 会自动拉起。

常用命令：

```bash
systemctl status redis-zook-online.service
systemctl status redis-zook-dev.service
systemctl restart redis-zook-online.service
systemctl restart redis-zook-dev.service
```

### 8.2 macOS 本机

脚本会创建两个 LaunchAgent：

1. `com.zook.redis.online`
2. `com.zook.redis.dev`

这样重启电脑并重新登录后，也会自动恢复。

## 9. 为什么这已经足够简单

对你当前这个项目来说，Redis 只多做了一件事情：

1. 从“一份配置”变成“两份配置”

但换来的是：

1. `dev` 和 `online` 完整隔离
2. 线上不会被测试数据污染
3. `dev` 的内存被限制住，不容易挤占线上资源
4. 未来接 BullMQ 更稳

这已经是“简单”和“稳妥”之间很好的平衡点了。

## 10. 验证命令

验证 `online`：

```bash
redis-cli -h 127.0.0.1 -p 6379 -a 密码 ping
```

验证 `dev`：

```bash
redis-cli -h 127.0.0.1 -p 6380 -a 密码 ping
```

检查配置：

```bash
redis-cli -h 127.0.0.1 -p 6379 -a 密码 CONFIG GET appendonly
redis-cli -h 127.0.0.1 -p 6380 -a 密码 CONFIG GET appendonly
redis-cli -h 127.0.0.1 -p 6380 -a 密码 CONFIG GET maxmemory
redis-cli -h 127.0.0.1 -p 6380 -a 密码 CONFIG GET maxmemory-policy
```

## 11. 参考资料

1. Redis 官方安装入口：
   [https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/](https://redis.io/docs/latest/operate/oss_and_stack/install/install-stack/)
2. Redis 官方 Linux 安装：
   [https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-linux/](https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-linux/)
3. Redis 官方 macOS 安装：
   [https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-mac-os/](https://redis.io/docs/latest/operate/oss_and_stack/install/archive/install-redis/install-redis-on-mac-os/)
4. BullMQ 生产建议：
   [https://docs.bullmq.io/guide/going-to-production](https://docs.bullmq.io/guide/going-to-production)
