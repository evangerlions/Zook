import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner, LightTickProfileRow } from "./lighttick.types.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

export interface LightTickAvailabilityWindow {
  weekday: number; startTime: string; endTime: string;
}
export interface LightTickOnboardingDraft {
  title: string; description?: string; currentLevel: string; weeklyAvailableMinutes: number;
  pace: LightTickProfileRow["pace"]; timezone: string; targetDate?: string; durationMonths?: number;
  motivation?: string; availabilityWindows?: LightTickAvailabilityWindow[];
}

const clockPattern = /^([01][0-9]|2[0-3]):[0-5][0-9]$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const notificationPreferenceKeys = new Set(["enabled", "daily_reminder_time", "review_reminders", "quiet_hours_start", "quiet_hours_end"]);

function validateNotificationPreferences(input: Record<string, unknown>): Record<string, unknown> {
  if (!input || Array.isArray(input) || typeof input !== "object")
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Notification preferences are invalid.");
  for (const key of Object.keys(input)) {
    if (!notificationPreferenceKeys.has(key))
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Notification preferences contain an unsupported field.");
  }
  for (const key of ["enabled", "review_reminders"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean")
      throw new ApplicationError(400, "REQ_INVALID_BODY", `${key} must be boolean.`);
  }
  for (const key of ["daily_reminder_time", "quiet_hours_start", "quiet_hours_end"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "string" || !clockPattern.test(input[key] as string)))
      throw new ApplicationError(400, "REQ_INVALID_BODY", `${key} must use HH:mm.`);
  }
  return input;
}

export function assertIanaTimezone(timezone: string): void {
  try { new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(); }
  catch { throw new ApplicationError(400, "LIGHTTICK_TIMEZONE_INVALID", "Timezone must be a valid IANA identifier."); }
}

function validateDraft(draft: LightTickOnboardingDraft): LightTickOnboardingDraft {
  const title = draft.title.trim(); const currentLevel = draft.currentLevel.trim();
  if (!title || title.length > 200 || !currentLevel || currentLevel.length > 500) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Onboarding title or current level is invalid.");
  }
  if (!Number.isInteger(draft.weeklyAvailableMinutes) || draft.weeklyAvailableMinutes < 30 || draft.weeklyAvailableMinutes > 10080) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Weekly available minutes are invalid.");
  }
  if (!["compact", "balanced", "relaxed"].includes(draft.pace)) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Pace is invalid.");
  }
  assertIanaTimezone(draft.timezone);
  if (draft.targetDate && (!datePattern.test(draft.targetDate) || Number.isNaN(Date.parse(`${draft.targetDate}T00:00:00Z`)))) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Target date is invalid.");
  }
  if (draft.durationMonths !== undefined && (!Number.isInteger(draft.durationMonths) || draft.durationMonths < 1 || draft.durationMonths > 120)) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Duration months are invalid.");
  }
  if ((draft.availabilityWindows?.length ?? 0) > 28) throw new ApplicationError(400, "REQ_INVALID_BODY", "Too many availability windows.");
  for (const window of draft.availabilityWindows ?? []) {
    if (!Number.isInteger(window.weekday) || window.weekday < 1 || window.weekday > 7 ||
      !clockPattern.test(window.startTime) || !clockPattern.test(window.endTime) || window.startTime >= window.endTime) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Availability window is invalid.");
    }
  }
  return { ...draft, title, currentLevel };
}

export class LightTickProfileService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async getProfile(owner: LightTickOwner): Promise<LightTickProfileRow | undefined> {
    return await this.repository.getProfile(owner);
  }

  async updateProfile(owner: LightTickOwner, baseVersion: number, patch: {
    timezone?: string; locale?: string; pace?: LightTickProfileRow["pace"];
    notificationPreferences?: Record<string, unknown>;
  }): Promise<LightTickProfileRow> {
    const current = await this.repository.getProfile(owner);
    if (!current) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Profile was not found.");
    if (patch.timezone !== undefined) assertIanaTimezone(patch.timezone);
    if (patch.locale !== undefined && (patch.locale.trim().length < 2 || patch.locale.trim().length > 16))
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Locale is invalid.");
    if (patch.pace !== undefined && !["compact", "balanced", "relaxed"].includes(patch.pace))
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Pace is invalid.");
    const notificationPreferences = patch.notificationPreferences === undefined ? current.notificationPreferences
      : { ...current.notificationPreferences, ...validateNotificationPreferences(patch.notificationPreferences) };
    return await this.repository.saveProfile({ ...current,
      timezone: patch.timezone ?? current.timezone, locale: patch.locale?.trim() ?? current.locale,
      pace: patch.pace ?? current.pace,
      notificationPreferences,
      updatedAt: this.clock().toISOString(),
    }, baseVersion);
  }

  async submitOnboarding(owner: LightTickOwner, input: LightTickOnboardingDraft): Promise<{ profile: LightTickProfileRow; goal: LightTickGoalRow }> {
    const draft = validateDraft(input); const timestamp = this.clock().toISOString();
    return await this.repository.transaction(owner, async () => {
      const current = await this.repository.getProfile(owner);
      const profile = await this.repository.saveProfile({ ...owner, timezone: draft.timezone, locale: current?.locale ?? "zh-CN",
        pace: draft.pace, onboardingState: "drafting", notificationPreferences: current?.notificationPreferences ?? {},
        onboardingDraft: draft as unknown as Record<string, unknown>, version: current?.version ?? 1,
        createdAt: current?.createdAt ?? timestamp, updatedAt: timestamp }, current?.version);
      const goal: LightTickGoalRow = { ...owner, id: randomId("lighttick_goal"), title: draft.title,
        description: draft.description, status: "draft", targetDate: draft.targetDate,
        constraints: { current_level: draft.currentLevel, weekly_available_minutes: draft.weeklyAvailableMinutes,
          pace: draft.pace, availability_windows: draft.availabilityWindows ?? [], motivation: draft.motivation,
          duration_months: draft.durationMonths }, version: 1, createdAt: timestamp, updatedAt: timestamp };
      const savedGoal = await this.repository.saveGoal(goal, {
        event: { ...owner, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
          eventType: "onboarding_draft_saved", aggregateVersion: 1, payload: { onboarding_state: "drafting" },
          occurredAt: timestamp, createdAt: timestamp },
        change: { ...owner, entityType: "goal", entityId: goal.id, entityVersion: 1,
          operation: "upsert", snapshot: { id: goal.id, status: goal.status }, changedAt: timestamp },
      });
      return { profile, goal: savedGoal };
    });
  }
}
