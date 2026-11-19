import type {
  LightTickAccountUpgradeCommand,
  LightTickAccountUpgradeResult,
} from "../../../modules/lighttick/lighttick.types.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { timestampString } from "./postgres-lighttick-row-mappers.ts";
import type { LightTickOwnerTransactionGate } from "./postgres-lighttick-owner-transaction.ts";

export class PostgresLightTickAccountUpgradeStore {
  constructor(private readonly transactions: LightTickOwnerTransactionGate) {}

  async upgradeGuestAccount(command: LightTickAccountUpgradeCommand): Promise<LightTickAccountUpgradeResult> {
    return await this.transactions.transactionOwners([{ appId: command.appId, userId: command.guestUserId },{ appId: command.appId, userId: command.targetUserId }], async () => {
      await this.transactions.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${command.appId}:${command.operationId}`]);
      const prior = await this.transactions.query(`SELECT request_hash,result_payload FROM zook_lighttick_account_upgrades
        WHERE app_id=$1 AND operation_id=$2 FOR UPDATE`, [command.appId, command.operationId]);
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== command.requestHash)
          throw new ApplicationError(409, "LIGHTTICK_IDEMPOTENCY_MISMATCH", "Idempotency key was reused with a different request.");
        return { ...(prior.rows[0].result_payload as unknown as LightTickAccountUpgradeResult), idempotencyReplayed: true };
      }

      const identityResult = await this.transactions.query(`SELECT * FROM zook_lighttick_guest_identities
        WHERE app_id=$1 AND user_id=$2 FOR UPDATE`, [command.appId, command.guestUserId]);
      const identity = identityResult.rows[0];
      if (!identity || identity.device_id !== command.deviceId || identity.upgrade_token_hash !== command.guestUpgradeTokenHash)
        throw new ApplicationError(401, "LIGHTTICK_GUEST_CREDENTIAL_INVALID", "Guest upgrade proof is invalid.");
      if (identity.revoked_at)
        throw new ApplicationError(410, "LIGHTTICK_GUEST_REVOKED", "Guest session is revoked.");
      if (new Date(String(identity.expires_at)) <= new Date(command.now))
        throw new ApplicationError(410, "LIGHTTICK_GUEST_EXPIRED", "Guest session is expired.");

      const target = await this.transactions.query(`SELECT u.password_algo,au.status FROM zook_users u
        JOIN zook_app_users au ON au.user_id=u.id AND au.app_id=$1
        WHERE u.id=$2 FOR UPDATE OF au`, [command.appId, command.targetUserId]);
      if (!target.rows[0] || target.rows[0].password_algo === "lighttick-guest" || target.rows[0].status !== "ACTIVE")
        throw new ApplicationError(403, "LIGHTTICK_APP_ACCESS_DENIED", "A registered LightTick account is required.");

      await this.assertUpgradeRelationships(command);
      const count = async (table: string) => Number((await this.transactions.query(
        `SELECT COUNT(*)::int AS count FROM ${table} WHERE app_id=$1 AND user_id=$2`,
        [command.appId, command.guestUserId])).rows[0]?.count ?? 0);
      const counts = { goals: await count("zook_lighttick_goals"), plans: await count("zook_lighttick_plan_cycles"),
        tasks: await count("zook_lighttick_tasks"), reviews: await count("zook_lighttick_reviews"),
        proposals: await count("zook_lighttick_change_proposals") };

      await this.mergeUpgradeProfiles(command);
      await this.mergeUpgradeOperations(command);
      await this.transactions.query(`DELETE FROM zook_lighttick_devices guest USING zook_lighttick_devices target
        WHERE guest.app_id=$1 AND guest.user_id=$2 AND target.app_id=$1 AND target.user_id=$3
          AND (target.id=guest.id OR (target.push_provider=guest.push_provider AND target.push_token=guest.push_token))`,
        [command.appId, command.guestUserId, command.targetUserId]);
      const ownerTables = ["zook_lighttick_goals", "zook_lighttick_plan_cycles", "zook_lighttick_tasks",
        "zook_lighttick_goal_contexts", "zook_lighttick_milestones", "zook_lighttick_outcome_evidence", "zook_lighttick_task_families",
        "zook_lighttick_task_steps", "zook_lighttick_execution_events", "zook_lighttick_reflections", "zook_lighttick_reviews",
        "zook_lighttick_change_proposals", "zook_lighttick_ai_runs", "zook_lighttick_change_log",
        "zook_lighttick_sync_cursors", "zook_lighttick_devices", "zook_lighttick_insight_audits", "zook_lighttick_chat_messages", "zook_lighttick_dna_insights"];
      for (const table of ownerTables) await this.transactions.query(
        `UPDATE ${table} SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
        [command.targetUserId, command.appId, command.guestUserId]);

      await this.transactions.query(`UPDATE zook_lighttick_guest_identities SET revoked_at=$1,upgraded_to_user_id=$2,updated_at=$1
        WHERE app_id=$3 AND user_id=$4`, [command.now, command.targetUserId, command.appId, command.guestUserId]);
      const sequence = await this.transactions.query(`SELECT COALESCE(MAX(sequence),0) AS sequence FROM zook_lighttick_change_log
        WHERE app_id=$1 AND user_id=$2`, [command.appId, command.targetUserId]);
      const result: LightTickAccountUpgradeResult = { guestUserId: command.guestUserId,
        targetUserId: command.targetUserId, idempotencyReplayed: false,
        lastSequence: Number(sequence.rows[0]?.sequence ?? 0), transferredResourceCounts: counts };
      await this.transactions.query(`INSERT INTO zook_lighttick_account_upgrades
        (app_id,operation_id,request_hash,guest_user_id,target_user_id,status,result_payload,created_at,updated_at)
        VALUES ($1,$2,$3,$4,$5,'completed',$6::jsonb,$7,$7)`, [command.appId,command.operationId,
        command.requestHash,command.guestUserId,command.targetUserId,JSON.stringify(result),command.now]);
      return result;
    });
  }

  private async assertUpgradeRelationships(command: LightTickAccountUpgradeCommand) {
    const relations = [
      ["zook_lighttick_goal_contexts", "goal_id", "zook_lighttick_goals", "goal_id"],
      ["zook_lighttick_milestones", "goal_id", "zook_lighttick_goals", "id"],
      ["zook_lighttick_outcome_evidence", "goal_id", "zook_lighttick_goals", "id"],
      ["zook_lighttick_outcome_evidence", "milestone_id", "zook_lighttick_milestones", "id"],
      ["zook_lighttick_plan_cycles", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_tasks", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_tasks", "plan_id", "zook_lighttick_plan_cycles"],
      ["zook_lighttick_task_steps", "task_id", "zook_lighttick_tasks"],
      ["zook_lighttick_reviews", "goal_id", "zook_lighttick_goals"],
      ["zook_lighttick_change_proposals", "plan_id", "zook_lighttick_plan_cycles"],
    ] as const;
    for (const [childTable, foreignKey, parentTable, childIdColumn = "id"] of relations) {
      const mismatch = await this.transactions.query(`SELECT child.${childIdColumn} AS id FROM ${childTable} child
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
    const profiles = await this.transactions.query(`SELECT * FROM zook_lighttick_profiles
      WHERE app_id=$1 AND user_id IN ($2,$3) FOR UPDATE`, [command.appId,command.guestUserId,command.targetUserId]);
    const guest = profiles.rows.find(row => row.user_id === command.guestUserId);
    const target = profiles.rows.find(row => row.user_id === command.targetUserId);
    if (!guest) return;
    if (!target) {
      await this.transactions.query(`UPDATE zook_lighttick_profiles SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
        [command.targetUserId,command.appId,command.guestUserId]); return;
    }
    const ranks: Record<string, number> = { not_started: 0, drafting: 1, starter_ready: 2, three_day_active: 3, completed: 4 };
    const guestAhead = (ranks[String(guest.onboarding_state)] ?? 0) > (ranks[String(target.onboarding_state)] ?? 0);
    const targetDraft = target.onboarding_draft as Record<string, unknown> | undefined;
    await this.transactions.query(`UPDATE zook_lighttick_profiles SET onboarding_state=$1,onboarding_draft=$2::jsonb,
      version=GREATEST(version,$3),updated_at=GREATEST(updated_at,$4::timestamptz) WHERE app_id=$5 AND user_id=$6`,
      [guestAhead ? guest.onboarding_state : target.onboarding_state,
        JSON.stringify(guestAhead && Object.keys(targetDraft ?? {}).length === 0 ? guest.onboarding_draft : target.onboarding_draft),
        Number(guest.version), timestampString(guest.updated_at), command.appId, command.targetUserId]);
    await this.transactions.query("DELETE FROM zook_lighttick_profiles WHERE app_id=$1 AND user_id=$2", [command.appId,command.guestUserId]);
  }

  private async mergeUpgradeOperations(command: LightTickAccountUpgradeCommand) {
    const collisions = await this.transactions.query(`SELECT guest.operation_id,guest.action AS guest_action,target.action AS target_action,
      guest.payload_hash AS guest_hash,target.payload_hash AS target_hash,
      guest.result_payload = target.result_payload AS same_result
      FROM zook_lighttick_operations guest JOIN zook_lighttick_operations target
        ON target.app_id=guest.app_id AND target.operation_id=guest.operation_id AND target.user_id=$1
      WHERE guest.app_id=$2 AND guest.user_id=$3 FOR UPDATE OF guest,target`,
      [command.targetUserId,command.appId,command.guestUserId]);
    for (const row of collisions.rows) {
      if (row.guest_action !== row.target_action || row.guest_hash !== row.target_hash || row.same_result !== true)
        throw new ApplicationError(409, "LIGHTTICK_GUEST_UPGRADE_CONFLICT", "Guest operations conflict with registered account operations.");
      await this.transactions.query(`DELETE FROM zook_lighttick_operations WHERE app_id=$1 AND user_id=$2 AND operation_id=$3`,
        [command.appId,command.guestUserId,row.operation_id]);
    }
    await this.transactions.query(`UPDATE zook_lighttick_operations SET user_id=$1 WHERE app_id=$2 AND user_id=$3`,
      [command.targetUserId,command.appId,command.guestUserId]);
  }
}
