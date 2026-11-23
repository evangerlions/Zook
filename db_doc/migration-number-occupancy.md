# 迁移编号占用登记表（Migration Number Occupancy）

> 目的：防止 Postgres 迁移编号冲突。本表是 LightTick / Zook 新增迁移编号分配的唯一依据。
> 作用域：`src/infrastructure/database/postgres/migrations/`

## 1. 现状

- 迁移目录现有 **152 个文件**，已用最大编号 **114**。
- 历史演进中不同产品线复用编号，形成 **27 组编号重复**。
- 铁律：**已应用的迁移一律不重编号、不重命名**。本表只登记现状、约束未来。

## 2. Known Duplicates（27 组）

| 编号 | 文件 |
|------|------|
| 021 | `021_bodylog_profiles.sql` / `021_frogsleep_focus_session_idempotency.sql` |
| 022 | `022_bodylog_social.sql` / `022_frogsleep_invitation_relationship_receipt.sql` |
| 035 | `035_lighttick_insight_audits.sql` / `035_llm_observation_error_messages.sql` |
| 036 | `036_lighttick_chat_messages.sql` / `036_llm_observation_app_scope.sql` |
| 037 | `037_ai_novel_conversation_records.sql` / `037_lighttick_dna_insights.sql` |
| 050 | `050_bodylog_growth_align_plans.sql` / `050_enable_bodylog_features.sql` |
| 060 | `060_ai_novel_conversation_debug.sql` / `060_lighttick_planning_sessions.sql` |
| 061 | `061_ai_novel_conversation_result.sql` / `061_lighttick_goal_context_outcomes.sql` |
| 062 | `062_ai_novel_conversation_usage.sql` / `062_lighttick_task_planning_columns.sql` |
| 063 | `063_bodylog_admin_indexes.sql` / `063_bodylog_app.sql` / `063_lighttick_goal_context_outcomes.sql` / `063_lighttick_review_cadence.sql` |
| 064 | `064_bodylog_admin_checkin.sql` / `064_lighttick_task_guidance.sql` / `064_lighttick_task_planning_columns.sql` / `064_system_config.sql` |
| 065 | `065_bodylog_admin_moderation.sql` / `065_bodylog_invitation_code.sql` / `065_lighttick_review_cadence.sql` / `065_lighttick_task_business_date.sql` |
| 067 | `067_ai_novel_billing_revenuecat.sql` / `067_bodylog_growth_local_goal_aggregates.sql` / `067_llm_observation_call_purpose.sql` |
| 068 | `068_ai_novel_billing_unknown_evidence.sql` / `068_frogsleep_notification_provider_accepted.sql` |
| 069 | `069_ai_novel_billing_webhook_account_deleted_at.sql` / `069_frogsleep_device_current_owner.sql` |
| 070 | `070_ai_novel_billing_transfer_audit_users.sql` / `070_frogsleep_personal_sync.sql` |
| 071 | `071_ai_novel_alipay_orders.sql` / `071_frogsleep_personal_sync_backfill.sql` / `071_llm_observation_point_pricing.sql` |
| 072 | `072_ai_novel_credits.sql` / `072_ai_novel_order_product_prefix.sql` / `072_frogsleep_raw_sleep_sync.sql` |
| 073 | `073_ai_novel_order_business_identity.sql` / `073_frogsleep_guest_accounts.sql` / `073_llm_cache_point_pricing.sql` |
| 074 | `074_ai_novel_credit_window_anchor.sql` / `074_lighttick_action_workspaces.sql` / `074_lighttick_independent_records.sql` |
| 075 | `075_ai_novel_usage_reporting.sql` / `075_frogsleep_invitation_read_state.sql` / `075_frogsleep_support_notes.sql` |
| 076 | `076_ai_novel_billing_environment.sql` / `076_lighttick_record_handoff.sql` |
| 077 | `077_ai_novel_billing_market.sql` / `077_lighttick_learning_library.sql` |
| 078 | `078_ai_novel_membership_sync.sql` / `078_lighttick_learning_private.sql` |
| 081 | `081_lighttick_manual_planning.sql` / `081_yaohezi_subject_bindings.sql` |
| 085 | `085_ai_novel_admin_credit_grant_idempotency.sql` / `085_lighttick_native_learning.sql` |
| 086 | `086_ai_novel_revenuecat_renewal_status.sql` / `086_lighttick_learning_consent_and_draft_anchor.sql` |

### 内容相同的重复（diff 校验通过）

| 编号对 | 文件 | 说明 |
|--------|------|------|
| 061 / 063 | `061_lighttick_goal_context_outcomes.sql` = `063_lighttick_goal_context_outcomes.sql` | 内容完全一致，均需保留（已应用，不重编号） |
| 062 / 064 | `062_lighttick_task_planning_columns.sql` = `064_lighttick_task_planning_columns.sql` | 内容完全一致，均需保留 |
| 063 / 065 | `063_lighttick_review_cadence.sql` = `065_lighttick_review_cadence.sql` | 内容完全一致，均需保留 |

## 3. 分段占用表

> 后续新增迁移一律从 **115** 起，按用途落段，禁止再撞 001–114 任何编号。

| 段号 | 占用者 | 状态 |
|------|--------|------|
| 001–114 | 历史已用（含 27 组重复） | 锁定，不再分配 |
| 115–149 | 家教线（learning / tutor / course pipeline） | 预留 |
| 150–179 | 教练线（goal coach / planning / review） | 预留 |
| 180–199 | 基础设施（infra / system / cross-product） | 预留 |
| 200+ | — | 保留，未分配 |

## 4. 迁移文件头模板

新迁移文件必须在文件头写明「段号 + 占用者 + 依赖迁移」，示例：

```sql
-- migration: 115  # 段号
-- owner: 家教线    # 占用者
-- depends: -      # 依赖的迁移编号；无依赖写 -
-- purpose: 为课程 brief 新增 xxx 字段
```

## 5. 新迁移编号申请流程

1. 判断迁移归属：家教线 / 教练线 / 基础设施。
2. 查本表「分段占用表」，取该段当前已分配的最大编号 + 1。
3. 按第 4 节模板填写文件头（段号 + 占用者 + 依赖迁移）。
4. 提交时同步在本表登记新编号，防止并行开发撞号。
