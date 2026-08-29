import { AsyncLocalStorage } from "node:async_hooks";
import type { LightTickRepository, LightTickAtomicWrite } from "../../../modules/lighttick/lighttick.repository.ts";
import type {
  LightTickAiRunRow, LightTickChangeProposalRow, LightTickChangeRow, LightTickDeviceRow,
  LightTickAccountUpgradeCommand, LightTickAccountUpgradeResult,
  LightTickGoalRow, LightTickGuestIdentityRow, LightTickOperationRow, LightTickOwner, LightTickPlanRow,
  LightTickProfileRow, LightTickReviewRow, LightTickTaskRow,
} from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";

type QueryResult = { rows: Record<string, unknown>[]; rowCount?: number | null };
type QueryClient = { query(sql: string, values?: unknown[]): Promise<QueryResult>; release?(): void };
type Connector = QueryClient & { connect(): Promise<QueryClient> };

function snakeToCamel(key: string): string {
  return key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

function mapRow<T>(row: Record<string, unknown>): T {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [
    snakeToCamel(key), value instanceof Date ? value.toISOString() : value,
  ])) as T;
}

function versionConflict(resourceId: string): never {
  throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Resource version is stale.", { resourceId });
}

export class PostgresLightTickRepository implements LightTickRepository {
  private readonly session = new AsyncLocalStorage<QueryClient>();
  constructor(private readonly connector: Connector,
    private readonly transactionRunner?: <T>(operation: () => Promise<T>) => Promise<T>) {}

  private async query(sql: string, values: unknown[] = []): Promise<QueryResult> {
    return await (this.session.getStore() ?? this.connector).query(sql, values);
  }

  async getGuestIdentity(owner: LightTickOwner): Promise<LightTickGuestIdentityRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_guest_identities WHERE app_id=$1 AND user_id=$2", [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickGuestIdentityRow>(result.rows[0]) : undefined;
  }
  async getGuestIdentityByDevice(deviceId: string): Promise<LightTickGuestIdentityRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_guest_identities WHERE app_id='lighttick' AND device_id=$1", [deviceId]);
    return result.rows[0] ? mapRow<LightTickGuestIdentityRow>(result.rows[0]) : undefined;
  }
  async saveGuestIdentity(row: LightTickGuestIdentityRow): Promise<LightTickGuestIdentityRow> {
    const result = await this.query(`INSERT INTO zook_lighttick_guest_identities
      (app_id,user_id,device_id,device_secret_hash,platform,timezone,locale,app_version,upgrade_token_hash,expires_at,revoked_at,upgraded_to_user_id,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (app_id,device_id) DO UPDATE SET user_id=EXCLUDED.user_id,device_secret_hash=EXCLUDED.device_secret_hash,
      platform=EXCLUDED.platform,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,app_version=EXCLUDED.app_version,
      upgrade_token_hash=EXCLUDED.upgrade_token_hash,expires_at=EXCLUDED.expires_at,revoked_at=EXCLUDED.revoked_at,
      upgraded_to_user_id=EXCLUDED.upgraded_to_user_id,updated_at=EXCLUDED.updated_at RETURNING *`,
      [row.appId,row.userId,row.deviceId,row.deviceSecretHash,row.platform,row.timezone,row.locale,row.appVersion,
        row.upgradeTokenHash,row.expiresAt,row.revokedAt ?? null,row.upgradedToUserId ?? null,row.createdAt,row.updatedAt]);
    return mapRow<LightTickGuestIdentityRow>(result.rows[0]!);
  }

  async upgradeGuestAccount(command: LightTickAccountUpgradeCommand): Promise<LightTickAccountUpgradeResult> {
    return await this.transaction({ appId: command.appId, userId: command.guestUserId }, async () => {
      await this.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${command.appId}:${command.operationId}`]);
      const prior = await this.query(`SELECT request_hash,result_payload FROM zook_lighttick_account_upgrades
        WHERE app_id=$1 AND operation_id=$2 FOR UPDATE`, [command.appId, command.operationId]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== command.requestHash)
          throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
        return { ...(prior.rows[0].result_payload as unknown as LightTickAccountUpgradeResult), idempotencyReplayed: true };
      }

      const identityResult = await this.query(`SELECT * FROM zook_lighttick_guest_identities
        WHERE app_id=$1 AND user_id=$2 FOR UPDATE`, [command.appId, command.guestUserId]);
      const identity = identityResult.rows[0];
      if (!identity || identity.device_id !== command.deviceId || identity.upgrade_token_hash !== command.guestUpgradeTokenHash)
        throw new ApplicationError(401, "LIGHTTICK_GUEST_CREDENTIAL_INVALID", "Guest upgrade proof is invalid.");
      if (identity.revoked_at)
        throw new ApplicationError(410, "LIGHTTICK_GUEST_REVOKED", "Guest session is revoked.");
      if (new Date(String(identity.expires_at)) <= new Date(command.now))
        throw new ApplicationError(410, "LIGHTTICK_GUEST_EXPIRED", "Guest session is expired.");

      const target = await this.query(`SELECT u.password_algo,au.status FROM zook_users u
        JOIN zook_app_users au ON au.user_id=u.id AND au.app_id=$1
        WHERE u.id=$2 FOR UPDATE OF au`, [command.appId, command.targetUserId]);
      if (!target.rows[0] || target.rows[0].password_algo === "lighttick-guest" || target.rows[0].status !== "ACTIVE")
        throw new ApplicationError(403, "LIGHTTICK_APP_ACCESS_DENIED", "A registered LightTick account is required.");

      await this.assertUpgradeRelationships(command);
      const count = async (table: string) => Number((await this.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE app_id=$1 AND user_id=$2`,
        [command.appId, command.guestUserId])).rows[0]?.count ?? 0);
      const counts = { goals: await count("zook_lighttick_goals"), plans: await count("zook_lighttick_plan_cycles"),
        tasks: await count("zook_lighttick_tasks"), reviews: await count("zook_lighttick_reviews"),
        proposals: await count("zook_lighttick_change_proposals") };

      await this.mergeUpgradeProfiles(command);
      await this.mergeUpgradeOperations(command);
      await this.query(`DELETE FROM zook_lighttick_devices guest USING zook_lighttick_devices target
        WHERE guest.app_id=$1 AND guest.user_id=$2 AND target.app_id=$1 AND target.user_id=$3
          AND (target.id=guest.id OR (target.push_provider=guest.push_provider AND target.push_token=guest.push_token))`,
        [command.appId, command.guestUserId, command.targetUserId]);
      const ownerTables = ["zook_lighttick_goals", "zook_lighttick_plan_cycles", "zook_lighttick_tasks",
        "zook_lighttick_task_steps", "zook_lighttick_execution_events", "zook_lighttick_reviews",
        "zook_lighttick_change_proposals", "zook_lighttick_ai_runs", "zook_lighttick_change_log",
        "zook_lighttick_sync_cursors", "zook_lighttick_devices"];
      for (const table of ownerTables) await this.query(
        `UPDATE ${table} SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
        [command.targetUserId, command.appId, command.guestUserId]);

      await this.query(`UPDATE zook_lighttick_guest_identities SET revoked_at=$1,upgraded_to_user_id=$2,updated_at=$1
        WHERE app_id=$3 AND user_id=$4`, [command.now, command.targetUserId, command.appId, command.guestUserId]);
      const sequence = await this.query(`SELECT COALESCE(MAX(sequence),0) AS sequence FROM zook_lighttick_change_log
        WHERE app_id=$1 AND user_id=$2`, [command.appId, command.targetUserId]);
      const result: LightTickAccountUpgradeResult = { guestUserId: command.guestUserId,
        targetUserId: command.targetUserId, idempotencyReplayed: false,
        lastSequence: Number(sequence.rows[0]?.sequence ?? 0), transferredResourceCounts: counts };
      await this.query(`INSERT INTO zook_lighttick_account_upgrades
        (app_id,operation_id,request_hash,guest_user_id,target_user_id,status,result_payload,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$7)`, [command.appId,command.operationId,
        command.requestHash,command.guestUserId,command.targetUserId,JSON.stringify(result),command.now]);
      return result;
    });
  }

  private async assertUpgradeRelationships(command: LightTickAccountUpgradeCommand) {
    const relations = [
      ["zook_lighttick_plan_cycles", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_tasks", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_tasks", "plan_id", "zook_lighttick_plan_cycles"],
      ["zook_lighttick_task_steps", "task_id", "zook_lighttick_tasks"],
      ["zook_lighttick_reviews", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_change_proposals", "plan_id", "zook_lighttick_plan_cycles"],
    ] as const;
    for (const [childTable, foreignKey, parentTable] of relations) {
      const mismatch = await this.query(`SELECT child.id FROM ${childTable} child
        LEFT JOIN ${parentTable} parent ON parent.id=child.${foreignKey}
        WHERE child.app_id=$1 AND child.user_id=$2
          AND (parent.id IS NULL OR parent.app_id<>$1 OR parent.user_id NOT IN ($2,$3)) LIMIT 1`,
      [command.appId, command.guestUserId, command.targetUserId]);
      if (mismatch.rows[0])
        throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT",
          "Guest data contains a relationship owned by another account.");
    }
  }

  private async mergeUpgradeProfiles(command: LightTickAccountUpgradeCommand) {
    const profiles = await this.query(`SELECT * FROM zook_lighttick_profiles
      WHERE app_id=$1 AND user_id IN ($2,$3) FOR UPDATE`, [command.appId,command.guestUserId,command.targetUserId]);
    const guest = profiles.rows.find(row => row.user_id === command.guestUserId);
    const target = profiles.rows.find(row => row.user_id === command.targetUserId);
    if (!guest) return;
    if (!target) {
      await this.query(`UPDATE zook_lighttick_profiles SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
        [command.targetUserId,command.appId,command.guestUserId]); return;
    }
    const ranks: Record<string, number> = { not_started: 0, drafting: 1, starter_ready: 2, three_day_active: 3, completed: 4 };
    const guestAhead = (ranks[String(guest.onboarding_state)] ?? 0) > (ranks[String(target.onboarding_state)] ?? 0);
    const targetDraft = target.onboarding_draft as Record<string, unknown> | undefined;
    await this.query(`UPDATE zook_lighttick_profiles SET onboarding_state=$1,onboarding_draft=$2::jsonb,
      version=GREATEST(version,$3),updated_at=GREATEST(updated_at,$4::timestamptz) WHERE app_id=$5 AND user_id=$6`,
      [guestAhead ? guest.onboarding_state : target.onboarding_state,
        JSON.stringify(guestAhead && Object.keys(targetDraft ?? {}).length === 0 ? guest.onboarding_draft : target.onboarding_draft),
        Number(guest.version), String(guest.updated_at), command.appId, command.targetUserId]);
    await this.query("DELETE FROM zook_lighttick_profiles WHERE app_id=$1 AND user_id=$2", [command.appId,command.guestUserId]);
  }

  private async mergeUpgradeOperations(command: LightTickAccountUpgradeCommand) {
    const collisions = await this.query(`SELECT guest.operation_id,guest.action AS guest_action,target.action AS target_action,
      guest.payload_hash AS guest_hash,target.payload_hash AS target_hash,
      guest.result_payload = target.result_payload AS same_result
      FROM zook_lighttick_operations guest JOIN zook_lighttick_operations target
        ON target.app_id=guest.app_id AND target.operation_id=guest.operation_id AND target.user_id=$1
      WHERE guest.app_id=$2 AND guest.user_id=$3 FOR UPDATE OF guest,target`,
      [command.targetUserId,command.appId,command.guestUserId]);
    for (const row of collisions.rows) {
      if (row.guest_action !== row.target_action || row.guest_hash !== row.target_hash || row.same_result !== true)
        throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT", "Guest operations conflict with registered account operations.");
      await this.query(`DELETE FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id=$3`,
        [command.appId,command.guestUserId,row.operation_id]);
    }
    await this.query(`UPDATE zook_lighttick_operations SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
      [command.targetUserId,command.appId,command.guestUserId]);
  }

  async transaction<T>(owner: LightTickOwner, operation: () => Promise<T>): Promise<T> {
    if (owner.appId !== "lighttick") throw new Error("LightTick repository requires appId=lighttick");
    if (this.session.getStore()) return await operation();
    if (this.transactionRunner) return await this.transactionRunner(operation);
    const client = await this.connector.connect();
    try {
      await client.query("BEGIN");
      const result = await this.session.run(client, operation);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release?.();
    }
  }

  async getProfile(owner: LightTickOwner): Promise<LightTickProfileRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_profiles WHERE app_id = $1 AND user_id = $2", [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickProfileRow>(result.rows[0]) : undefined;
  }

  async saveProfile(row: LightTickProfileRow, expectedVersion?: number): Promise<LightTickProfileRow> {
    const values = [row.timezone, row.locale, row.pace, row.onboardingState,
      JSON.stringify(row.notificationPreferences), JSON.stringify(row.onboardingDraft), row.appId, row.userId];
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_profiles SET timezone=$1, locale=$2, pace=$3,
        onboarding_state=$4, notification_preferences=$5::jsonb, onboarding_draft=$6::jsonb,
        version=version+1, updated_at=NOW() WHERE app_id=$7 AND user_id=$8 AND version=$9 RETURNING *`, [...values, expectedVersion]);
      if (!result.rows[0]) versionConflict(row.userId);
      return mapRow<LightTickProfileRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_profiles
      (app_id,user_id,timezone,locale,pace,onboarding_state,notification_preferences,onboarding_draft,version,created_at,updated_at)
      VALUES ($7,$8,$1,$2,$3,$4,$5::jsonb,$6::jsonb,1,NOW(),NOW()) RETURNING *`, values);
    return mapRow<LightTickProfileRow>(result.rows[0]!);
  }

  async listGoals(owner: LightTickOwner): Promise<LightTickGoalRow[]> {
    const result = await this.query("SELECT * FROM zook_lighttick_goals WHERE app_id=$1 AND user_id=$2 ORDER BY updated_at DESC", [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickGoalRow>);
  }
  async getGoal(owner: LightTickOwner, id: string): Promise<LightTickGoalRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_goals WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickGoalRow>(result.rows[0]) : undefined;
  }
  async saveGoal(row: LightTickGoalRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickGoalRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_goals",
      ["title", "description", "status", "constraints", "target_date", "pause_metadata", "recovery_started_at"],
      [row.title, row.description ?? null, row.status, JSON.stringify(row.constraints), row.targetDate ?? null,
        JSON.stringify(row.pauseMetadata ?? {}), row.recoveryStartedAt ?? null]);
  }

  async getPlan(owner: LightTickOwner, id: string): Promise<LightTickPlanRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_plan_cycles WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickPlanRow>(result.rows[0]) : undefined;
  }
  async getActivePlan(owner: LightTickOwner): Promise<LightTickPlanRow | undefined> {
    const result = await this.query(`SELECT * FROM zook_lighttick_plan_cycles WHERE app_id=$1 AND user_id=$2
      AND status='active' ORDER BY updated_at DESC LIMIT 1`, [owner.appId, owner.userId]);
    return result.rows[0] ? mapRow<LightTickPlanRow>(result.rows[0]) : undefined;
  }
  async savePlan(row: LightTickPlanRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickPlanRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_plan_cycles",
      ["goal_id", "granularity", "status", "source", "period_start", "period_end", "proposal"],
      [row.goalId, row.granularity, row.status, row.source, row.periodStart, row.periodEnd, JSON.stringify(row.proposal)]);
  }

  async listTasks(owner: LightTickOwner, planId?: string): Promise<LightTickTaskRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2
      ${planId ? "AND plan_id=$3" : ""} ORDER BY scheduled_for NULLS LAST, priority DESC`, planId ? [owner.appId, owner.userId, planId] : [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickTaskRow>);
  }
  async getTask(owner: LightTickOwner, id: string): Promise<LightTickTaskRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_tasks WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId, owner.userId, id]);
    return result.rows[0] ? mapRow<LightTickTaskRow>(result.rows[0]) : undefined;
  }
  async saveTask(row: LightTickTaskRow, write: LightTickAtomicWrite, expectedVersion?: number): Promise<LightTickTaskRow> {
    return await this.saveAggregate(row, write, expectedVersion, "zook_lighttick_tasks",
      ["goal_id", "plan_id", "title", "status", "priority", "estimated_minutes", "scheduled_for", "started_at", "completed_at", "notes",
        "lineage_id", "selected_variant", "variant_definitions", "completion_criteria", "actual_minutes", "commitment_satisfied"],
      [row.goalId, row.planId, row.title, row.status, row.priority, row.estimatedMinutes, row.scheduledFor ?? null,
        row.startedAt ?? null, row.completedAt ?? null, row.notes ?? null, row.lineageId ?? row.id,
        row.selectedVariant ?? "standard", JSON.stringify(row.variantDefinitions ?? {}), row.completionCriteria ?? null,
        row.actualMinutes ?? null, row.commitmentSatisfied ?? null]);
  }
  async listExecutionEvents(owner: LightTickOwner, from?: string, to?: string) {
    const result = await this.query(`SELECT * FROM zook_lighttick_execution_events WHERE app_id=$1 AND user_id=$2
      ${from ? "AND occurred_at >= $3" : ""} ${to ? `AND occurred_at < $${from ? 4 : 3}` : ""}
      ORDER BY occurred_at ASC`, [owner.appId, owner.userId, ...(from ? [from] : []), ...(to ? [to] : [])]);
    return result.rows.map(mapRow<import("../../../modules/lighttick/lighttick.types.ts").LightTickExecutionEventRow>);
  }

  private async saveAggregate<T extends { id: string; appId: "lighttick"; userId: string }>(
    row: T, write: LightTickAtomicWrite, expectedVersion: number | undefined,
    table: string, columns: string[], values: unknown[],
  ): Promise<T> {
    return await this.transaction(row, async () => {
      let result: QueryResult;
      if (expectedVersion === undefined) {
        const placeholders = columns.map((_, index) => `$${index + 4}`).join(",");
        result = await this.query(`INSERT INTO ${table} (id,app_id,user_id,${columns.join(",")},version,created_at,updated_at)
          VALUES ($1,$2,$3,${placeholders},1,NOW(),NOW()) RETURNING *`, [row.id, row.appId, row.userId, ...values]);
      } else {
        const assignments = columns.map((column, index) => `${column}=$${index + 1}${["constraints", "proposal", "pause_metadata", "variant_definitions"].includes(column) ? "::jsonb" : ""}`).join(",");
        result = await this.query(`UPDATE ${table} SET ${assignments},version=version+1,updated_at=NOW()
          WHERE app_id=$${values.length + 1} AND user_id=$${values.length + 2} AND id=$${values.length + 3}
          AND version=$${values.length + 4} RETURNING *`, [...values, row.appId, row.userId, row.id, expectedVersion]);
        if (!result.rows[0]) versionConflict(row.id);
      }
      await this.appendAtomicWrite(write);
      return mapRow<T>(result.rows[0]!);
    });
  }

  private async appendAtomicWrite(write: LightTickAtomicWrite): Promise<void> {
    for (const event of [write.event, ...(write.additionalEvents ?? [])]) {
      await this.query(`INSERT INTO zook_lighttick_execution_events
        (id,app_id,user_id,aggregate_type,aggregate_id,event_type,aggregate_version,payload,occurred_at,created_at)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10)`, [event.id,event.appId,event.userId,event.aggregateType,
        event.aggregateId,event.eventType,event.aggregateVersion,JSON.stringify(event.payload),event.occurredAt,event.createdAt]);
    }
    const change = write.change;
    await this.query(`INSERT INTO zook_lighttick_change_log
      (app_id,user_id,entity_type,entity_id,entity_version,operation,snapshot,changed_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`, [change.appId,change.userId,change.entityType,change.entityId,
      change.entityVersion,change.operation,JSON.stringify(change.snapshot ?? null),change.changedAt]);
  }

  async listReviews(owner: LightTickOwner): Promise<LightTickReviewRow[]> {
    const result = await this.query("SELECT * FROM zook_lighttick_reviews WHERE app_id=$1 AND user_id=$2 ORDER BY period_start DESC", [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickReviewRow>);
  }
  async saveReview(row: LightTickReviewRow): Promise<LightTickReviewRow> {
    const result = await this.query(`INSERT INTO zook_lighttick_reviews
      (id,app_id,user_id,goal_id,period,status,period_start,period_end,facts,output,data_sufficiency,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14) RETURNING *`,
      [row.id,row.appId,row.userId,row.goalId,row.period,row.status,row.periodStart,row.periodEnd,JSON.stringify(row.facts),
        JSON.stringify(row.output),row.dataSufficiency,row.version,row.createdAt,row.updatedAt]);
    return mapRow<LightTickReviewRow>(result.rows[0]!);
  }

  async getProposal(owner: LightTickOwner, id: string): Promise<LightTickChangeProposalRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_change_proposals WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? mapRow<LightTickChangeProposalRow>(result.rows[0]) : undefined;
  }
  async saveProposal(row: LightTickChangeProposalRow, expectedVersion?: number): Promise<LightTickChangeProposalRow> {
    if (expectedVersion !== undefined) {
      const result = await this.query(`UPDATE zook_lighttick_change_proposals SET status=$1,decided_at=$2,version=version+1,updated_at=NOW()
        WHERE app_id=$3 AND user_id=$4 AND id=$5 AND version=$6 RETURNING *`, [row.status,row.decidedAt ?? null,row.appId,row.userId,row.id,expectedVersion]);
      if (!result.rows[0]) versionConflict(row.id);
      return mapRow<LightTickChangeProposalRow>(result.rows[0]);
    }
    const result = await this.query(`INSERT INTO zook_lighttick_change_proposals
      (id,app_id,user_id,plan_id,base_plan_version,status,reason,diff,impact,expires_at,decided_at,version,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,1,$12,$13) RETURNING *`,
      [row.id,row.appId,row.userId,row.planId,row.basePlanVersion,row.status,row.reason,JSON.stringify(row.diff),
        JSON.stringify(row.impact),row.expiresAt,row.decidedAt ?? null,row.createdAt,row.updatedAt]);
    return mapRow<LightTickChangeProposalRow>(result.rows[0]!);
  }

  async getAiRun(owner: LightTickOwner, id: string): Promise<LightTickAiRunRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_ai_runs WHERE app_id=$1 AND user_id=$2 AND id=$3", [owner.appId,owner.userId,id]);
    return result.rows[0] ? mapRow<LightTickAiRunRow>(result.rows[0]) : undefined;
  }
  async saveAiRun(row: LightTickAiRunRow): Promise<LightTickAiRunRow> {
    const result = await this.query(`INSERT INTO zook_lighttick_ai_runs
      (id,app_id,user_id,kind,status,resource_id,scene_key,prompt_version,schema_version,provider,model,attempt_count,input_context,output,error_code,usage,latency_ms,created_at,started_at,completed_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::jsonb,$14::jsonb,$15,$16::jsonb,$17,$18,$19,$20,$21)
      ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status,provider=EXCLUDED.provider,model=EXCLUDED.model,
      attempt_count=EXCLUDED.attempt_count,output=EXCLUDED.output,error_code=EXCLUDED.error_code,usage=EXCLUDED.usage,
      latency_ms=EXCLUDED.latency_ms,started_at=EXCLUDED.started_at,completed_at=EXCLUDED.completed_at,updated_at=EXCLUDED.updated_at RETURNING *`,
      [row.id,row.appId,row.userId,row.kind,row.status,row.resourceId ?? null,row.sceneKey,row.promptVersion,row.schemaVersion,
        row.provider ?? null,row.model ?? null,row.attemptCount,JSON.stringify(row.inputContext),JSON.stringify(row.output ?? null),
        row.errorCode ?? null,JSON.stringify(row.usage),row.latencyMs ?? null,row.createdAt,row.startedAt ?? null,row.completedAt ?? null,row.updatedAt]);
    return mapRow<LightTickAiRunRow>(result.rows[0]!);
  }

  async getOperation(owner: LightTickOwner, operationId: string): Promise<LightTickOperationRow | undefined> {
    const result = await this.query("SELECT * FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id=$3", [owner.appId,owner.userId,operationId]);
    return result.rows[0] ? mapRow<LightTickOperationRow>(result.rows[0]) : undefined;
  }
  async saveOperation(row: LightTickOperationRow): Promise<LightTickOperationRow> {
    const result = await this.query(`INSERT INTO zook_lighttick_operations
      (app_id,user_id,operation_id,device_id,payload_hash,entity_type,entity_id,action,request_payload,result_payload,status,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13)
      ON CONFLICT (app_id,user_id,operation_id) DO NOTHING RETURNING *`, [row.appId,row.userId,row.operationId,row.deviceId,
      row.payloadHash,row.entityType,row.entityId,row.action,JSON.stringify(row.requestPayload),JSON.stringify(row.resultPayload),
      row.status,row.createdAt,row.updatedAt]);
    return result.rows[0] ? mapRow<LightTickOperationRow>(result.rows[0]) : (await this.getOperation(row,row.operationId))!;
  }
  async pullChanges(owner: LightTickOwner, afterSequence: number, limit: number): Promise<LightTickChangeRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_change_log WHERE app_id=$1 AND user_id=$2
      AND sequence>$3 ORDER BY sequence ASC LIMIT $4`, [owner.appId,owner.userId,afterSequence,limit]);
    return result.rows.map(mapRow<LightTickChangeRow>);
  }

  async upsertDevice(row: LightTickDeviceRow): Promise<LightTickDeviceRow> {
    const result = await this.query(`INSERT INTO zook_lighttick_devices
      (id,app_id,user_id,platform,push_provider,push_token,timezone,locale,app_version,notifications_enabled,active,deleted_at,created_at,updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
      ON CONFLICT (app_id,user_id,id) DO UPDATE SET platform=EXCLUDED.platform,push_provider=EXCLUDED.push_provider,
      push_token=EXCLUDED.push_token,timezone=EXCLUDED.timezone,locale=EXCLUDED.locale,app_version=EXCLUDED.app_version,
      notifications_enabled=EXCLUDED.notifications_enabled,active=EXCLUDED.active,deleted_at=EXCLUDED.deleted_at,updated_at=EXCLUDED.updated_at RETURNING *`,
      [row.id,row.appId,row.userId,row.platform,row.pushProvider,row.pushToken,row.timezone,row.locale,row.appVersion,
        row.notificationsEnabled,row.active,row.deletedAt ?? null,row.createdAt,row.updatedAt]);
    return mapRow<LightTickDeviceRow>(result.rows[0]!);
  }
  async listDevices(owner: LightTickOwner): Promise<LightTickDeviceRow[]> {
    const result = await this.query(`SELECT * FROM zook_lighttick_devices WHERE app_id=$1 AND user_id=$2 ORDER BY created_at ASC`,
      [owner.appId, owner.userId]);
    return result.rows.map(mapRow<LightTickDeviceRow>);
  }
  async deleteDevice(owner: LightTickOwner, id: string, deletedAt: string): Promise<boolean> {
    const result = await this.query(`UPDATE zook_lighttick_devices SET active=FALSE,deleted_at=$1,updated_at=$1
      WHERE app_id=$2 AND user_id=$3 AND id=$4 AND active=TRUE`, [deletedAt,owner.appId,owner.userId,id]);
    return Boolean(result.rowCount);
  }
  async deleteOwnerData(owner: LightTickOwner): Promise<void> {
    const tables = ["task_steps","tasks","change_proposals","reviews","plan_cycles","goals","execution_events",
      "ai_runs","change_log","operations","sync_cursors","devices","profiles","guest_identities"];
    await this.transaction(owner, async () => {
      await this.query(`DELETE FROM zook_lighttick_account_upgrades WHERE app_id=$1
        AND (guest_user_id=$2 OR target_user_id=$2)`, [owner.appId,owner.userId]);
      for (const suffix of tables) await this.query(`DELETE FROM zook_lighttick_${suffix} WHERE app_id=$1 AND user_id=$2`, [owner.appId,owner.userId]);
    });
  }
  async getAdminOperationalSummary(): Promise<Record<string, number>> {
    const result = await this.query(`SELECT
      (SELECT COUNT(*) FROM zook_lighttick_profiles WHERE app_id='lighttick') AS profiles,
      (SELECT COUNT(*) FROM zook_lighttick_profiles WHERE app_id='lighttick' AND onboarding_state='completed') AS onboarding_completed,
      (SELECT COUNT(*) FROM zook_lighttick_goals WHERE app_id='lighttick') AS goals,
      (SELECT COUNT(*) FROM zook_lighttick_plan_cycles WHERE app_id='lighttick') AS plans,
      (SELECT COUNT(*) FROM zook_lighttick_execution_events WHERE app_id='lighttick' AND event_type='plan_confirmed') AS plan_confirmations,
      (SELECT COUNT(*) FROM zook_lighttick_tasks WHERE app_id='lighttick') AS tasks,
      (SELECT COUNT(*) FROM zook_lighttick_execution_events WHERE app_id='lighttick' AND aggregate_type='task' AND event_type LIKE 'task_%') AS task_actions,
      (SELECT COUNT(*) FROM zook_lighttick_reviews WHERE app_id='lighttick') AS reviews,
      (SELECT COUNT(*) FROM zook_lighttick_change_proposals WHERE app_id='lighttick' AND status='pending') AS pending_proposals,
      (SELECT COUNT(*) FROM zook_lighttick_change_proposals WHERE app_id='lighttick' AND status='accepted') AS proposals_accepted,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick') AS ai_runs,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND status='failed') AS ai_failures,
      (SELECT COUNT(*) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND error_code='LIGHTTICK_AI_RUN_FAILED') AS ai_schema_failures,
      (SELECT COALESCE(ROUND(AVG(latency_ms)),0) FROM zook_lighttick_ai_runs WHERE app_id='lighttick' AND latency_ms IS NOT NULL) AS ai_average_latency_ms,
      (SELECT COALESCE(SUM((usage->>'totalTokens')::BIGINT),0) FROM zook_lighttick_ai_runs WHERE app_id='lighttick') AS ai_total_tokens,
      (SELECT COUNT(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND status='conflict') AS sync_conflicts,
      (SELECT COUNT(*) FROM zook_lighttick_operations WHERE app_id='lighttick' AND entity_type='notification' AND status<>'accepted') AS notification_failures,
      (SELECT COUNT(*) FROM zook_lighttick_devices WHERE app_id='lighttick' AND active=TRUE) AS active_devices`);
    return Object.fromEntries(Object.entries(result.rows[0] ?? {}).map(([key, value]) => [key, Number(value)]));
  }
}
