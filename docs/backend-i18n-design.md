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

这是一套业界比较常见、也比较稳的折中方案：

1. 不会把所有业务都耦合到一个 i18n 中心表。
2. 不会让每个模块都发明一套自己的字段和 fallback 规则。
3. 能支持多 app、多业务线、逐步演进。

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

例如：

1. banner 标题
2. 活动副标题
3. onboarding 提示语
4. 权益说明
5. 角色介绍

这类文本不应该被拆进一个全局文案库，否则后续关联、权限、迁移、查询和回滚都会变复杂。

### 3.3 公共文案才集中管理

以下文案适合进入共享消息字典：

1. 跨多个业务模块复用的文案
2. 通用错误提示
3. 通用状态展示名
4. 公共系统通知标题
5. 公共协议、提示、引导段落

### 3.4 读时统一本地化，写时统一校验

无论文本来自业务表，还是来自共享字典，读取时都要走同一套工具：

1. 解析请求 locale
2. 选择最佳文本
3. 缺失时按规则 fallback

写入时也要走统一校验：

1. locale 是否合法
2. value 是否为空字符串
3. 是否满足默认语言要求

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

适用场景：

1. 文本和业务对象强绑定
2. 文本不会被大量跨模块复用
3. 文案更新通常跟业务对象一起发生

### 4.2 第二层：共享消息字典

对跨模块复用的公共文案，单独做共享消息表。

建议表名：

`i18n_messages`

推荐字段：

1. `id`
2. `app_id`
3. `namespace`
4. `message_key`
5. `locale`
6. `text`
7. `status`
8. `updated_at`

推荐唯一约束：

1. `unique(app_id, namespace, message_key, locale)`

适用场景：

1. `common.error.user_blocked`
2. `common.status.active`
3. `billing.plan.free.name`
4. `onboarding.welcome.title`

### 4.3 两层同时存在，不互相替代

这是整个方案最重要的取舍：

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

说明：

1. 面向普通业务接口时，建议以请求显式 locale 或 header 为准。
2. 用户资料中的 `preferredLocale` 更适合消息中心、邮件、系统通知等“被动触达”场景。
3. app 默认语言建议配置在 `app_configs` 中，例如 `i18n.default_locale`。

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

如果需要一个完整的默认示例，可以直接使用下面这份 `welcome_i18n`：

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

示例：

请求 locale 为 `en-GB`，文本中只有：

```json
{
  "en-US": "Welcome",
  "zh-CN": "欢迎使用"
}
```

则应返回 `Welcome`。

### 6.1 语言级命中的实现建议

语言级命中建议按下面顺序：

1. 先查是否存在 `en`
2. 再查是否存在同语言前缀的区域值，例如 `en-US`
3. 如果同语言有多个区域值，优先使用 app 配置的 fallback 映射

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

## 7. 数据建模建议

### 7.1 业务表字段规范

以 `campaigns` 为例：

```sql
create table campaigns (
  id text primary key,
  app_id text not null,
  title_i18n jsonb not null default '{}'::jsonb,
  subtitle_i18n jsonb not null default '{}'::jsonb,
  description_i18n jsonb not null default '{}'::jsonb,
  created_at timestamptz not null,
  updated_at timestamptz not null
);
```

建议：

1. 所有可翻译字段统一使用 `*_i18n`
2. 类型统一用 `jsonb`
3. 默认值统一 `{}`，避免空值判断过多

### 7.2 共享字典表规范

推荐模型：

```sql
create table i18n_messages (
  id text primary key,
  app_id text not null,
  namespace text not null,
  message_key text not null,
  locale text not null,
  text text not null,
  status text not null default 'ACTIVE',
  updated_at timestamptz not null
);

create unique index uq_i18n_messages_scope
  on i18n_messages(app_id, namespace, message_key, locale);
```

可选补充：

1. `created_at`
2. `updated_by`
3. `version`

如果后续要做复杂版本回滚，再考虑 revision 表；MVP 阶段不建议先做重。

### 7.3 不建议单独拆表的场景

以下情况不建议为了“规范化”把文本拆成子表：

1. 一个业务对象只有 2 到 5 个短文本字段
2. 文案更新频率低
3. 文案不参与复杂查询
4. 文案不需要被多个对象共享

这种场景 `jsonb` 反而是更稳妥的工程选型。

## 8. API 设计规范

### 8.1 写接口规范

管理端或业务创建接口，建议直接写入 `*_i18n` 字段。

示例：

```json
{
  "titleI18n": {
    "zh-CN": "限时优惠",
    "en-US": "Limited Offer"
  },
  "subtitleI18n": {
    "zh-CN": "新用户首月免费",
    "en-US": "First month free for new users"
  }
}
```

### 8.2 读接口规范

面向客户端的普通业务接口，默认返回“已解析后的文本”，而不是原始多语言 map。

示例：

```json
{
  "id": "banner_1",
  "title": "Limited Offer",
  "subtitle": "First month free for new users"
}
```

### 8.3 管理接口规范

面向后台编辑页时，可以返回完整的 `*_i18n`。

示例：

```json
{
  "id": "banner_1",
  "titleI18n": {
    "zh-CN": "限时优惠",
    "en-US": "Limited Offer"
  }
}
```

### 8.4 避免在同一个接口里混合两种语义

普通客户端接口建议返回：

1. `title`
2. `subtitle`
3. `description`

后台编辑接口建议返回：

1. `titleI18n`
2. `subtitleI18n`
3. `descriptionI18n`

不要默认同时把两套结构都返回给客户端，否则接口会很臃肿。

## 9. 公共工具层设计

建议增加一个独立的 `i18n` 公共模块，职责只做三件事：

1. 解析 locale
2. 选择文本
3. 批量本地化对象

### 9.1 建议的核心类型

```ts
export type I18nText = Record<string, string>;

export interface I18nSettings {
  defaultLocale: string;
  supportedLocales: string[];
  fallbackLocales?: Record<string, string[]>;
}
```

### 9.2 建议的核心函数

```ts
resolveRequestLocale(request): string
normalizeLocale(locale): string | undefined
pickI18nText(textMap, locale, settings): string
localizeFields(record, fieldNames, locale, settings): object
```

### 9.3 `pickI18nText` 的建议行为

```ts
function pickI18nText(
  value: Record<string, string> | undefined,
  locale: string,
  settings: I18nSettings,
): string {
  if (!value) {
    return "";
  }

  const exact = value[locale];
  if (exact) {
    return exact;
  }

  const configuredFallbacks = settings.fallbackLocales?.[locale] ?? [];
  for (const fallbackLocale of configuredFallbacks) {
    if (value[fallbackLocale]) {
      return value[fallbackLocale];
    }
  }

  const language = locale.split("-")[0];
  if (value[language]) {
    return value[language];
  }

  const sameLanguageKey = Object.keys(value).find((key) => key.split("-")[0] === language);
  if (sameLanguageKey) {
    return value[sameLanguageKey] ?? "";
  }

  if (value[settings.defaultLocale]) {
    return value[settings.defaultLocale] ?? "";
  }

  return Object.values(value).find((item) => item.trim()) ?? "";
}
```

### 9.4 批量对象本地化

推荐做一个轻量工具：

```ts
localizeFields(
  campaign,
  ["title", "subtitle", "description"],
  locale,
  settings,
)
```

其作用是：

1. 从 `title_i18n` 生成 `title`
2. 从 `subtitle_i18n` 生成 `subtitle`
3. 从 `description_i18n` 生成 `description`

这样每个业务 service 就不需要重复写映射代码。

## 10. 什么时候用内嵌字段，什么时候用共享字典

### 10.1 选内嵌字段

满足以下任意大多数条件时，优先用 `*_i18n jsonb`：

1. 文案属于单个业务对象
2. 文案不会跨很多模块复用
3. 文案由业务后台编辑
4. 文案和对象一起查询、一起更新

### 10.2 选共享字典

满足以下条件时，优先用 `i18n_messages`：

1. 同一文案在多个业务模块复用
2. 文案脱离具体业务对象存在
3. 文案需要按 namespace/key 管理
4. 文案适合做统一后台编辑

## 11. 缓存策略

### 11.1 业务对象文案

业务对象内嵌文案通常跟对象缓存一致，不需要单独再做 i18n 缓存层。

### 11.2 共享字典文案

共享字典适合按下面维度缓存：

1. `app_id + namespace + locale`
2. `app_id + message_key + locale`

TTL 可以先保持轻量，例如 30 秒到 5 分钟。

如果后续共享字典量变大，再引入：

1. namespace 级预热
2. revision 号失效
3. 按 locale 批量快照

## 12. 后台维护建议

### 12.1 app 级配置

建议先把 i18n 基础设置放入 `app_configs`：

1. `i18n.settings`
2. `i18n.enabled_locales`
3. `i18n.default_locale`

最简做法是只保留一个：

`i18n.settings`

配置内容示例可直接复用 `6.1` 中的默认配置。
默认 `defaultLocale = en-US`，`supportedLocales` 使用 `5.3` 中的 20 个 locale。

### 12.2 管理台编辑策略

管理端建议分两类页面：

1. 业务对象编辑页
2. 公共字典编辑页

不要把所有多语言都揉进一个“超级国际化页面”。

## 13. 查询、排序与搜索注意事项

这是 `jsonb` 方案最容易被忽视的地方。

### 13.1 不要让 `*_i18n` 承担复杂检索主职责

如果某个字段需要：

1. 高频搜索
2. 高频排序
3. 全文检索
4. 聚合统计

则不建议直接依赖 `jsonb` 中的多语言内容完成这些需求。

更稳妥的做法：

1. 保留 `*_i18n`
2. 额外维护 `title_default` 这类影子字段
3. 或者引入专门的搜索索引

### 13.2 客户端展示字段与后台检索字段分离

客户端需要的是“当前 locale 的最佳文本”。
后台运营常常需要的是“默认语言字段”做列表检索。

这两个目标不要混在一个字段设计里。

## 14. 与当前仓库的结合方式

### 14.1 可以直接复用的现有能力

当前仓库里已有以下基础能力可以直接承接本方案：

1. [README_API.md](/Users/zhoukai/Projects/AI/codex/Zook/README_API.md) 中已经定义 `X-App-Locale`
2. [request-email-context.service.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/services/request-email-context.service.ts) 已有 locale normalize 和 header fallback 思路
3. [versioned-app-config.service.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/services/versioned-app-config.service.ts) 可直接承接 `i18n.settings`
4. [app.module.ts](/Users/zhoukai/Projects/AI/codex/Zook/src/app.module.ts) 已有 admin config 路由范式，可扩展 i18n 配置读写

### 14.2 建议新增的模块

建议新增：

1. `src/services/request-locale.service.ts`
2. `src/services/i18n.service.ts`
3. `src/shared/i18n.ts`

职责建议：

1. `request-locale.service.ts` 负责解析 locale
2. `i18n.service.ts` 负责读取 app 级 i18n 配置与共享字典
3. `shared/i18n.ts` 放纯函数工具，例如 normalize、pick、batch localize

## 15. 推荐实施顺序

### Phase 1

先把统一规范和工具落地：

1. 确定 `*_i18n` 字段命名
2. 落地 `i18n.settings`
3. 实现公共 locale 解析与 `pickI18nText`

### Phase 2

选择 1 到 2 个业务模块试点：

1. banner
2. onboarding
3. 活动配置

把这部分动态文本改为 `jsonb` 多语言字段。

### Phase 3

再补共享字典：

1. 通用错误文案
2. 公共状态文案
3. 多模块复用的通知标题

### Phase 4

最后再考虑后台页面、revision、批量导入导出。

## 16. 明确不建议的做法

1. 把所有业务文案都放进一个巨大的 JSON 文件
2. 把所有业务文本都抽成中心化字典表
3. 每个模块自己发明 locale 解析规则
4. 每个接口自己决定 fallback 逻辑
5. 普通客户端接口同时返回 `title` 和 `titleI18n`
6. 在读请求时临时调用外部翻译服务

## 17. 最终推荐

如果只选一套最适合当前项目阶段的方案，建议是：

1. 动态业务文本使用 `*_i18n jsonb`
2. 公共复用文本使用 `i18n_messages`
3. app 级统一配置使用 `app_configs.i18n.settings`
4. locale 和 fallback 统一由公共工具处理
5. 客户端接口默认只返回已本地化字段

这套组合兼顾了：

1. 简单
2. 可维护
3. 可扩展
4. 多业务共存
5. 后续能自然演进到后台可编辑和共享字典

如果后续开始正式实施，下一步建议直接补三样东西：

1. `i18n.settings` 配置定义
2. `pickI18nText` / `localizeFields` 工具
3. 一个试点业务对象的 `*_i18n` 字段改造
