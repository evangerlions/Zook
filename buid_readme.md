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
