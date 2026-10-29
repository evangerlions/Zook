import type {LightTickAiRunRow} from "../modules/lighttick/lighttick.types.ts";
export function profileData(row: any) { return row ? { user_id: row.userId, timezone: row.timezone, locale: row.locale,
  pace: row.pace, onboarding_state: row.onboardingState, notification_preferences: row.notificationPreferences,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt } : undefined; }
export function goalData(row: any) { return { id: row.id, title: row.title, description: row.description, status: row.status,
  target_date: row.targetDate, constraints: row.constraints, pause_metadata: row.pauseMetadata ? {
    reason: row.pauseMetadata.reason, paused_at: row.pauseMetadata.pausedAt,
    expected_resume_at: row.pauseMetadata.expectedResumeAt, keep_light_tasks: row.pauseMetadata.keepLightTasks,
    notification_policy: row.pauseMetadata.notificationPolicy } : undefined,
  recovery_started_at: row.recoveryStartedAt, review_cadence: row.reviewCadence ?? { layers: ["week"] },
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
export function variantData(definition: any) { return { title: definition.title,
  estimated_duration_minutes: definition.estimatedMinutes, completion_criteria: definition.completionCriteria }; }
export function variantsData(definitions: any) { return definitions ? Object.fromEntries(Object.entries(definitions)
  .map(([key, value]) => [key, variantData(value)])) : undefined; }
export function taskData(row: any, steps: any[] = []) { return { id: row.id, goal_id: row.goalId, plan_id: row.planId, title: row.title,
  status: row.status, scheduled_date: row.scheduledFor?.slice(0, 10), estimated_duration_minutes: row.estimatedMinutes,
  lineage_id: row.lineageId ?? row.id, selected_variant: row.selectedVariant ?? "standard",
  variants: variantsData(row.variantDefinitions), completion_criteria: row.completionCriteria, guidance: row.guidance,
  actual_duration_minutes: row.actualMinutes, commitment_satisfied: row.commitmentSatisfied,
  priority: row.priority, steps: steps.map(step => ({ id: step.id, title: step.title,
    completed: step.completed, position: step.position })), completed_at: row.completedAt, note: row.notes, version: row.version,
  created_at: row.createdAt, updated_at: row.updatedAt }; }
export function planData(row: any, tasks?: any[]) { return { id: row.id, goal_id: row.goalId, granularity: row.granularity,
  status: row.status, period_start: row.periodStart, period_end: row.periodEnd, source: row.source,
  proposal: row.proposal,
  ...(tasks ? { tasks: tasks.map(task => taskData(task, task.steps)) } : {}), version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
export function reviewData(row: any) { return { id: row.id, goal_id: row.goalId, period: row.period === "day" ? "daily" : row.period === "week" ? "weekly" : "monthly",
  status: row.status, period_start: row.periodStart, period_end: row.periodEnd, facts: row.facts,
  insights: row.output?.insights ?? [], recommendations: row.output?.recommendations ?? [], data_sufficiency: row.dataSufficiency,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
export function proposalData(row: any) { return { id: row.id, plan_id: row.planId, base_plan_version: row.basePlanVersion,
  status: row.status, reason: row.reason, diff: row.diff, impact: row.impact, expires_at: row.expiresAt,
  version: row.version, created_at: row.createdAt, updated_at: row.updatedAt }; }
export function runData(row: LightTickAiRunRow) { return { id: row.id, kind: row.kind, scene: row.sceneKey, status: row.status,
  retryable: row.status === "failed", result_resource_id: row.resourceId, error_code: row.errorCode,
  result: row.status === "succeeded" ? row.output : undefined,
  created_at: row.createdAt, updated_at: row.updatedAt }; }

