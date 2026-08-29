import type { LightTickRepository } from "./lighttick.repository.ts";
import type { LightTickChangeProposalRow, LightTickOwner, LightTickPlanRow, LightTickTaskRow } from "./lighttick.types.ts";
import { assertProposalActionable, transitionPlan, transitionProposal, transitionTask } from "./lighttick-state-machines.ts";
import { ApplicationError } from "../../shared/errors.ts";
import { randomId } from "../../shared/utils.ts";

type ProposalDiff =
  | { action: "update_task"; task_id: string; title?: string; estimated_minutes?: number }
  | { action: "cancel_task"; task_id: string }
  | { action: "defer_task"; task_id: string; scheduled_for: string };

export class LightTickProposalService {
  constructor(private readonly repository: LightTickRepository, private readonly clock = () => new Date()) {}

  async accept(owner: LightTickOwner, proposalId: string, baseVersion: number) {
    const proposal = await this.require(owner, proposalId); assertProposalActionable(proposal.status as "pending", proposal.expiresAt, this.clock());
    if (proposal.version !== baseVersion) throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Proposal version is stale.");
    const plan = await this.repository.getPlan(owner, proposal.planId);
    if (!plan || plan.version !== proposal.basePlanVersion || plan.status !== "active") {
      await this.repository.saveProposal({ ...proposal, status: "superseded", decidedAt: this.clock().toISOString() }, proposal.version);
      throw new ApplicationError(409, "LIGHTTICK_PROPOSAL_STALE", "Base plan changed before proposal acceptance.");
    }
    const diffs = this.validateDiff(proposal.diff); const timestamp = this.clock().toISOString();
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
