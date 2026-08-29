import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";
import type { LightTickRepository } from "./lighttick.repository.ts";
import type {
  LightTickGoalRow, LightTickOwner, LightTickPlanRow, LightTickProfileRow,
  LightTickTaskRow, LightTickTaskVariant, LightTickTaskVariantDefinition,
} from "./lighttick.types.ts";
import { assertIanaTimezone } from "./lighttick-profile.service.ts";
import { LightTickTaskService } from "./lighttick-task.service.ts";

export type LightTickCommitmentMode = "recovery" | "light" | "standard" | "sprint";

interface StarterCandidate {
  candidateId: string; title: string; assumption: string;
  variants: Record<LightTickTaskVariant, LightTickTaskVariantDefinition>;
}

export interface LightTickStarterResult {
  source: "deterministic_template"; wish: string; assumption: string;
  goal: LightTickGoalRow; recommended: LightTickTaskRow; alternatives: StarterCandidate[];
}

const templates = [
  { matches: ["编程", "代码", "开发", "program", "coding"], title: "打开一个在线编辑器，运行第一段示例代码", criterion: "看到代码成功运行，并写下一句你理解的内容" },
  { matches: ["跑步", "运动", "健身", "run", "fitness"], title: "换好鞋，完成 8 分钟轻松走跑", criterion: "完成 8 分钟并记录身体感受" },
  { matches: ["英语", "语言", "english", "日语"], title: "听一段 10 分钟入门材料并跟读三句", criterion: "完成三句跟读并标记一个生词" },
  { matches: ["写作", "小说", "write", "文章"], title: "写下一个 100 字的开头，不做修改", criterion: "保存一段至少 100 字的草稿" },
] as const;

function candidate(title: string, criterion: string, index: number): StarterCandidate {
  const shortTitle = title.replace(/^打开一个|^换好鞋，|^听一段|^写下一个/, "").trim();
  return { candidateId: `candidate_${index}`, title, assumption: "先用低成本行动确认方向，再逐步增加计划精度",
    variants: {
      standard: { title, estimatedMinutes: 10, completionCriteria: criterion },
      light: { title: `轻量：${shortTitle}`, estimatedMinutes: 7, completionCriteria: `完成一个缩小版：${criterion}` },
      minimum: { title: `最低行动：${shortTitle}`, estimatedMinutes: 5, completionCriteria: "开始并留下一个可见结果" },
    } };
}

function starterCandidates(wish: string): StarterCandidate[] {
  const normalized = wish.toLocaleLowerCase();
  const matched = templates.find(item => item.matches.some(keyword => normalized.includes(keyword)));
  const primary = matched ?? { title: `为“${wish}”写下第一个可验证的小结果`, criterion: "留下一个可查看、可继续的结果" };
  return [candidate(primary.title, primary.criterion, 1),
    candidate(`找一个与“${wish}”相关的可靠入门示例`, "收藏一个示例并写下一句选择理由", 2),
    candidate(`用自己的话写下“${wish}”的下一步`, "写下一条今天可以完成的具体动作", 3)];
}

function write(owner: LightTickOwner, aggregateType: string, aggregateId: string,
  eventType: string, version: number, timestamp: string, snapshot: Record<string, unknown>) {
  return { event: { ...owner, id: randomId("lighttick_event"), aggregateType, aggregateId, eventType,
    aggregateVersion: version, payload: snapshot, occurredAt: timestamp, createdAt: timestamp },
  change: { ...owner, entityType: aggregateType, entityId: aggregateId, entityVersion: version,
    operation: "upsert" as const, snapshot, changedAt: timestamp } };
}

function isoDate(date: Date): string { return date.toISOString().slice(0, 10); }

export class LightTickProgressiveService {
  constructor(private readonly repository: LightTickRepository, private readonly tasks: LightTickTaskService,
    private readonly clock = () => new Date()) {}

  async createStarter(owner: LightTickOwner, input: { wish: string; timezone: string; locale?: string }): Promise<LightTickStarterResult> {
    const wish = input.wish.trim();
    if (!wish || wish.length > 500) throw new ApplicationError(400, "REQ_FIELD_INVALID", "Wish is required and must be at most 500 characters.");
    assertIanaTimezone(input.timezone);
    const candidates = starterCandidates(wish); const recommended = candidates[0]!; const timestamp = this.clock().toISOString();
    return await this.repository.transaction(owner, async () => {
      const currentProfile = await this.repository.getProfile(owner);
      const goal: LightTickGoalRow = { ...owner, id: randomId("lighttick_goal"), title: wish, status: "active",
        constraints: { progressive: true, weekly_available_minutes: 70, pace: "balanced" }, version: 1,
        createdAt: timestamp, updatedAt: timestamp };
      const savedGoal = await this.repository.saveGoal(goal,
        write(owner, "goal", goal.id, "progressive_goal_started", 1, timestamp, { status: "active", wish }));
      const today = isoDate(this.clock());
      const plan: LightTickPlanRow = { ...owner, id: randomId("lighttick_plan"), goalId: savedGoal.id,
        granularity: "day", status: "active", source: "deterministic_template", periodStart: today, periodEnd: today,
        proposal: { progressive_stage: "starter" }, version: 1, createdAt: timestamp, updatedAt: timestamp };
      const savedPlan = await this.repository.savePlan(plan,
        write(owner, "plan", plan.id, "starter_plan_created", 1, timestamp, { status: "active", goal_id: goal.id }));
      const standard = recommended.variants.standard;
      const task: LightTickTaskRow = { ...owner, id: randomId("lighttick_task"), goalId: savedGoal.id,
        planId: savedPlan.id, lineageId: randomId("lighttick_lineage"), selectedVariant: "standard",
        variantDefinitions: recommended.variants, title: standard.title, completionCriteria: standard.completionCriteria,
        status: "pending", priority: 100, estimatedMinutes: standard.estimatedMinutes, scheduledFor: timestamp,
        version: 1, createdAt: timestamp, updatedAt: timestamp };
      const savedTask = await this.repository.saveTask(task,
        write(owner, "task", task.id, "starter_shown", 1, timestamp,
          { status: "pending", lineage_id: task.lineageId, selected_variant: "standard" }));
      const draft = { ...(currentProfile?.onboardingDraft ?? {}), progressive_stage: "starter_ready", wish,
        goal_id: savedGoal.id, task_id: savedTask.id, valid_action_count: 0, candidates };
      const profile: LightTickProfileRow = { ...owner, timezone: input.timezone, locale: input.locale?.trim() || currentProfile?.locale || "zh-CN",
        pace: currentProfile?.pace ?? "balanced", onboardingState: "starter_ready",
        notificationPreferences: currentProfile?.notificationPreferences ?? {}, onboardingDraft: draft,
        version: currentProfile?.version ?? 1, createdAt: currentProfile?.createdAt ?? timestamp, updatedAt: timestamp };
      await this.repository.saveProfile(profile, currentProfile?.version);
      return { source: "deterministic_template", wish, assumption: recommended.assumption,
        goal: savedGoal, recommended: savedTask, alternatives: candidates.slice(1) };
    });
  }

  async completeFirstAction(owner: LightTickOwner, input: { taskId: string; baseVersion: number;
    selectedVariant: LightTickTaskVariant; actualMinutes: number; difficulty?: string }) {
    if (!Number.isInteger(input.actualMinutes) || input.actualMinutes < 1 || input.actualMinutes > 1440)
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Actual duration is invalid.");
    if (input.difficulty && !["easy", "right", "hard"].includes(input.difficulty))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Difficulty feedback is invalid.");
    return await this.repository.transaction(owner, async () => {
      let task = await this.repository.getTask(owner, input.taskId);
      if (!task) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Starter task was not found.");
      if ((task.selectedVariant ?? "standard") !== input.selectedVariant)
        task = await this.tasks.switchVariant(owner, task.id, input.baseVersion, input.selectedVariant);
      const completed = await this.tasks.command(owner, task.id, task.version,
        { action: "complete", actualMinutes: input.actualMinutes });
      const profile = await this.repository.getProfile(owner);
      if (!profile) throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Progressive onboarding context is missing.");
      const timestamp = this.clock().toISOString(); const start = this.clock(); const end = new Date(start);
      end.setUTCDate(end.getUTCDate() + 2);
      const plan: LightTickPlanRow = { ...owner, id: randomId("lighttick_plan"), goalId: completed.goalId,
        granularity: "day", status: "active", source: "deterministic_template", periodStart: isoDate(start), periodEnd: isoDate(end),
        proposal: { progressive_stage: "three_day" }, version: 1, createdAt: timestamp, updatedAt: timestamp };
      const savedPlan = await this.repository.savePlan(plan,
        write(owner, "plan", plan.id, "three_day_preview_created", 1, timestamp, { status: "active", goal_id: completed.goalId }));
      const preview: LightTickTaskRow[] = [];
      const base = completed.variantDefinitions ?? starterCandidates(String(profile.onboardingDraft.wish ?? "目标"))[0]!.variants;
      for (let offset = 0; offset < 3; offset++) {
        const day = new Date(start); day.setUTCDate(day.getUTCDate() + offset + 1); const definition = base.light;
        const row: LightTickTaskRow = { ...owner, id: randomId("lighttick_task"), goalId: completed.goalId,
          planId: savedPlan.id, lineageId: randomId("lighttick_lineage"), selectedVariant: "light", variantDefinitions: base,
          title: offset === 0 ? definition.title : `第 ${offset + 2} 次：${definition.title}`,
          completionCriteria: definition.completionCriteria, status: "pending", priority: 50 - offset,
          estimatedMinutes: definition.estimatedMinutes, scheduledFor: `${isoDate(day)}T12:00:00.000Z`, version: 1,
          createdAt: timestamp, updatedAt: timestamp };
        preview.push(await this.repository.saveTask(row,
          write(owner, "task", row.id, "progressive_task_materialized", 1, timestamp,
            { status: "pending", lineage_id: row.lineageId, selected_variant: "light" })));
      }
      const events = await this.repository.listExecutionEvents(owner);
      const actionCount = events.filter(event => event.eventType === "task_complete" && event.payload.valid_action === true).length;
      await this.repository.saveProfile({ ...profile, onboardingState: "three_day_active",
        onboardingDraft: { ...profile.onboardingDraft, progressive_stage: "three_day_active", valid_action_count: actionCount,
          three_day_plan_id: savedPlan.id }, updatedAt: timestamp }, profile.version);
      return { feedback: { estimated_duration_minutes: task.estimatedMinutes, actual_duration_minutes: input.actualMinutes,
        selected_variant: input.selectedVariant, difficulty: input.difficulty, stable_inference: null },
      threeDayPreview: preview, weeklyCommitment: { eligible: actionCount >= 2, valid_action_count: actionCount,
        unlock_requirement: actionCount >= 2 ? null : "complete_one_more_action_or_request_deep_planning" } };
    });
  }

  async selectCommitment(owner: LightTickOwner, input: { goalId: string; mode: LightTickCommitmentMode; deepPlanning?: boolean }) {
    if (!["recovery", "light", "standard", "sprint"].includes(input.mode))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Commitment mode is invalid.");
    const goal = await this.repository.getGoal(owner, input.goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const events = await this.repository.listExecutionEvents(owner);
    const actionCount = events.filter(event => event.eventType === "task_complete" && event.payload.valid_action === true).length;
    if (actionCount < 2 && input.deepPlanning !== true)
      throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID", "Weekly commitment is not eligible yet.",
        { validActionCount: actionCount, requiredActionCount: 2 });
    const profile = await this.repository.getProfile(owner); const timestamp = this.clock().toISOString();
    if (profile) await this.repository.saveProfile({ ...profile, onboardingState: "completed",
      onboardingDraft: { ...profile.onboardingDraft, progressive_stage: "committed", commitment_mode: input.mode,
        valid_action_count: actionCount }, updatedAt: timestamp }, profile.version);
    return { goalId: goal.id, status: goal.status, commitmentMode: input.mode, validActionCount: actionCount };
  }
}
