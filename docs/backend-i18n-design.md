# 服务端多语言文本方案（Server-driven Text i18n）

> Version: v1.0
>
> Last Updated: 2026-03-28
>
> Scope: 仅讨论“服务端下发给客户端的文本”如何支持多语言，不包含客户端静态 UI 文案、本地包内 i18n、实时翻译、语音 ASR/TTS。

## 0. 一句话结论

采用“业务文案就地存储 + 公共文案集中存储 + 统一 locale 解析与 fallback 工具”的方案。

核心原则：

1. 客户端固定 UI 文案放客户端，不放服务端。
2. 服务端动态文本按业务对象就地存储，不强行集中到一个总文件。
3. 只有跨业务复用的公共文案，才进入共享消息字典。
4. 所有读取逻辑统一走一套 locale 解析和 fallback 规则。

## 1. 设计目标

本方案希望解决以下问题：

1. 同一套后端同时服务多个业务模块时，文本多语言不能越长越乱。
2. 新业务接入时，不需要重新设计一套 i18n 存储。
3. 返回给客户端的文本必须有稳定、可预测的 fallback 行为。
4. 后台和运营侧需要能维护一部分公共文案。
5. 数据模型和接口命名要足够简单，避免一上来做成“大而全国际化平台”。

## 2. 设计边界

### 2.1 本方案处理什么

1. 服务端接口返回的动态文本。
2. 服务端配置驱动的文案。
3. 后台可编辑的业务文案。
4. 共享错误文案、通知模板标题、状态展示名等公共文本。

### 2.2 本方案不处理什么

1. 客户端固定 UI 文案，例如按钮、Tab、设置页标题。
2. 运行时机器翻译。
3. 文案审核流程、翻译平台对接、TMS 集成。
4. 富文本排版规范。
5. 多媒体内容本地化。

## 3. 核心原则

### 3.1 统一的是规范，不是物理存储位置

不要追求“所有多语言都集中在一张表或一个文件里”。

真正需要统一的是：

1. locale 的来源和解析方式。
2. 多语言字段的命名规范。
3. fallback 的优先级。
4. 管理端和业务端的返回约定。

### 3.2 业务文案跟着业务对象走

如果一段文本属于某个具体业务对象，那么文本应直接跟该对象一起存储。

### 3.3 公共文案才集中管理

以下文案适合进入共享消息字典：

1. 跨多个业务模块复用的文案
2. 通用错误提示
3. 通用状态展示名
4. 公共系统通知标题
5. 公共协议、提示、引导段落

## 4. 总体方案

整体采用两层存储模型：

### 4.1 第一层：业务对象内嵌多语言字段

推荐把业务对象的可翻译字段直接存成 `jsonb`。

字段命名统一为：

1. `title_i18n`
2. `subtitle_i18n`
3. `description_i18n`
4. `content_i18n`
5. `placeholder_i18n`

推荐存储结构：

```json
{
  "zh-CN": "限时优惠",
  "en-US": "Limited Offer",
  "ja-JP": "期間限定オファー"
}
```

完整的默认 20 语种示例见 `5.4 示例文案（Welcome）`。

### 4.2 第二层：共享消息字典

对跨模块复用的公共文案，单独做共享消息表。

建议表名：

`i18n_messages`

推荐唯一约束：

1. `unique(app_id, namespace, message_key, locale)`

### 4.3 两层同时存在，不互相替代

1. 业务对象文案优先用内嵌字段
2. 共享复用文案才用字典表
3. 不追求所有文本最终都搬去字典表

## 5. locale 解析规范

项目里已经有 [request-email-context.service.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/services/request-email-context.service.ts) 的现成思路，可以抽象成通用的 `RequestLocaleService`。

### 5.1 推荐优先级

读取文本时，locale 解析优先级建议固定为：

1. 显式请求参数中的 `locale`
2. `X-App-Locale`
3. `Accept-Language`
4. 用户资料中的 `preferredLocale`
5. app 默认语言
6. 系统默认语言

### 5.2 locale 格式要求

统一使用 BCP 47 风格值：

1. `zh-CN`
2. `zh-TW`
3. `en-US`
4. `ja-JP`

统一在服务端做 normalize：

1. `zh_CN` 转成 `zh-CN`
2. `en-us` 转成 `en-US`
3. `zh-Hans` 可归一为 `zh-CN`
4. `zh-Hant` 可归一为 `zh-TW`

### 5.3 默认支持的 20 种语言

默认配置建议直接支持下面 20 个 locale，`defaultLocale` 固定为 `en-US`：

| 语言 | Locale | Direction |
| --- | --- | --- |
| 英语 | `en-US` | `ltr` |
| 中文（简体） | `zh-CN` | `ltr` |
| 中文（繁体） | `zh-TW` | `ltr` |
| 日语 | `ja-JP` | `ltr` |
| 西班牙语 | `es-ES` | `ltr` |
| 葡萄牙语 | `pt-BR` | `ltr` |
| 韩语 | `ko-KR` | `ltr` |
| 德语 | `de-DE` | `ltr` |
| 法语 | `fr-FR` | `ltr` |
| 印地语 | `hi-IN` | `ltr` |
| 印度尼西亚语 | `id-ID` | `ltr` |
| 意大利语 | `it-IT` | `ltr` |
| 土耳其语 | `tr-TR` | `ltr` |
| 越南语 | `vi-VN` | `ltr` |
| 泰语 | `th-TH` | `ltr` |
| 波兰语 | `pl-PL` | `ltr` |
| 荷兰语 | `nl-NL` | `ltr` |
| 瑞典语 | `sv-SE` | `ltr` |
| 孟加拉语 | `bn-BD` | `ltr` |
| 斯瓦希里语 | `sw-KE` | `ltr` |

说明：

1. 现代产品默认按横排界面处理，以上 20 种语言在客户端布局层统一按 `ltr` 处理。
2. 日语传统纵向排版属于更高阶排版能力，不纳入本方案默认支持范围。

### 5.4 示例文案（Welcome）

```json
{
  "en-US": "Welcome",
  "zh-CN": "欢迎",
  "zh-TW": "歡迎",
  "ja-JP": "ようこそ",
  "es-ES": "Bienvenido",
  "pt-BR": "Bem-vindo",
  "ko-KR": "환영합니다",
  "de-DE": "Willkommen",
  "fr-FR": "Bienvenue",
  "hi-IN": "स्वागत है",
  "id-ID": "Selamat datang",
  "it-IT": "Benvenuto",
  "tr-TR": "Hoş geldiniz",
  "vi-VN": "Chào mừng",
  "th-TH": "ยินดีต้อนรับ",
  "pl-PL": "Witamy",
  "nl-NL": "Welkom",
  "sv-SE": "Välkommen",
  "bn-BD": "স্বাগতম",
  "sw-KE": "Karibu"
}
```

## 6. fallback 规则

fallback 必须统一，不允许每个业务模块自己决定。

推荐顺序：

1. 精确 locale 命中
2. 语言级命中
3. app 默认 locale
4. 系统默认 locale
5. 任意第一个非空值

建议在 `app_configs` 中配置：

```json
{
  "defaultLocale": "en-US",
  "supportedLocales": [
    "en-US",
    "zh-CN",
    "zh-TW",
    "ja-JP",
    "es-ES",
    "pt-BR",
    "ko-KR",
    "de-DE",
    "fr-FR",
    "hi-IN",
    "id-ID",
    "it-IT",
    "tr-TR",
    "vi-VN",
    "th-TH",
    "pl-PL",
    "nl-NL",
    "sv-SE",
    "bn-BD",
    "sw-KE"
  ],
  "fallbackLocales": {
    "en-GB": ["en-US"],
    "es-MX": ["es-ES"],
    "es-AR": ["es-ES"],
    "pt-PT": ["pt-BR"],
    "fr-CA": ["fr-FR"],
    "zh-HK": ["zh-TW", "zh-CN"],
    "zh-MO": ["zh-TW", "zh-CN"],
    "zh-SG": ["zh-CN"],
    "bn-IN": ["bn-BD"],
    "sw-TZ": ["sw-KE"]
  }
}
```

配置 key 建议为：

`i18n.settings`

## 7. API 设计规范

### 7.1 写接口规范

管理端或业务创建接口，建议直接写入 `*_i18n` 字段。

### 7.2 读接口规范

面向客户端的普通业务接口，默认返回“已解析后的文本”，而不是原始多语言 map。

### 7.3 管理接口规范

面向后台编辑页时，可以返回完整的 `*_i18n`。

## 8. 公共工具层设计

建议增加一个独立的 `i18n` 公共模块，职责只做三件事：

1. 解析 locale
2. 选择文本
3. 批量本地化对象

## 9. 与当前仓库的结合方式

当前仓库里已有以下基础能力可以直接承接本方案：

1. [README_API.md](/Users/zhoukai/Projects/AI/codex/Zook/README_API.md) 中已经定义 `X-App-Locale`
2. [request-email-context.service.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/services/request-email-context.service.ts) 已有 locale normalize 和 header fallback 思路
3. [app-config.service.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/services/app-config.service.ts) 可直接承接 `i18n.settings`
4. [app.module.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/app.module.ts) 已有 admin config 路由范式，可扩展 i18n 配置读写

## 10. 最终推荐

1. 动态业务文本使用 `*_i18n jsonb`
2. 公共复用文本使用 `i18n_messages`
3. app 级统一配置使用 `app_configs.i18n.settings`
4. locale 和 fallback 统一由公共工具处理
5. 客户端接口默认只返回已本地化字段
