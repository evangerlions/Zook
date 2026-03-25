# Admin Web Design

## 1. 目标

当前后台是一个收敛后的配置管理台，不做运营平台，也不展示与配置下发无关的页面。

本期只聚焦三件事：

1. 管理 App 列表
2. 编辑 App 级 JSON 配置
3. 配置公共邮件服务

## 2. 页面结构

当前后台采用典型 Admin 布局：

```text
Admin Web
├── Sidebar
│   ├── 应用
│   ├── 配置
│   └── 邮件服务
├── Topbar
│   ├── 当前 App 切换
│   ├── Analytics
│   ├── Logs
│   └── 当前管理员用户名
└── Main Content
    ├── /apps   -> App 总控页
    ├── /config -> App JSON 配置页
    └── /mail   -> Common 邮件服务配置页
```

设计原则：

1. UI 只展示操作，不展示实现说明
2. 顶部是标准长条导航
3. 左侧导航只保留必要入口
4. 主内容区一页只做一件事

## 3. 工作区模型

后台引入两个工作区类型：

1. 普通 App 工作区
2. 保留工作区 `common`

其中：

1. `common` 用于承载平台公共配置
2. `common` 不能删除
3. 邮件服务配置固定挂在 `common`

## 4. 功能设计

### 4.1 应用页

应用页用于总控 App：

1. 新增 App
2. 查看 App 列表
3. 进入指定 App 的配置页
4. 删除 App

删除规则：

1. 只有当 `admin.delivery_config` 的内容是空对象 `{}` 时才允许删除
2. `common` 永远不可删除

### 4.2 配置页

配置页只编辑一个配置键：

```text
admin.delivery_config
```

支持操作：

1. 读取
2. 校验 JSON
3. 格式化
4. 恢复
5. 保存

保存要求：

1. 必须是合法 JSON
2. 根节点必须是 object
3. 服务端统一格式化为 2 空格缩进

### 4.3 邮件服务页

邮件服务页挂在 `common` 工作区下，当前配置腾讯云 SES。

表单项包括：

1. 是否启用
2. Region 模式：自动 / 手动
3. 手动地域
4. SecretId
5. SecretKey
6. 发件人地址
7. ReplyTo 地址
8. 验证码邮件主题
9. 模板 ID
10. 模板变量名
11. TriggerType

## 5. 邮件服务设计

当前邮件服务选型为腾讯云 SES。

依据官方接口：

1. 接口：`SendEmail`
2. 版本：`2020-10-02`
3. 域名：`ses.tencentcloudapi.com`
4. 可用地域：`ap-guangzhou`、`ap-hongkong`
5. 签名方式：`TC3-HMAC-SHA256`

地域选择策略：

1. `regionMode = manual` 时使用后台配置的地域
2. `regionMode = auto` 时自动推断
3. 当前默认规则是：
   1. 大陆时区优先 `ap-guangzhou`
   2. 其他情况回退 `ap-hongkong`
4. 可通过环境变量 `TENCENT_SES_REGION_HINT` 显式覆盖

当前邮件服务主要用于注册验证码发送。

## 6. API 设计

### 6.1 后台基础接口

1. `GET /api/v1/admin/bootstrap`
2. `POST /api/v1/admin/apps`
3. `DELETE /api/v1/admin/apps/{appId}`
4. `GET /api/v1/admin/apps/{appId}/config`
5. `PUT /api/v1/admin/apps/{appId}/config`
6. `GET /api/v1/admin/apps/common/email-service`
7. `PUT /api/v1/admin/apps/common/email-service`

### 6.2 认证方式

后台仍然使用 `admin-web` 自身的 Basic Auth 作为入口认证。

后台 API 也复用同一套 Basic Auth，不再引入业务用户二次登录。

## 7. 持久化设计

当前后台不再依赖纯内存状态。

可变管理数据会通过 Redis-backed `KVManager` 持久化。

当前持久化内容包括：

1. `apps`
2. `roles`
3. `rolePermissions`
4. `appConfigs`

这样可以保证：

1. Docker 重启后 App 列表仍然存在
2. `common` 邮件服务配置不会丢失
3. App 的 JSON 配置不会丢失

## 8. 部署约定

运行时默认依赖外部 Redis：

1. `REDIS_URL`
2. API / Worker 启动时会强检测 Redis 连通性
3. 如果配置了 `DATABASE_URL`，也会在启动时做强检测

这意味着：

1. 配置变更由 API 写入 Redis
2. Worker 重启后也能看到同一份状态

## 9. 前端设计原则

本期后台 UI 原则非常明确：

1. 简洁
2. 典型
3. 可读
4. 不解释实现细节

因此界面刻意删除了以下内容：

1. 心跳说明
2. 技术实现备注
3. 工作区说明文案
4. 指标页和无关卡片

## 10. 后续演进

后续可以继续扩展：

1. 为邮件服务增加连接测试
2. 为 JSON 配置增加 Schema 校验
3. 增加配置版本历史和回滚
4. 增加邮件模板管理
5. 如果以后接更多公共能力，可继续放到 `common` 工作区下
