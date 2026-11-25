export type LightTickOwner = { appId: "lighttick"; userId: string };
export type LightTickVersioned = { version: number; createdAt: string; updatedAt: string };

export interface LightTickGuestIdentityRow extends LightTickOwner {
  deviceId: string; deviceSecretHash: string; platform: "ios" | "android";
  timezone: string; locale: string; appVersion: string; upgradeTokenHash: string;
  expiresAt: string; revokedAt?: string; upgradedToUserId?: string; createdAt: string; updatedAt: string;
}

export interface LightTickAccountUpgradeCommand {
  appId: "lighttick"; operationId: string; requestHash: string;
  guestUserId: string; targetUserId: string; guestUpgradeTokenHash: string;
  deviceId: string; now: string;
}

export interface LightTickAccountUpgradeResult {
  guestUserId: string; targetUserId: string; idempotencyReplayed: boolean;
  lastSequence: number;
  transferredResourceCounts: { goals: number; plans: number; tasks: number; reviews: number; proposals: number };
}

export interface LightTickProfileRow extends LightTickOwner, LightTickVersioned {
  timezone: string; locale: string; pace: "compact" | "balanced" | "relaxed";
  onboardingState: string; notificationPreferences: Record<string, unknown>;
  onboardingDraft: Record<string, unknown>;
}

export interface LightTickWeeklyPlanningBudget {
  version: number;
  weekly_available_minutes: number | null;
  plan_percent: number;
}

export type LightTickReviewCadence = "day" | "week" | "month";
export type LightTickReviewCadencePreference = {
  /** Selected layers. Empty means reviews are turned off for this goal. */
  layers: LightTickReviewCadence[];
};

export interface LightTickGoalRow extends LightTickOwner, LightTickVersioned {
  id: string; title: string; description?: string; status: string;
  constraints: Record<string, unknown>; targetDate?: string;
  pauseMetadata?: LightTickPauseMetadata;
  recoveryStartedAt?: string;
  /** Goal-level review cadence. Absent = fall back to default (weekly). */
  reviewCadence?: LightTickReviewCadencePreference;
  /**
   * 人生阶段归属（connect-stage-outcomes-to-clients 决策 1 承载 B）。
   * phase 在 goal 之上、跨 goal 分组；roadmap stage 在 goal 之内承载阶段内成果，两层互补。
   * 历史行保持 undefined，旧客户端忽略即降级为无阶段归属。
   */
  phaseId?: string;
  /**
   * 分组标签的展示缓存，权威键是 phaseId。
   * 重命名按 phaseId 批量更新同组全部 goal（决策 6），不做创建时快照。
   * 无 phaseId 时必须无 phaseLabel（DB CHECK zook_lighttick_goal_phase_label_check）。
   */
  phaseLabel?: string;
}

/** zook_lighttick_goal_contexts row. C3 阶段只承载 constraints 镜像，其余字段留待 S2 服务层填充。 */
export interface LightTickGoalContextRow extends LightTickOwner, LightTickVersioned {
  goalId: string;
  domain?: string;
  desiredOutcome: Record<string, unknown>;
  currentLevel: Record<string, unknown>;
  deadline: Record<string, unknown>;
  weeklyAvailableMinutes: Record<string, unknown>;
  constraints: Record<string, unknown>;
}

export interface LightTickPauseMetadata {
  reason: string; pausedAt: string; expectedResumeAt?: string;
  keepLightTasks: boolean; notificationPolicy: "suppress" | "light_only";
}

export type LightTickTaskVariant = "standard" | "light" | "minimum";
export interface LightTickTaskVariantDefinition {
  title: string; estimatedMinutes: number; completionCriteria: string;
}

export interface LightTickPlanRow extends LightTickOwner, LightTickVersioned {
  id: string; goalId: string; granularity: "month" | "week" | "day";
  status: string; source: string; periodStart: string; periodEnd: string;
  proposal: Record<string, unknown>;
}

export interface LightTickTaskGuidance { purpose?: string; materials?: string[]; expected_output?: string;
  preparation?: { kind: "provided" | "self_contained"; instruction: string }; }

/**
 * Fixed course source for a dated learning task (M8). kind/plan_id/lesson_no
 * mirror the action-domain normalized_target anchor; the version fields pin the
 * reviewed published source. purpose separates learn/review/apply completions.
 */
export interface LightTickTaskLearningTarget {
  kind: "plan"; plan_id: string; lesson_no: number; route_version: number;
  lesson_id: string; content_version: string; purpose: "learn" | "review" | "apply";
}

export interface LightTickLessonSource {
  route_id: string;
  route_version: number;
  lesson_number: number;
  lesson_id: string;
  content_version: string;
  purpose: "learn" | "review" | "apply";
}

export interface LightTickTaskExecutionProgress {
  outcome?: string;
  remainingWork?: string;
  remainingEstimatedMinutes?: number | null;
  waiting?: { reason: string; checkDate?: string };
  transferredToTaskId?: string;
  splitFromTaskId?: string;
}

export interface LightTickTaskRow extends LightTickOwner, LightTickVersioned {
  id: string; goalId: string; planId: string; title: string; status: string;
  priority: number; estimatedMinutes: number | null; scheduledFor?: string;
  startedAt?: string; completedAt?: string; notes?: string;
  lessonSource?: LightTickLessonSource;
  prerequisiteTaskId?: string;
  lineageId?: string; selectedVariant?: LightTickTaskVariant;
  variantDefinitions?: Record<LightTickTaskVariant, LightTickTaskVariantDefinition>;
  guidance?: LightTickTaskGuidance;
  completionCriteria?: string; actualMinutes?: number; commitmentSatisfied?: boolean;
  learningTarget?: LightTickTaskLearningTarget | null;
  executionProgress?: LightTickTaskExecutionProgress;
}

export interface LightTickTaskStepRow extends LightTickOwner, LightTickVersioned {
  id: string; taskId: string; title: string; position: number; completed: boolean;
}

export interface LightTickExecutionEventRow extends LightTickOwner {
  id: string; aggregateType: string; aggregateId: string; eventType: string;
  aggregateVersion: number; payload: Record<string, unknown>;
  occurredAt: string; createdAt: string;
}

export interface LightTickInsightAuditRow extends LightTickOwner {
  id: string; ruleId: string; kind: "factual" | "hypothesis" | "rule";
  evidenceCount: number; evidenceWindow: Record<string, unknown>;
  output: Record<string, unknown>; createdAt: string;
}

export interface LightTickChatMessageRow extends LightTickOwner {
  id: string; threadId: string; goalId: string; role: "user" | "assistant";
  content: string; runId?: string; createdAt: string;
}

export interface LightTickDnaInsightRow extends LightTickOwner, LightTickVersioned {
  id: string; signature: string; ruleId: string; statement: string;
  kind: "hypothesis" | "rule";
  status: "proposed" | "confirmed" | "denied" | "corrected" | "expired" | "dismissed";
  evidenceCount: number; dataRange: Record<string, unknown>; confidence: number;
  evidence?: Record<string, unknown>;
  scope: string; allowedEffects: string[]; userFeedback?: string; goalId?: string;
  createdAt: string; expiresAt: string;
}

export interface LightTickReviewRow extends LightTickOwner, LightTickVersioned {
  id: string; goalId: string; period: "day" | "week" | "month"; status: string;
  periodStart: string; periodEnd: string; facts: Record<string, unknown>;
  output: Record<string, unknown>; dataSufficiency: string;
}

export interface LightTickChangeProposalRow extends LightTickOwner, LightTickVersioned {
  id: string; planId: string; basePlanVersion: number; status: string; reason: string;
  diff: unknown[]; impact: Record<string, unknown>; expiresAt: string; decidedAt?: string;
}

export interface LightTickAiRunRow extends LightTickOwner {
  id: string; kind: string; status: string; resourceId?: string; sceneKey: string;
  promptVersion: string; schemaVersion: string; provider?: string; model?: string;
  attemptCount: number; inputContext: Record<string, unknown>; output?: unknown;
  errorCode?: string; usage: Record<string, unknown>; latencyMs?: number;
  createdAt: string; startedAt?: string; completedAt?: string; updatedAt: string;
}

export interface LightTickChangeRow extends LightTickOwner {
  sequence: number; entityType: string; entityId: string; entityVersion: number;
  operation: "upsert" | "delete"; snapshot?: Record<string, unknown>; changedAt: string;
}

export interface LightTickOperationRow extends LightTickOwner {
  operationId: string; deviceId: string; payloadHash: string; entityType: string;
  entityId: string; action: string; requestPayload: Record<string, unknown>;
  resultPayload: Record<string, unknown>; status: string; createdAt: string; updatedAt: string;
}

export interface LightTickDeviceRow extends LightTickOwner {
  id: string; platform: "ios" | "android"; pushProvider: "apns" | "fcm";
  pushToken: string; timezone: string; locale: string; appVersion: string;
  notificationsEnabled: boolean; active: boolean; deletedAt?: string;
  createdAt: string; updatedAt: string;
}
