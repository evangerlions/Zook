import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickGoalRow, LightTickOwner } from "./lighttick.types.ts";
import type { LightTickGoalStatus } from "./lighttick-state-machines.ts";
import { transitionGoal } from "./lighttick-state-machines.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

export interface LightTickGoalInput {
  title: string; description?: string; targetDate?: string; constraints: Record<string, unknown>;
}

export interface LightTickGoalLifecycleOptions {
  reason?: string; expectedResumeAt?: string; keepLightTasks?: boolean;
  notificationPolicy?: "suppress" | "light_only";
  resumeMode?: "original_pace" | "recovery_mode" | "adjust_goal";
}

export class LightTickGoalService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async list(owner: LightTickOwner) { return await this.repository.listGoals(owner); }
  async get(owner: LightTickOwner, id: string): Promise<LightTickGoalRow> {
    const goal = await this.repository.getGoal(owner, id);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    return goal;
  }
  async create(owner: LightTickOwner, input: LightTickGoalInput): Promise<LightTickGoalRow> {
    const timestamp = this.clock().toISOString(); const title = this.validateTitle(input.title);
    const row: LightTickGoalRow = { ...owner, id: randomId("lighttick_goal"), title,
      description: input.description?.trim() || undefined, targetDate: input.targetDate,
      constraints: structuredClone(input.constraints), status: "draft", version: 1, createdAt: timestamp, updatedAt: timestamp };
    return await this.repository.saveGoal(row, this.write(row, "goal_created", 1, timestamp));
  }
  async update(owner: LightTickOwner, id: string, baseVersion: number, patch: Partial<LightTickGoalInput>): Promise<LightTickGoalRow> {
    const current = await this.get(owner, id); const timestamp = this.clock().toISOString();
    const next = { ...current, title: patch.title === undefined ? current.title : this.validateTitle(patch.title),
      description: patch.description === undefined ? current.description : patch.description.trim() || undefined,
      targetDate: patch.targetDate === undefined ? current.targetDate : patch.targetDate,
      constraints: patch.constraints === undefined ? current.constraints : structuredClone(patch.constraints),
      updatedAt: timestamp };
    return await this.repository.saveGoal(next, this.write(next, "goal_updated", baseVersion + 1, timestamp), baseVersion);
  }
  async transition(owner: LightTickOwner, id: string, baseVersion: number,
    action: "pause" | "resume" | "complete" | "archive", options: LightTickGoalLifecycleOptions = {}): Promise<LightTickGoalRow> {
    const current = await this.get(owner, id); const timestamp = this.clock().toISOString();
    if (options.notificationPolicy !== undefined && !["suppress", "light_only"].includes(options.notificationPolicy))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Notification policy is invalid.");
    if (options.resumeMode !== undefined && !["original_pace", "recovery_mode", "adjust_goal"].includes(options.resumeMode))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Resume mode is invalid.");
    if (action === "resume" && options.resumeMode === "adjust_goal") return current;
    const targets: Record<typeof action, LightTickGoalStatus> = {
      pause: "paused", resume: options.resumeMode === "recovery_mode" ? "recovering" : "active",
      complete: "completed", archive: "archived",
    };
    const status = transitionGoal(current.status as LightTickGoalStatus, targets[action]);
    if (options.expectedResumeAt && Number.isNaN(Date.parse(options.expectedResumeAt)))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Expected resume time is invalid.");
    const next: LightTickGoalRow = { ...current, status,
      pauseMetadata: action === "pause" ? { reason: options.reason?.trim() || "unspecified", pausedAt: timestamp,
        expectedResumeAt: options.expectedResumeAt, keepLightTasks: options.keepLightTasks === true,
        notificationPolicy: options.notificationPolicy ?? "suppress" } : current.pauseMetadata,
      recoveryStartedAt: action === "resume" && options.resumeMode === "recovery_mode" ? timestamp : current.recoveryStartedAt,
      updatedAt: timestamp };
    return await this.repository.saveGoal(next,
      this.write(next, action === "resume" && status === "recovering" ? "goal_recovery_started" : `goal_${action}d`,
        baseVersion + 1, timestamp), baseVersion);
  }
  private validateTitle(value: string): string {
    const title = value.trim();
    if (!title || title.length > 200) throw new ApplicationError(400, "REQ_INVALID_BODY", "Goal title is invalid.");
    return title;
  }
  private write(goal: LightTickGoalRow, eventType: string, version: number, timestamp: string) {
    return {
      event: { ...goal, id: randomId("lighttick_event"), aggregateType: "goal", aggregateId: goal.id,
        eventType, aggregateVersion: version, payload: { status: goal.status }, occurredAt: timestamp, createdAt: timestamp },
      change: { appId: goal.appId, userId: goal.userId, entityType: "goal", entityId: goal.id,
        entityVersion: version, operation: "upsert" as const,
        snapshot: { id: goal.id, title: goal.title, status: goal.status, pause_metadata: goal.pauseMetadata,
          recovery_started_at: goal.recoveryStartedAt, version }, changedAt: timestamp },
    };
  }
}
