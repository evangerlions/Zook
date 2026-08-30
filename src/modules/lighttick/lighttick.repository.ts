import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow,
  LightTickDeviceRow, LightTickExecutionEventRow, LightTickGoalRow, LightTickGuestIdentityRow,
  LightTickAccountUpgradeCommand, LightTickAccountUpgradeResult,
  LightTickOperationRow, LightTickOwner, LightTickPlanRow, LightTickProfileRow,
  LightTickReviewRow, LightTickTaskRow, LightTickTaskStepRow,
} from "./lighttick.types.ts";

export interface LightTickAtomicWrite {
  event: LightTickExecutionEventRow;
  additionalEvents?: LightTickExecutionEventRow[];
  change: Omit<LightTickChangeRow, "sequence">;
}

/** Product-owned persistence boundary; Common database services stay behavior-free. */
export interface LightTickRepository {
  transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T>;
  getGuestIdentity(owner: LightTickOwner): Promise<LightTickGuestIdentityRow | undefined>;
  getGuestIdentityByDevice(deviceId: string): Promise<LightTickGuestIdentityRow | undefined>;
  saveGuestIdentity(row: LightTickGuestIdentityRow): Promise<LightTickGuestIdentityRow>;
  upgradeGuestAccount(command: LightTickAccountUpgradeCommand): Promise<LightTickAccountUpgradeResult>;
  getProfile(owner: LightTickOwner): Promise<LightTickProfileRow | undefined>;
  saveProfile(row: LightTickProfileRow, expectedVersion?: number): Promise<LightTickProfileRow>;
  listGoals(owner: LightTickOwner): Promise<LightTickGoalRow[]>;
  getGoal(owner: LightTickOwner, id: string): Promise<LightTickGoalRow | undefined>;
  saveGoal(row: LightTickGoalRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickGoalRow>;
  getPlan(owner: LightTickOwner, id: string): Promise<LightTickPlanRow | undefined>;
  listPlans(owner: LightTickOwner, goalId?: string): Promise<LightTickPlanRow[]>;
  getActivePlan(owner: LightTickOwner): Promise<LightTickPlanRow | undefined>;
  savePlan(row: LightTickPlanRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickPlanRow>;
  listTasks(owner: LightTickOwner, planId?: string): Promise<LightTickTaskRow[]>;
  getTask(owner: LightTickOwner, id: string): Promise<LightTickTaskRow | undefined>;
  saveTask(row: LightTickTaskRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickTaskRow>;
  listTaskSteps(owner: LightTickOwner, taskId: string): Promise<LightTickTaskStepRow[]>;
  getTaskStep(owner: LightTickOwner, taskId: string, id: string): Promise<LightTickTaskStepRow | undefined>;
  saveTaskStep(row: LightTickTaskStepRow, expectedVersion?: number): Promise<LightTickTaskStepRow>;
  listExecutionEvents(owner: LightTickOwner, from?: string, to?: string): Promise<LightTickExecutionEventRow[]>;
  listReviews(owner: LightTickOwner): Promise<LightTickReviewRow[]>;
  saveReview(row: LightTickReviewRow): Promise<LightTickReviewRow>;
  getProposal(owner: LightTickOwner, id: string): Promise<LightTickChangeProposalRow | undefined>;
  saveProposal(row: LightTickChangeProposalRow, expectedVersion?: number): Promise<LightTickChangeProposalRow>;
  getAiRun(owner: LightTickOwner, id: string): Promise<LightTickAiRunRow | undefined>;
  saveAiRun(row: LightTickAiRunRow): Promise<LightTickAiRunRow>;
  getOperation(owner: LightTickOwner, operationId: string): Promise<LightTickOperationRow | undefined>;
  saveOperation(row: LightTickOperationRow): Promise<LightTickOperationRow>;
  pullChanges(owner: LightTickOwner, afterSequence: number, limit: number): Promise<LightTickChangeRow[]>;
  upsertDevice(row: LightTickDeviceRow): Promise<LightTickDeviceRow>;
  listDevices(owner: LightTickOwner): Promise<LightTickDeviceRow[]>;
  deleteDevice(owner: LightTickOwner, id: string, deletedAt: string): Promise<boolean>;
  deleteOwnerData(owner: LightTickOwner): Promise<void>;
  /** Aggregated, privacy-safe counters for authenticated Admin views. */
  getAdminOperationalSummary(): Promise<Record<string, number>>;
}
