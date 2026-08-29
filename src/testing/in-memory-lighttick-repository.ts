import type { LightTickAtomicWrite, LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow, LightTickDeviceRow,
  LightTickExecutionEventRow, LightTickGoalRow, LightTickGuestIdentityRow, LightTickOperationRow, LightTickOwner,
  LightTickPlanRow, LightTickProfileRow, LightTickReviewRow, LightTickTaskRow,
} from "../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../shared/errors.ts";

type VersionedOwnerRow = { id?: string; appId: "lighttick"; userId: string; version: number; updatedAt: string };
const clone = <T>(value: T): T => structuredClone(value);
const ownerKey = (owner: LightTickOwner) => `${owner.appId}:${owner.userId}`;
const rowKey = (row: LightTickOwner & { id: string }) => `${ownerKey(row)}:${row.id}`;

export class InMemoryLightTickRepository implements LightTickRepository {
  private profiles = new Map<string, LightTickProfileRow>();
  private goals = new Map<string, LightTickGoalRow>();
  private plans = new Map<string, LightTickPlanRow>();
  private tasks = new Map<string, LightTickTaskRow>();
  private reviews = new Map<string, LightTickReviewRow>();
  private proposals = new Map<string, LightTickChangeProposalRow>();
  private aiRuns = new Map<string, LightTickAiRunRow>();
  private operations = new Map<string, LightTickOperationRow>();
  private devices = new Map<string, LightTickDeviceRow>();
  private guestIdentities = new Map<string, LightTickGuestIdentityRow>();
  private events: LightTickExecutionEventRow[] = [];
  private changes: LightTickChangeRow[] = [];
  private sequence = 0;
  private transactionDepth = 0;

  async transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T> {
    this.assertOwner(owner);
    if (this.transactionDepth) return await operation();
    const snapshot = clone({ profiles: [...this.profiles], goals: [...this.goals], plans: [...this.plans],
      tasks: [...this.tasks], reviews: [...this.reviews], proposals: [...this.proposals], aiRuns: [...this.aiRuns],
      operations: [...this.operations], devices: [...this.devices], guestIdentities: [...this.guestIdentities],
      events: this.events, changes: this.changes, sequence: this.sequence });
    this.transactionDepth++;
    try { return await operation(); }
    catch (error) {
      this.profiles = new Map(snapshot.profiles); this.goals = new Map(snapshot.goals); this.plans = new Map(snapshot.plans);
      this.tasks = new Map(snapshot.tasks); this.reviews = new Map(snapshot.reviews); this.proposals = new Map(snapshot.proposals);
      this.aiRuns = new Map(snapshot.aiRuns); this.operations = new Map(snapshot.operations); this.devices = new Map(snapshot.devices);
      this.guestIdentities = new Map(snapshot.guestIdentities);
      this.events = snapshot.events; this.changes = snapshot.changes; this.sequence = snapshot.sequence;
      throw error;
    } finally { this.transactionDepth--; }
  }

  private assertOwner(owner: LightTickOwner) {
    if (owner.appId !== "lighttick") throw new Error("LightTick repository requires appId=lighttick");
  }
  private versioned<T extends VersionedOwnerRow>(current: T | undefined, input: T, expectedVersion?: number): T {
    this.assertOwner(input);
    if (expectedVersion !== undefined && current?.version !== expectedVersion) {
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.");
    }
    if (expectedVersion === undefined && current) {
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource already exists.");
    }
    return clone({ ...input, version: current ? current.version + 1 : 1, updatedAt: input.updatedAt });
  }
  private append(write: LightTickAtomicWrite) {
    this.events.push(clone(write.event));
    this.events.push(...clone(write.additionalEvents ?? []));
    this.changes.push(clone({ ...write.change, sequence: ++this.sequence }));
  }

  async getGuestIdentity(owner: LightTickOwner) { return clone(this.guestIdentities.get(ownerKey(owner))); }
  async getGuestIdentityByDevice(deviceId: string) {
    return clone([...this.guestIdentities.values()].find(row => row.deviceId === deviceId));
  }
  async saveGuestIdentity(row: LightTickGuestIdentityRow) {
    this.assertOwner(row);
    for (const [key, existing] of this.guestIdentities) if (existing.deviceId === row.deviceId && key !== ownerKey(row))
      this.guestIdentities.delete(key);
    this.guestIdentities.set(ownerKey(row), clone(row)); return clone(row);
  }

  async getProfile(owner: LightTickOwner) { return clone(this.profiles.get(ownerKey(owner))); }
  async saveProfile(row: LightTickProfileRow, expectedVersion?: number) {
    const saved = this.versioned(this.profiles.get(ownerKey(row)), row, expectedVersion);
    this.profiles.set(ownerKey(row), saved); return clone(saved);
  }
  async listGoals(owner: LightTickOwner) { return clone([...this.goals.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async getGoal(owner: LightTickOwner, id: string) { return clone(this.goals.get(`${ownerKey(owner)}:${id}`)); }
  async saveGoal(row: LightTickGoalRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.goals, row, write, expectedVersion);
  }
  async getPlan(owner: LightTickOwner, id: string) { return clone(this.plans.get(`${ownerKey(owner)}:${id}`)); }
  async getActivePlan(owner: LightTickOwner) {
    return clone([...this.plans.values()].filter(row => ownerKey(row) === ownerKey(owner) && row.status === "active")
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0]);
  }
  async savePlan(row: LightTickPlanRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.plans, row, write, expectedVersion);
  }
  async listTasks(owner: LightTickOwner, planId?: string) {
    return clone([...this.tasks.values()].filter(row => ownerKey(row) === ownerKey(owner) && (!planId || row.planId === planId)));
  }
  async getTask(owner: LightTickOwner, id: string) { return clone(this.tasks.get(`${ownerKey(owner)}:${id}`)); }
  async saveTask(row: LightTickTaskRow, write: LightTickAtomicWrite, expectedVersion?: number) {
    return await this.saveAggregate(this.tasks, row, write, expectedVersion);
  }
  private async saveAggregate<T extends VersionedOwnerRow & { id: string }>(store: Map<string, T>, row: T,
    write: LightTickAtomicWrite, expectedVersion?: number): Promise<T> {
    return await this.transaction(row, async () => {
      const saved = this.versioned(store.get(rowKey(row)), row, expectedVersion);
      store.set(rowKey(row), saved); this.append(write); return clone(saved);
    });
  }

  async listReviews(owner: LightTickOwner) { return clone([...this.reviews.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async saveReview(row: LightTickReviewRow) { this.assertOwner(row); this.reviews.set(rowKey(row), clone(row)); return clone(row); }
  async getProposal(owner: LightTickOwner, id: string) { return clone(this.proposals.get(`${ownerKey(owner)}:${id}`)); }
  async saveProposal(row: LightTickChangeProposalRow, expectedVersion?: number) {
    const saved = this.versioned(this.proposals.get(rowKey(row)), row, expectedVersion);
    this.proposals.set(rowKey(row), saved); return clone(saved);
  }
  async getAiRun(owner: LightTickOwner, id: string) { return clone(this.aiRuns.get(`${ownerKey(owner)}:${id}`)); }
  async saveAiRun(row: LightTickAiRunRow) { this.assertOwner(row); this.aiRuns.set(rowKey(row), clone(row)); return clone(row); }
  async getOperation(owner: LightTickOwner, operationId: string) { return clone(this.operations.get(`${ownerKey(owner)}:${operationId}`)); }
  async saveOperation(row: LightTickOperationRow) {
    this.assertOwner(row); const key = `${ownerKey(row)}:${row.operationId}`;
    const existing = this.operations.get(key); if (existing) return clone(existing);
    this.operations.set(key, clone(row)); return clone(row);
  }
  async pullChanges(owner: LightTickOwner, afterSequence: number, limit: number) {
    return clone(this.changes.filter(row => ownerKey(row) === ownerKey(owner) && row.sequence > afterSequence).slice(0, limit));
  }
  async upsertDevice(row: LightTickDeviceRow) { this.assertOwner(row); this.devices.set(rowKey(row), clone(row)); return clone(row); }
  async listDevices(owner: LightTickOwner) { return clone([...this.devices.values()].filter(row => ownerKey(row) === ownerKey(owner))); }
  async deleteDevice(owner: LightTickOwner, id: string, deletedAt: string) {
    const key = `${ownerKey(owner)}:${id}`; const row = this.devices.get(key); if (!row?.active) return false;
    this.devices.set(key, { ...row, active: false, deletedAt, updatedAt: deletedAt }); return true;
  }
  async deleteOwnerData(owner: LightTickOwner) {
    const prefix = `${ownerKey(owner)}:`;
    this.profiles.delete(ownerKey(owner));
    this.guestIdentities.delete(ownerKey(owner));
    for (const store of [this.goals,this.plans,this.tasks,this.reviews,this.proposals,this.aiRuns,this.operations,this.devices]) {
      for (const key of store.keys()) if (key.startsWith(prefix)) store.delete(key);
    }
    this.events = this.events.filter(row => ownerKey(row) !== ownerKey(owner));
    this.changes = this.changes.filter(row => ownerKey(row) !== ownerKey(owner));
  }
  async listExecutionEvents(owner: LightTickOwner, from?: string, to?: string) {
    return clone(this.events.filter(row => ownerKey(row) === ownerKey(owner) &&
      (!from || row.occurredAt >= from) && (!to || row.occurredAt < to)));
  }
  async getAdminOperationalSummary() {
    return { profiles: this.profiles.size, onboarding_completed: [...this.profiles.values()].filter(row => row.onboardingState === "completed").length,
      goals: this.goals.size, plans: this.plans.size, plan_confirmations: this.events.filter(row => row.eventType === "plan_confirmed").length,
      tasks: this.tasks.size, task_actions: this.events.filter(row => row.aggregateType === "task" && row.eventType.startsWith("task_")).length,
      reviews: this.reviews.size, pending_proposals: [...this.proposals.values()].filter(row => row.status === "pending").length,
      proposals_accepted: [...this.proposals.values()].filter(row => row.status === "accepted").length,
      ai_runs: this.aiRuns.size, ai_failures: [...this.aiRuns.values()].filter(row => row.status === "failed").length,
      ai_schema_failures: [...this.aiRuns.values()].filter(row => row.errorCode === "LIGHTTICK_AI_RUN_FAILED").length,
      ai_average_latency_ms: average([...this.aiRuns.values()].map(row => row.latencyMs).filter((value): value is number => value !== undefined)),
      ai_total_tokens: [...this.aiRuns.values()].reduce((sum, row) => sum + Number(row.usage.totalTokens ?? 0), 0),
      sync_conflicts: [...this.operations.values()].filter(row => row.status === "conflict").length,
      notification_failures: [...this.operations.values()].filter(row => row.entityType === "notification" && row.status !== "accepted").length,
      active_devices: [...this.devices.values()].filter(row => row.active).length };
  }
}

function average(values: number[]) { return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length) : 0; }
