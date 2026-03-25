# Admin Web Design

## 1. 目标

当前后台是一个收敛后的管理台，核心只做三类事情：

1. 管理 App 列表
2. 编辑 App 级 JSON 配置
3. 管理 Common 级公共配置与监控

本期公共配置包含两块：

1. 邮件服务 `common.email_service`
2. LLM 服务 `common.llm_service`

---

## 2. 页面结构

```text
Admin Web
├── Sidebar
│   ├── 应用
│   ├── 配置
│   ├── 邮件服务
│   └── LLM
├── Topbar
│   ├── 工作区切换
│   ├── Analytics
│   ├── Logs
│   └── 当前管理员用户名
└── Main Content
    ├── /apps   -> App 总控页
    ├── /config -> App JSON 配置页
    ├── /mail   -> Common 邮件服务页
    └── /llm    -> Common LLM 配置与监控页
```

设计原则：

1. 左侧导航只保留必要入口
2. 顶部只做全局切换和跳转
3. 主内容区一页只做一件事
4. 配置操作优先使用固定结构表单，不依赖手写 JSON

---

## 3. 工作区模型

后台有两类工作区：

1. 普通 App 工作区
2. 保留工作区 `common`

约束如下：

1. `common` 用于承载平台公共配置
2. `common` 不能删除
3. `/mail` 和 `/llm` 固定属于 `common`
4. `/config` 只服务于普通 App

---

## 4. 页面功能

### 4.1 应用页

应用页负责：

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

支持：

1. 读取
2. 校验 JSON
3. 格式化
4. 保存
5. 查看历史版本
6. 恢复历史版本

### 4.3 邮件服务页

邮件服务页挂在 `common` 工作区下，当前用于配置腾讯云 SES。

交互原则：

1. 使用固定表单
2. 支持版本记录与恢复
3. 敏感字段读取时自动掩码

### 4.4 LLM 页

LLM 页挂在 `common` 工作区下，分成两个标签：

1. `监控`
2. `配置`

#### 监控标签

展示按小时聚合的 LLM 监控数据：

1. 最近 24 小时总请求量
2. 成功率
3. 平均首字节延迟
4. 平均总耗时
5. 模型对比
6. 模型下各供应商对比

支持范围切换：

1. `24h`
2. `7d`
3. `30d`

#### 配置标签

编辑配置键：

```text
common.llm_service
```

配置结构固定为：

1. 全局设置
2. 供应商列表
3. 模型列表
4. 模型下 route 列表
5. 只读 JSON 展开区

交互规则：

1. 供应商、模型、route 全部通过弹窗增删改
2. 每个字段下方直接展示 helper text
3. route 支持上移和下移
4. 启用 route 的权重和会实时提示
5. 保存前必须填写更新说明
6. 支持历史版本查看和恢复

---

## 5. LLM 配置模型

`common.llm_service` 使用固定结构：

```json
{
  "enabled": true,
  "defaultModelKey": "kimi2.5",
  "providers": [
    {
      "key": "bailian",
      "label": "阿里云百炼",
      "enabled": true,
      "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
      "apiKey": "mock-bailian-api-key",
      "timeoutMs": 30000
    }
  ],
  "models": [
    {
      "key": "kimi2.5",
      "label": "Kimi 2.5",
      "strategy": "auto",
      "routes": [
        {
          "provider": "bailian",
          "providerModel": "kimi/kimi-k2.5",
          "enabled": true,
          "weight": 100
        }
      ]
    }
  ]
}
```

### 5.1 路由策略

只保留两种：

1. `auto`
2. `fixed`

含义：

1. `auto`：按 `weight × 健康分` 计算实际分流概率
2. `fixed`：固定选择 `weight` 最大的启用 route

### 5.2 健康度规则

健康度只用于 `auto`：

1. 总调用数 `< 10` 时，健康分固定为 `100`
2. 总调用数 `>= 10` 时，健康分 = 最近 `100` 次结果成功率

说明：

1. 这样可以避免低样本阶段波动过大
2. `fixed` 仍然完全按人工配置走，不会因为健康分变化自动切换

### 5.3 权重规则

1. `weight` 表示基础流量比例
2. 启用 route 的权重和必须等于 `100`
3. `weight` 最多保留两位小数

---

## 6. 版本管理

后台版本管理规则统一如下：

1. 保存时生成新 revision
2. revision 记录变更说明
3. 历史版本支持只读查看
4. 恢复历史版本时会生成一个新的 revision

这套机制已经同时用于：

1. App 配置页
2. 邮件服务页
3. LLM 配置页

---

## 7. API 设计

### 7.1 后台基础接口

1. `GET /api/v1/admin/bootstrap`
2. `POST /api/v1/admin/apps`
3. `DELETE /api/v1/admin/apps/{appId}`
4. `GET /api/v1/admin/apps/{appId}/config`
5. `PUT /api/v1/admin/apps/{appId}/config`

### 7.2 Common 邮件服务接口

1. `GET /api/v1/admin/apps/common/email-service`
2. `PUT /api/v1/admin/apps/common/email-service`
3. `GET /api/v1/admin/apps/common/email-service/revisions/{revision}`
4. `POST /api/v1/admin/apps/common/email-service/revisions/{revision}/restore`

### 7.3 Common LLM 接口

1. `GET /api/v1/admin/apps/common/llm-service`
2. `PUT /api/v1/admin/apps/common/llm-service`
3. `GET /api/v1/admin/apps/common/llm-service/revisions/{revision}`
4. `POST /api/v1/admin/apps/common/llm-service/revisions/{revision}/restore`
5. `GET /api/v1/admin/apps/common/llm-service/metrics?range=24h|7d|30d`
6. `GET /api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}?range=24h|7d|30d`

---

## 8. 持久化

当前后台状态依赖 Redis-backed `KVManager`。

持久化内容包括：

1. `apps`
2. `roles`
3. `rolePermissions`
4. `appConfigs`
5. 配置版本记录
6. LLM 健康窗口
7. LLM 小时级监控桶

其中：

1. 健康窗口只保留最近 `100` 次结果
2. 小时级监控只保留最近 `1` 年

---

## 9. 前端交互原则

本期后台 UI 原则：

1. 固定结构
2. 低认知负担
3. 字段说明可见
4. 版本历史清晰
5. 监控与配置分区明确

具体约束：

1. 不把复杂 Common 配置直接暴露成大 JSON 编辑器
2. 重要字段说明直接放在字段下方，不依赖 tooltip
3. 敏感字段读取时自动掩码
4. 所有保存操作都要求更新说明

---

## 10. 后续演进

后续可继续扩展：

1. 为 LLM 增加连接测试
2. 为 LLM 增加主动健康检查
3. 为 LLM 监控增加更多维度
4. 为 JSON 配置增加 schema 校验
5. 把小时级监控能力复用到短信、支付、文件服务
