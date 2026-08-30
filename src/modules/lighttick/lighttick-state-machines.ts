import { ApplicationError } from "../../shared/errors.ts";

export type LightTickGoalStatus = "draft" | "active" | "paused" | "recovering" | "completed" | "archived";
export type LightTickPlanStatus = "generating" | "proposed" | "active" | "superseded" | "failed";
export type LightTickTaskStatus = "pending" | "in_progress" | "completed" | "skipped" | "deferred" | "cancelled";
export type LightTickReviewStatus = "generating" | "ready" | "acknowledged" | "failed";
export type LightTickProposalStatus = "pending" | "accepted" | "rejected" | "expired" | "superseded";

type TransitionMap<S extends string> = Readonly<Record<S, readonly S[]>>;

const goalTransitions: TransitionMap<LightTickGoalStatus> = {
  draft: ["active", "archived"], active: ["paused", "completed", "archived"],
  paused: ["active", "recovering", "archived"], recovering: ["active", "paused", "completed", "archived"],
  completed: ["archived"], archived: [],
};
const planTransitions: TransitionMap<LightTickPlanStatus> = {
  generating: ["proposed", "failed"], proposed: ["active", "failed", "superseded"],
  active: ["superseded"], superseded: [], failed: [],
};
const taskTransitions: TransitionMap<LightTickTaskStatus> = {
  pending: ["in_progress", "completed", "skipped", "deferred", "cancelled"],
  in_progress: ["completed", "skipped", "deferred", "cancelled"],
  completed: [], skipped: [], deferred: [], cancelled: [],
};
const reviewTransitions: TransitionMap<LightTickReviewStatus> = {
  generating: ["ready", "failed"], ready: ["acknowledged"], acknowledged: [], failed: [],
};
const proposalTransitions: TransitionMap<LightTickProposalStatus> = {
  pending: ["accepted", "rejected", "expired", "superseded"],
  accepted: [], rejected: [], expired: [], superseded: [],
};

function transition<S extends string>(resource: string, transitions: TransitionMap<S>, from: S, to: S): S {
  if (from === to || !transitions[from].includes(to)) {
    throw new ApplicationError(409, "LIGHTTICK_STATE_TRANSITION_INVALID",
      `Invalid ${resource} state transition.`, { resource, from, to });
  }
  return to;
}

export const transitionGoal = (from: LightTickGoalStatus, to: LightTickGoalStatus) =>
  transition("goal", goalTransitions, from, to);
export const transitionPlan = (from: LightTickPlanStatus, to: LightTickPlanStatus) =>
  transition("plan", planTransitions, from, to);
export const transitionTask = (from: LightTickTaskStatus, to: LightTickTaskStatus) =>
  transition("task", taskTransitions, from, to);
export const transitionReview = (from: LightTickReviewStatus, to: LightTickReviewStatus) =>
  transition("review", reviewTransitions, from, to);
export const transitionProposal = (from: LightTickProposalStatus, to: LightTickProposalStatus) =>
  transition("change_proposal", proposalTransitions, from, to);

export function isTerminalTaskStatus(status: LightTickTaskStatus): boolean {
  return taskTransitions[status].length === 0;
}

export function assertProposalActionable(status: LightTickProposalStatus, expiresAt: string, now = new Date()): void {
  if (status !== "pending") {
    throw new ApplicationError(409, "LIGHTTICK_PROPOSAL_NOT_PENDING", "Change proposal is no longer pending.");
  }
  if (Date.parse(expiresAt) <= now.getTime()) {
    throw new ApplicationError(409, "LIGHTTICK_PROPOSAL_STALE", "Change proposal has expired.");
  }
}
