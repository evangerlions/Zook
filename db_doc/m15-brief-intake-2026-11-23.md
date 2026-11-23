# M15 brief intake 实现与验证记录

日期：2026-11-23 · 分支 `feature/grow-native-migration-plan` · change `add-brief-intake`

## 做了什么

一句话自然语言学习愿望 → `CourseBrief` 八字段的可编辑预填，挂在现有 `/learning/work` 上作为新 kind `brief_intake`，不新建端点、不写课程。

| 层 | 改动 |
|---|---|
| AI 场景 | `lighttick-ai-scenes.ts` 加 `brief_intake`（`lighttick.brief_intake.v1`，30s/8k context/1k output/$0.03，`fallback: none`）；`lighttick-ai-prompts.ts` 加 prompt，`LIGHTTICK_PROMPT_VERSION` 1.9.2→1.9.3 |
| work kind | `learning-work.types.ts` 加 `"brief_intake"`；`learning-work.service.create` 扩展白名单与入参（只收 `text`），跳过 route 校验，`route_id` 落虚拟占位 `plan-intake-<digest>`，`base_revision=0`，预算预留 30k micros/次（个人模型模式豁免） |
| runner | `SCENE_BY_KIND` 加 `brief_intake`；`perform` 加分支（input `{text}`、`BRIEF_INTAKE_SCHEMA` 宽松 schema、`briefIntakeOutput` 校验：title/goal 非空、数字范围、null 原样保留、`missing_fields` 汇总） |
| adopt | `adopt` 加分支：只回 `{brief_partial, missing_fields}`，不写 route/课次 |
| 合同 | `api.yaml`：`LightTickNativeLearningWorkCreate` 加 `{kind,text}` 分支；`LightTickNativeLearningWork` 的 kind 枚举与 output union 加 brief intake；`LightTickNativeLearningWorkAdoption` 的 kind/result union；新增 `LightTickNativeLearningBriefIntakePartial/Output/Adopt`；生成物已重生成 |
| Web | 新增 `BriefIntake.tsx`（一句话输入 + "帮我整理成课程条件" + 轮询 work + `mergeBrief` 回填：null 不覆盖、缺失项提示"待补"）；挂到 `CourseEditor` 创建模式 |

## 关键取舍

1. **不跑 `courseBrief()` 严格校验**。`courseBrief()` 要求 title/goal/level/minutes 必填、weekly 必须带 weeks+sessions、self_paced 必须带 lesson_count——从一句"想学摄影构图"根本推不出周期，硬填就是编造。所以 brief intake 只做宽松校验，null 原样返回，`missing_fields` 告诉表单哪些要用户补；严格 `courseBrief()` 留到用户补全、真正创建课程时。
2. **不用产品缺省值填满**。凭空写 `weeks=4/sessions=3` 会虚构周期（真相三：不合成、不替人规定周期）。
3. **虚拟 route_id**。合同 `route_id` 要求 `plan-` 前缀（`*id001` 被 10 处复用），改锚点会放宽所有 route/lesson 的 id 约束；所以只给 brief intake 生成 `plan-intake-<digest>` 占位 id，adopt 时 `getLearningRoute` 返回 undefined 正好满足 `base_route_revision=0`。

## 验证证据

- `npm run check:lighttick-learning-types`：通过
- `node --experimental-transform-types --test test/unit/lighttick-learning-work.api.test.ts`：通过（新增 PT01/PT02 + adopt 断言）
  - PT01「我想学结构化表达，每周 3 次、每次 20 分钟」→ `minutes=20 / pacing=weekly / sessions=3 / weeks=null`，`missing_fields` 含 `level`、`weeks`
  - PT02「想学摄影构图」→ `minutes=null / pacing=null`，`missing_fields = ['level','minutes','pacing']`，无虚构时长
  - adopt 只返回 `{brief_partial, missing_fields}`，`brief_partial.minutes=20`，不产生 route 版本
- `npm run check:api-contracts`：通过（生成物无漂移）
- Web `npm run typecheck`：通过

## 未做 / 风险

- **真实模型验证（4.4）**：本地无 AI provider key，真实解析、超时、取消、429 预算与 409 行为留服务端环境验证。
- **浏览器回填（4.3 后半）**：Mock 预览不接真实 work，Web 的"输入愿望 → 回填"只在服务端环境做真实浏览器验证。
- **AI 幻觉**：prompt 要求"只提取明确给出的"，但模型仍可能把"想学摄影构图"补出节奏；`missing_fields` 与未填字段的"待补"提示是防线，真实样本质量并入 M7 评估集。
- **work 列表展示**：brief intake 的 `route_id` 是占位值，客户端不应把它当课程；Web 侧目前不在 work 列表里展示 brief intake 条目（只在创建页用一次）。

## 与既有 change 的关系

- `enable-ai-personal-tutor` 的 `ai-personal-tutor` spec Requirement 1（"learner describes a learning goal"）不受影响：本 change 只补输入解析，教学/反馈/记忆仍归该 change。
- M8（`connect-learning-plans-to-today`）与 M9（T1 第一课）依赖本 change 产出的 brief 作为 `route_draft` 输入；本 change 不写 route、不写课次、不改 schedule。
