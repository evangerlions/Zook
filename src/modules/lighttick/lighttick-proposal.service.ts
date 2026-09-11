import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickChangeProposalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "./lighttick.types.ts";
import { assertProposalActionable, transitionPlan, transitionProposal, transitionTask } from "./lighttick-state-machines.ts";
import { aggregateExecutionFacts, evaluateFeedbackRules } from "./lighttick-execution-facts.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

type ProposalDiff =
  | { action: "update_task"; task_id: string; title?: string; estimated_minutes?: number }
  | { action: "cancel_task"; task_id: string }
  | { action: "defer_task"; task_id: string; scheduled_for: string };

export interface ProposalAcceptanceSelection { acceptedDiffIndices?: number[]; editedDiffs?: unknown[]; }

export interface FromFactsProposalResult {
  proposals: LightTickChangeProposalRow[];
  suppressed?: "duplicate_pending" | "rejection_dampening";
}

export class LightTickProposalService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  /**
   * W13-14: evidence-driven proactive proposal. Turns deterministic rule
   * outputs into a pending change proposal with transparent evidence. Never
   * fires when the active plan already has a pending proposal, and backs off
   * after >= 3 rejections in the last 7 days (user rejects control proactivity).
   */
  async proposeFromFacts(owner: LightTickOwner, goalId: string): Promise<FromFactsProposalResult> {
    const goal = await this.repository.getGoal(owner, goalId);
    if (!goal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Goal was not found.");
    const plan = (await this.repository.listPlans(owner, goalId))
      .find(candidate => candidate.status === "active");
    if (!plan) return { proposals: [] };
    const pending = (await this.repository.listProposals(owner, plan.id)).find(proposal => proposal.status === "pending");
    if (pending) return { proposals: [], suppressed: "duplicate_pending" };
    const rejectedRecently = (await this.repository.listProposals(owner))
      .filter(proposal => proposal.status === "rejected" && proposal.decidedAt &&
        Date.parse(proposal.decidedAt) >= this.clock().getTime() - 7 * 86_400_000);
    if (rejectedRecently.length >= 3) return { proposals: [], suppressed: "rejection_dampening" };

    const profile = await this.repository.getProfile(owner);
    const events = await this.repository.listExecutionEvents(owner);
    const facts = aggregateExecutionFacts(events, profile?.timezone ?? "Asia/Shanghai");
    const ruleOutputs = evaluateFeedbackRules(facts);
    const tasks = await this.repository.listTasks(owner, plan.id);
    const diffs = this.buildFactsDiffs(facts, ruleOutputs, tasks);
    if (diffs.length === 0) return { proposals: [] };

    const timestamp = this.clock().toISOString();
    const expiresAt = new Date(this.clock().getTime() + 7 * 86_400_000).toISOString();
    const rule = ruleOutputs.find(output => output.evidenceCount > 0);
    const proposal = await this.repository.saveProposal({ ...owner, id: randomId("lighttick_proposal"), planId: plan.id,
      basePlanVersion: plan.version, status: "pending",
      reason: this.factsReason(ruleOutputs, diffs),
      diff: diffs, impact: { source: "from_facts", rule_id: rule?.ruleId, evidence_count: rule?.evidenceCount,
        data_range: rule?.dataRange }, expiresAt, version: 1, createdAt: timestamp, updatedAt: timestamp });
    return { proposals: [proposal] };
  }

  private buildFactsDiffs(facts: ReturnType<typeof aggregateExecutionFacts>,
    ruleOutputs: ReturnType<typeof evaluateFeedbackRules>, tasks: LightTickTaskRow[]): ProposalDiff[] {
    const diffs: ProposalDiff[] = [];
    const touched = new Set<string>();
    const pendingByLineage = (lineage: string) => tasks.find(task => task.status === "pending" &&
      (task.lineageId ?? task.id) === lineage);
    const skipRule = ruleOutputs.find(output => output.ruleId === "hypothesis.consecutive_skips");
    if (skipRule && typeof skipRule.facts.title === "string" && typeof skipRule.facts.count === "number") {
      const lineage = Object.entries(facts.maxConsecutiveSkipsByLineage)
        .find(([, group]) => group.title === skipRule.facts.title && group.count >= 2)?.[0];
      const task = lineage ? pendingByLineage(lineage) : undefined;
      if (task && !touched.has(task.id)) {
        diffs.push({ action: "cancel_task", task_id: task.id });
        touched.add(task.id);
      }
    }
    const biasRule = ruleOutputs.find(output => output.ruleId === "rule.time_estimation_bias"
      || output.ruleId === "hypothesis.time_estimation_bias");
    if (biasRule && typeof biasRule.facts.title === "string" && typeof biasRule.facts.deviation_minutes === "number"
      && typeof biasRule.facts.count === "number" && biasRule.facts.count >= 3) {
      const lineage = Object.entries(facts.byLineage).find(([, group]) => group.title === biasRule.facts.title)?.[0];
      const task = lineage ? pendingByLineage(lineage) : undefined;
      const ratio = typeof biasRule.facts.ratio === "number" ? biasRule.facts.ratio : 0;
      if (task && !touched.has(task.id) && Math.abs(ratio) >= 0.3 && task.estimatedMinutes > 0) {
        const adjustment = Math.round(biasRule.facts.deviation_minutes / biasRule.facts.count);
        const estimated = Math.min(1440, Math.max(1, task.estimatedMinutes + adjustment));
        if (estimated !== task.estimatedMinutes) {
          diffs.push({ action: "update_task", task_id: task.id, estimated_minutes: estimated });
          touched.add(task.id);
        }
      }
    }
    return diffs;
  }

  private factsReason(ruleOutputs: ReturnType<typeof evaluateFeedbackRules>, diffs: ProposalDiff[]): string {
    const first = ruleOutputs.find(output => output.ruleId === "hypothesis.consecutive_skips"
      || output.ruleId === "rule.time_estimation_bias" || output.ruleId === "hypothesis.time_estimation_bias");
    const summary = diffs.map(diff => diff.action === "cancel_task"
      ? "把连续卡住的任务移出本周" : "按实际耗时修正预计时长").join("，");
    return first ? `${first.message} 建议：${summary}。` : "基于近期执行事实的节奏调整建议。";
  }

  async accept(owner: LightTickOwner, proposalId: string, baseVersion: number, selection: ProposalAcceptanceSelection = {}) {
    const proposal = await this.require(owner, proposalId); assertProposalActionable(proposal.status as "pending", proposal.expiresAt, this.clock());
    if (proposal.version !== baseVersion) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Proposal version is stale.");
    const plan = await this.repository.getPlan(owner, proposal.planId);
    if (!plan || plan.version !== proposal.basePlanVersion || plan.status !== "active") {
      await this.repository.saveProposal({ ...proposal, status: "superseded", decidedAt: this.clock().toISOString() }, proposal.version);
      throw new ApplicationError(409, "LIGHTTICK_PROPOSAL_STALE", "Base plan changed before proposal acceptance.");
    }
    const offered = this.validateDiff(proposal.diff);
    const indices = selection.acceptedDiffIndices ?? offered.map((_, index) => index);
    if (!indices.length || new Set(indices).size !== indices.length || indices.some(index => !Number.isInteger(index) || index < 0 || index >= offered.length))
      throw new ApplicationError(400, "REQ_FIELD_INVALID", "Accepted proposal diff indices are invalid.");
    let diffs = indices.map(index => offered[index]!);
    if (selection.editedDiffs?.length) {
      const edited = this.validateDiff(selection.editedDiffs);
      const selectedTaskIds = new Set(diffs.map(item => item.task_id));
      if (edited.some(item => !selectedTaskIds.has(item.task_id)) || new Set(edited.map(item => item.task_id)).size !== edited.length)
        throw new ApplicationError(400, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Edited diffs must target selected proposal tasks.");
      diffs = diffs.map(item => edited.find(candidate => candidate.task_id === item.task_id) ?? item);
    }
    const timestamp = this.clock().toISOString();
    return await this.repository.transaction(owner, async () => {
      const newPlan: LightTickPlanRow = { ...plan, id: randomId("lighttick_plan"), status: "active",
        source: `proposal:${proposal.id}`, proposal: { parent_plan_id: plan.id, accepted_diff: diffs },
        version: 1, createdAt: timestamp, updatedAt: timestamp };
      const supersededPlan = { ...plan, status: transitionPlan("active", "superseded"), updatedAt: timestamp };
      await this.repository.savePlan(supersededPlan,
        this.planWrite(supersededPlan, "plan_superseded", plan.version + 1, timestamp), plan.version);
      const savedPlan = await this.repository.savePlan(newPlan, this.planWrite(newPlan, "plan_replanned", 1, timestamp));
      const tasks = await this.repository.listTasks(owner, plan.id); const updatedTasks: LightTickTaskRow[] = [];
      for (const task of tasks) {
        const diff = diffs.find(item => item.task_id === task.id); let status = task.status; let scheduledFor = task.scheduledFor;
        let title = task.title; let estimatedMinutes = task.estimatedMinutes;
        if (diff?.action === "cancel_task") status = transitionTask(task.status as any, "cancelled");
        if (diff?.action === "defer_task") { status = transitionTask(task.status as any, "deferred"); scheduledFor = new Date(diff.scheduled_for).toISOString(); }
        if (diff?.action === "update_task") { title = diff.title?.trim() || title; estimatedMinutes = diff.estimated_minutes ?? estimatedMinutes; }
        const next = { ...task, planId: savedPlan.id, status, scheduledFor, title, estimatedMinutes, updatedAt: timestamp };
        updatedTasks.push(await this.repository.saveTask(next, {
          event: { ...owner, id: randomId("lighttick_event"), aggregateType: "task", aggregateId: task.id,
            eventType: "proposal_applied", aggregateVersion: task.version + 1, payload: { proposal_id: proposal.id, diff },
            occurredAt: timestamp, createdAt: timestamp },
          change: { ...owner, entityType: "task", entityId: task.id, entityVersion: task.version + 1,
            operation: "upsert", snapshot: { plan_id: savedPlan.id, status }, changedAt: timestamp },
        }, task.version));
      }
      const accepted = await this.repository.saveProposal({ ...proposal,
        status: transitionProposal("pending", "accepted"), decidedAt: timestamp, updatedAt: timestamp }, proposal.version);
      return { proposal: accepted, plan: savedPlan, tasks: updatedTasks };
    });
  }

  async reject(owner: LightTickOwner, proposalId: string, baseVersion: number) {
    const proposal = await this.require(owner, proposalId); assertProposalActionable(proposal.status as "pending", proposal.expiresAt, this.clock());
    return await this.repository.saveProposal({ ...proposal, status: transitionProposal("pending", "rejected"),
      decidedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() }, baseVersion);
  }
  async expire(owner: LightTickOwner, proposalId: string) {
    const proposal = await this.require(owner, proposalId);
    if (proposal.status !== "pending" || Date.parse(proposal.expiresAt) > this.clock().getTime()) return proposal;
    return await this.repository.saveProposal({ ...proposal, status: transitionProposal("pending", "expired"),
      decidedAt: this.clock().toISOString(), updatedAt: this.clock().toISOString() }, proposal.version);
  }
  private async require(owner: LightTickOwner, id: string) {
    const proposal = await this.repository.getProposal(owner, id);
    if (!proposal) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "Change proposal was not found.");
    return proposal;
  }
  private validateDiff(value: unknown[]): ProposalDiff[] {
    const diffs = value as ProposalDiff[];
    for (const diff of diffs) {
      if (!diff || !["update_task", "cancel_task", "defer_task"].includes(diff.action) || !diff.task_id) {
        throw new ApplicationError(400, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Proposal contains an unsupported diff.");
      }
      if (diff.action === "defer_task" && Number.isNaN(Date.parse(diff.scheduled_for)))
        throw new ApplicationError(400, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Proposal defer date is invalid.");
      if (diff.action === "update_task" && diff.estimated_minutes !== undefined &&
        (!Number.isInteger(diff.estimated_minutes) || diff.estimated_minutes < 1 || diff.estimated_minutes > 1440))
        throw new ApplicationError(400, "LIGHTTICK_PLAN_CONSTRAINT_FAILED", "Proposal duration is invalid.");
    }
    return diffs;
  }
  private planWrite(plan: LightTickPlanRow, eventType: string, version: number, timestamp: string) {
    return { event: { appId: plan.appId, userId: plan.userId, id: randomId("lighttick_event"), aggregateType: "plan",
      aggregateId: plan.id, eventType, aggregateVersion: version, payload: {}, occurredAt: timestamp, createdAt: timestamp },
      change: { appId: plan.appId, userId: plan.userId, entityType: "plan", entityId: plan.id,
        entityVersion: version, operation: "upsert" as const, snapshot: { status: plan.status }, changedAt: timestamp } };
  }
}
