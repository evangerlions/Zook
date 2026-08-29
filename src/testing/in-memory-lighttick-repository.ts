import type { LightTickAtomicWrite, LightTickRepository } from "../modules/lighttick/lighttick.repository.ts";
import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow, LightTickDeviceRow,
  LightTickAccountUpgradeCommand, LightTickAccountUpgradeResult,
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
  private upgradeOperations = new Map<string, { requestHash: string; result: LightTickAccountUpgradeResult }>();
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
      upgradeOperations: [...this.upgradeOperations],
      events: this.events, changes: this.changes, sequence: this.sequence });
    this.transactionDepth++;
    try { return await operation(); }
    catch (error) {
      this.profiles = new Map(snapshot.profiles); this.goals = new Map(snapshot.goals); this.plans = new Map(snapshot.plans);
      this.tasks = new Map(snapshot.tasks); this.reviews = new Map(snapshot.reviews); this.proposals = new Map(snapshot.proposals);
      this.aiRuns = new Map(snapshot.aiRuns); this.operations = new Map(snapshot.operations); this.devices = new Map(snapshot.devices);
      this.guestIdentities = new Map(snapshot.guestIdentities);
      this.upgradeOperations = new Map(snapshot.upgradeOperations);
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

  async upgradeGuestAccount(command: LightTickAccountUpgradeCommand): Promise<LightTickAccountUpgradeResult> {
    const operationKey = `${command.appId}:${command.operationId}`;
    const previous = this.upgradeOperations.get(operationKey);
    if (previous) {
      if (previous.requestHash !== command.requestHash)
        throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
      return clone({ ...previous.result, idempotencyReplayed: true });
    }
    return await this.transaction({ appId: command.appId, userId: command.guestUserId }, async () => {
      const guestKey = `${command.appId}:${command.guestUserId}`;
      const targetKey = `${command.appId}:${command.targetUserId}`;
      const guest = this.guestIdentities.get(guestKey);
      if (!guest || guest.deviceId !== command.deviceId || guest.upgradeTokenHash !== command.guestUpgradeTokenHash)
        throw new ApplicationError(401, "LIGHTTICK_GUEST_CREDENTIAL_INVALID", "Guest upgrade proof is invalid.");
      if (guest.revokedAt) throw new ApplicationError(410, "LIGHTTICK_GUEST_REVOKED", "Guest session is revoked.");
      if (new Date(guest.expiresAt) <= new Date(command.now))
        throw new ApplicationError(410, "LIGHTTICK_GUEST_EXPIRED", "Guest session is expired.");

      this.assertUpgradeRelationships(guestKey, targetKey);
      const counts = { goals: this.countOwner(this.goals, guestKey), plans: this.countOwner(this.plans, guestKey),
        tasks: this.countOwner(this.tasks, guestKey), reviews: this.countOwner(this.reviews, guestKey),
        proposals: this.countOwner(this.proposals, guestKey) };
      this.mergeProfile(guestKey, targetKey, command.targetUserId);
      for (const store of [this.goals, this.plans, this.tasks, this.reviews, this.proposals, this.aiRuns] as Map<string, any>[])
        this.moveOwnedRows(store, guestKey, targetKey, command.targetUserId);
      this.moveOwnedRows(this.operations as Map<string, any>, guestKey, targetKey, command.targetUserId, true);
      this.mergeDevices(guestKey, targetKey, command.targetUserId);
      this.events = this.events.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.changes = this.changes.map(row => ownerKey(row) === guestKey ? { ...row, userId: command.targetUserId } : row);
      this.guestIdentities.set(guestKey, { ...guest, revokedAt: command.now,
        upgradedToUserId: command.targetUserId, updatedAt: command.now });
      const lastSequence = this.changes.filter(row => ownerKey(row) === targetKey)
        .reduce((maximum, row) => Math.max(maximum, row.sequence), 0);
      const result: LightTickAccountUpgradeResult = { guestUserId: command.guestUserId,
        targetUserId: command.targetUserId, idempotencyReplayed: false, lastSequence,
        transferredResourceCounts: counts };
      this.upgradeOperations.set(operationKey, { requestHash: command.requestHash, result: clone(result) });
      return clone(result);
    });
  }

  private assertUpgradeRelationships(guestKey: string, targetKey: string) {
    const rules: [Map<string, any>, string, Map<string, any>][] = [
      [this.plans, "goalId", this.goals], [this.tasks, "goalId", this.goals],
      [this.tasks, "planId", this.plans],
      [this.reviews, "goalId", this.goals], [this.proposals, "planId", this.plans],
    ];
    for (const [children, foreignKey, parents] of rules) {
      for (const [key, child] of children) {
        if (!key.startsWith(`${guestKey}:`)) continue;
        const related = [...parents.values()].find(parent => parent.id === child[foreignKey]);
        if (!related || ![guestKey, targetKey].includes(ownerKey(related)))
          throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
            "Guest data contains a relationship owned by another account.");
      }
    }
  }

  private countOwner(store: Map<string, unknown>, prefix: string) {
    return [...store.keys()].filter(key => key.startsWith(`${prefix}:`)).length;
  }

  private mergeProfile(guestKey: string, targetKey: string, targetUserId: string) {
    const guest = this.profiles.get(guestKey); const target = this.profiles.get(targetKey);
    if (!guest) return;
    if (!target) { this.profiles.set(targetKey, { ...guest, userId: targetUserId }); this.profiles.delete(guestKey); return; }
    const rank = (state: string) => ({ not_started: 0, drafting: 1, starter_ready: 2,
      three_day_active: 3, completed: 4 } as Record<string, number>)[state] ?? 0;
    const guestAhead = rank(guest.onboardingState) > rank(target.onboardingState);
    this.profiles.set(targetKey, { ...target,
      onboardingState: guestAhead ? guest.onboardingState : target.onboardingState,
      onboardingDraft: guestAhead && Object.keys(target.onboardingDraft).length === 0
        ? guest.onboardingDraft : target.onboardingDraft,
      version: Math.max(target.version, guest.version),
      updatedAt: target.updatedAt >= guest.updatedAt ? target.updatedAt : guest.updatedAt });
    this.profiles.delete(guestKey);
  }

  private moveOwnedRows(store: Map<string, any>, guestKey: string, targetKey: string,
    targetUserId: string, operationStore = false) {
    for (const [key, row] of [...store]) {
      if (!key.startsWith(`${guestKey}:`)) continue;
      const suffix = key.slice(guestKey.length + 1); const destination = `${targetKey}:${suffix}`;
      const existing = store.get(destination);
      if (existing) {
        const equivalent = operationStore
          ? existing.action === row.action && existing.payloadHash === row.payloadHash
            && JSON.stringify(existing.resultPayload) === JSON.stringify(row.resultPayload)
          : JSON.stringify({ ...existing, userId: undefined }) === JSON.stringify({ ...row, userId: undefined });
        if (!equivalent) throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT", "Guest data conflicts with registered account data.");
        store.delete(key); continue;
      }
      store.set(destination, { ...row, userId: targetUserId }); store.delete(key);
    }
  }

  private mergeDevices(guestKey: string, targetKey: string, targetUserId: string) {
    for (const [key, row] of [...this.devices]) {
      if (!key.startsWith(`${guestKey}:`)) continue;
      const destination = `${targetKey}:${row.id}`;
      const duplicateToken = [...this.devices.values()].some(item => ownerKey(item) === targetKey
        && item.pushProvider === row.pushProvider && item.pushToken === row.pushToken);
      if (!this.devices.has(destination) && !duplicateToken)
        this.devices.set(destination, { ...row, userId: targetUserId });
      this.devices.delete(key);
    }
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
    for (const [key, operation] of this.upgradeOperations)
      if (operation.result.guestUserId === owner.userId || operation.result.targetUserId === owner.userId)
        this.upgradeOperations.delete(key);
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
