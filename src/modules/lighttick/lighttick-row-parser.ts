import type {
  LightTickChangeRow, LightTickDeviceRow, LightTickGoalRow, LightTickOperationRow,
  LightTickProfileRow, LightTickTaskRow,
} from "./lighttick.types.ts";

type DatabaseRow = Record<string, unknown>;

function requiredString(row: DatabaseRow, key: string): string {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  if (typeof value !== "string" || !value) throw new Error(`Invalid LightTick row field: ${key}`);
  return value;
}

function optionalString(row: DatabaseRow, key: string): string | undefined {
  const value = row[key];
  if (value instanceof Date) return value.toISOString();
  return typeof value === "string" && value ? value : undefined;
}

function requiredInteger(row: DatabaseRow, key: string): number {
  const value = Number(row[key]);
  if (!Number.isSafeInteger(value)) throw new Error(`Invalid LightTick integer field: ${key}`);
  return value;
}

function jsonObject(row: DatabaseRow, key: string): Record<string, unknown> {
  const value = row[key];
  if (!value) return {};
  if (typeof value === "string") return JSON.parse(value) as Record<string, unknown>;
  if (typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  throw new Error(`Invalid LightTick JSON field: ${key}`);
}

function owner(row: DatabaseRow) {
  const appId = requiredString(row, "app_id");
  if (appId !== "lighttick") throw new Error("LightTick row has a foreign app_id");
  return { appId, userId: requiredString(row, "user_id") } as const;
}

function versioned(row: DatabaseRow) {
  return {
    version: requiredInteger(row, "version"),
    createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

export function parseLightTickProfileRow(row: DatabaseRow): LightTickProfileRow {
  return {
    ...owner(row), ...versioned(row), timezone: requiredString(row, "timezone"),
    locale: requiredString(row, "locale"), pace: requiredString(row, "pace") as LightTickProfileRow["pace"],
    onboardingState: requiredString(row, "onboarding_state"),
    notificationPreferences: jsonObject(row, "notification_preferences"),
    onboardingDraft: jsonObject(row, "onboarding_draft"),
  };
}

export function parseLightTickGoalRow(row: DatabaseRow): LightTickGoalRow {
  return {
    ...owner(row), ...versioned(row), id: requiredString(row, "id"), title: requiredString(row, "title"),
    description: optionalString(row, "description"), status: requiredString(row, "status"),
    constraints: jsonObject(row, "constraints"), targetDate: optionalString(row, "target_date"),
    pauseMetadata: Object.keys(jsonObject(row, "pause_metadata")).length
      ? jsonObject(row, "pause_metadata") as unknown as LightTickGoalRow["pauseMetadata"] : undefined,
    recoveryStartedAt: optionalString(row, "recovery_started_at"),
  };
}

export function parseLightTickTaskRow(row: DatabaseRow): LightTickTaskRow {
  return {
    ...owner(row), ...versioned(row), id: requiredString(row, "id"), goalId: requiredString(row, "goal_id"),
    planId: requiredString(row, "plan_id"), title: requiredString(row, "title"),
    status: requiredString(row, "status"), priority: requiredInteger(row, "priority"),
    estimatedMinutes: requiredInteger(row, "estimated_minutes"), scheduledFor: optionalString(row, "scheduled_for"),
    startedAt: optionalString(row, "started_at"), completedAt: optionalString(row, "completed_at"),
    notes: optionalString(row, "notes"), lineageId: optionalString(row, "lineage_id") ?? requiredString(row, "id"),
    selectedVariant: (optionalString(row, "selected_variant") ?? "standard") as LightTickTaskRow["selectedVariant"],
    variantDefinitions: jsonObject(row, "variant_definitions") as unknown as LightTickTaskRow["variantDefinitions"],
    completionCriteria: optionalString(row, "completion_criteria"),
    actualMinutes: row.actual_minutes === null || row.actual_minutes === undefined ? undefined : requiredInteger(row, "actual_minutes"),
    commitmentSatisfied: row.commitment_satisfied === null || row.commitment_satisfied === undefined
      ? undefined : Boolean(row.commitment_satisfied),
  };
}

export function parseLightTickChangeRow(row: DatabaseRow): LightTickChangeRow {
  return {
    ...owner(row), sequence: requiredInteger(row, "sequence"), entityType: requiredString(row, "entity_type"),
    entityId: requiredString(row, "entity_id"), entityVersion: requiredInteger(row, "entity_version"),
    operation: requiredString(row, "operation") as LightTickChangeRow["operation"],
    snapshot: row.snapshot ? jsonObject(row, "snapshot") : undefined,
    changedAt: requiredString(row, "changed_at"),
  };
}

export function parseLightTickOperationRow(row: DatabaseRow): LightTickOperationRow {
  return {
    ...owner(row), operationId: requiredString(row, "operation_id"), deviceId: requiredString(row, "device_id"),
    payloadHash: requiredString(row, "payload_hash"), entityType: requiredString(row, "entity_type"),
    entityId: requiredString(row, "entity_id"), action: requiredString(row, "action"),
    requestPayload: jsonObject(row, "request_payload"), resultPayload: jsonObject(row, "result_payload"),
    status: requiredString(row, "status"), createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}

export function parseLightTickDeviceRow(row: DatabaseRow): LightTickDeviceRow {
  return {
    ...owner(row), id: requiredString(row, "id"),
    platform: requiredString(row, "platform") as LightTickDeviceRow["platform"],
    pushProvider: requiredString(row, "push_provider") as LightTickDeviceRow["pushProvider"],
    pushToken: requiredString(row, "push_token"), timezone: requiredString(row, "timezone"),
    locale: requiredString(row, "locale"), appVersion: requiredString(row, "app_version"),
    notificationsEnabled: Boolean(row.notifications_enabled), active: Boolean(row.active),
    deletedAt: optionalString(row, "deleted_at"), createdAt: requiredString(row, "created_at"),
    updatedAt: requiredString(row, "updated_at"),
  };
}
