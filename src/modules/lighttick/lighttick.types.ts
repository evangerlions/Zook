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

export interface LightTickGoalRow extends LightTickOwner, LightTickVersioned {
  id: string; title: string; description?: string; status: string;
  constraints: Record<string, unknown>; targetDate?: string;
  pauseMetadata?: LightTickPauseMetadata;
  recoveryStartedAt?: string;
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

export interface LightTickTaskRow extends LightTickOwner, LightTickVersioned {
  id: string; goalId: string; planId: string; title: string; status: string;
  priority: number; estimatedMinutes: number; scheduledFor?: string;
  startedAt?: string; completedAt?: string; notes?: string;
  lineageId?: string; selectedVariant?: LightTickTaskVariant;
  variantDefinitions?: Record<LightTickTaskVariant, LightTickTaskVariantDefinition>;
  completionCriteria?: string; actualMinutes?: number; commitmentSatisfied?: boolean;
}

export interface LightTickExecutionEventRow extends LightTickOwner {
  id: string; aggregateType: string; aggregateId: string; eventType: string;
  aggregateVersion: number; payload: Record<string, unknown>;
  occurredAt: string; createdAt: string;
}

export interface LightTickReviewRow extends LightTickOwner, LightTickVersioned {
  id: string; goalId: string; period: "week" | "month"; status: string;
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
