# Admin API Spec

## 1. 文档目标

本文档只描述 Zook 项目内部使用的后台与运营接口。

适用对象：

1. Admin Web 前端开发
2. 后端维护者
3. 运营后台功能联调

不面向外部 App 接入方。对外接入请看：

- [README_API.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/README_API.md)

## 2. 路径约定

后台接口统一挂在：

```text
/api/v1/admin/...
```

当前实现采用两类资源组织方式：

1. 全局后台能力：
   - `/api/v1/admin/auth/...`
   - `/api/v1/admin/bootstrap`
   - `/api/v1/admin/metrics/...`
   - `/api/v1/admin/sensitive-operations/...`
2. app 工作区能力：
   - `/api/v1/admin/apps/{appId}/...`
   - `common` 工作区固定写作 `/api/v1/admin/apps/common/...`

## 3. 当前已开放接口

### 3.1 Admin 会话与启动

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/auth/login` | 后台登录 |
| `POST` | `/api/v1/admin/auth/logout` | 后台登出 |
| `GET` | `/api/v1/admin/bootstrap` | 加载后台工作区、默认 app 与管理员上下文 |

### 3.2 敏感操作授权

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/sensitive-operations/request-code` | 创建当前会话的敏感操作校验上下文 |
| `POST` | `/api/v1/admin/sensitive-operations/verify` | 校验 6 位二级密码并授予 1 小时权限 |

说明：

1. 当前敏感操作不再发邮箱验证码
2. 当前实现使用固定 6 位二级密码
3. 前端复制密钥、密码值等敏感操作都复用这条链路

### 3.3 App 管理

| 方法 | Path | 说明 |
| --- | --- | --- |
| `POST` | `/api/v1/admin/apps` | 创建 app |
| `PUT` | `/api/v1/admin/apps/{appId}/names` | 更新多语言名称 |
| `DELETE` | `/api/v1/admin/apps/{appId}` | 删除 app |
| `POST` | `/api/v1/admin/apps/{appId}/log-secret/reveal` | 获取 app log secret 明文 |

说明：

1. `appId` 当前只允许小写字母、数字和下划线
2. `common` 是保留工作区，不能作为普通 app 删除

### 3.4 App 配置

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/config` | 获取当前配置 |
| `PUT` | `/api/v1/admin/apps/{appId}/config` | 更新配置 |
| `GET` | `/api/v1/admin/apps/{appId}/config/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/{appId}/config/revisions/{revision}/restore` | 恢复指定历史版本 |

当前 app 级配置键：

```text
admin.delivery_config
```

### 3.5 AINovel AI Routing

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/ai-routing` | 获取 `ai_novel.model_routing` 当前配置 |
| `PUT` | `/api/v1/admin/apps/{appId}/ai-routing` | 更新 `ai_novel.model_routing` |
| `GET` | `/api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/{appId}/ai-routing/revisions/{revision}/restore` | 恢复指定历史版本 |

当前只支持：

```text
appId = ai_novel
configKey = ai_novel.model_routing
```

### 3.6 App 级 i18n 设置

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/{appId}/i18n-settings` | 获取 i18n 设置 |
| `PUT` | `/api/v1/admin/apps/{appId}/i18n-settings` | 更新 i18n 设置 |
| `GET` | `/api/v1/admin/apps/{appId}/i18n-settings/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/{appId}/i18n-settings/revisions/{revision}/restore` | 恢复指定历史版本 |

### 3.8 Common 短信验证码观测

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/sms-verifications?appId={appId}` | 查看最近 7 天短信验证码记录，默认返回掩码元数据 |
| `POST` | `/api/v1/admin/apps/common/sms-verifications/{recordId}/reveal` | 通过敏感操作授权后查看验证码明文 |

说明：

1. 该页面属于 `common` 工作区分组下的固定能力。
2. 默认列表只返回掩码手机号、appid、场景、模式、状态、时间等元数据。
3. 验证码明文不会在列表中直接内联展示，只能通过 reveal 接口查看。
4. reveal 需要先走 `/api/v1/admin/sensitive-operations/request-code` + `/verify`。
5. 当前验证码明文只保留最近 7 天；worker 会在每天凌晨 4 点后执行一次硬删除清理。
6. 本期不支持 resend。

### 3.7 Common 邮件服务

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/email-service` | 获取邮件服务配置 |
| `PUT` | `/api/v1/admin/apps/common/email-service` | 更新邮件服务配置 |
| `POST` | `/api/v1/admin/apps/common/email-service/test-send` | 发送测试邮件 |
| `GET` | `/api/v1/admin/apps/common/email-service/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/email-service/revisions/{revision}/restore` | 恢复指定历史版本 |

### 3.8 Common Passwords

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/passwords` | 获取密码项列表（掩码） |
| `PUT` | `/api/v1/admin/apps/common/passwords` | 全量更新密码项 |
| `PUT` | `/api/v1/admin/apps/common/passwords/item` | 单项新增 / 更新 |
| `DELETE` | `/api/v1/admin/apps/common/passwords/{key}` | 删除密码项 |
| `POST` | `/api/v1/admin/apps/common/passwords/{key}/reveal` | 获取密码项明文 |

### 3.9 Common LLM 服务

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/apps/common/llm-service` | 获取 LLM 配置 |
| `PUT` | `/api/v1/admin/apps/common/llm-service` | 更新 LLM 配置 |
| `GET` | `/api/v1/admin/apps/common/llm-service/revisions/{revision}` | 获取指定历史版本 |
| `POST` | `/api/v1/admin/apps/common/llm-service/revisions/{revision}/restore` | 恢复指定历史版本 |
| `GET` | `/api/v1/admin/apps/common/llm-service/metrics` | 获取 LLM 聚合指标 |
| `GET` | `/api/v1/admin/apps/common/llm-service/metrics/models/{modelKey}` | 获取单模型指标 |
| `POST` | `/api/v1/admin/apps/common/llm-service/smoke-test` | 运行冒烟测试 |

### 3.10 Admin 指标

| 方法 | Path | 说明 |
| --- | --- | --- |
| `GET` | `/api/v1/admin/metrics/overview` | 概览指标 |
| `GET` | `/api/v1/admin/metrics/pages` | 页面指标 |

## 4. 关联文档

- [admin-web-design.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/admin-web-design.md)
- [current-backend-implementation-overview.md](/Users/zhoukai/.codex/worktrees/b0da/Zook/docs/current-backend-implementation-overview.md)
