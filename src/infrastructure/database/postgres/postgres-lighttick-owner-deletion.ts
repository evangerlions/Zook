import type { LightTickRepository } from "../../../modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner } from "../../../modules/lighttick/lighttick.types.ts";
import type { QueryClient } from "./postgres-lighttick-owner-transaction.ts";
export async function deleteLightTickOwnerData(
  repository: Pick<
    LightTickRepository,
    "transaction" | "lockPlanningOwner" | "lockRecordOwner" | "lockActionOwner"
  >,
  query: QueryClient["query"],
  owner: LightTickOwner,
): Promise<void> {
  const tables = [
    "knowledge_versions", "knowledge",
    "learning_work",
    "learning_route_lessons",
    "learning_route_versions",
    "learning_routes",
    "native_learning_history",
    "native_learning_private",
    "lesson_publications",
    "native_lessons",
    "learning_collections",
    "learning_authorities",
    "record_source_history",
    "record_transfers",
    "record_tickets",
    "record_versions",
    "records",
    "learning_private",
    "learning_libraries",
    "action_tickets",
    "action_links",
    "action_workspaces",
    "reflections",
    "planning_sessions",
    "task_steps",
    "tasks",
    "change_proposals",
    "reviews",
    "plan_cycles",
    "outcome_evidence",
    "milestones",
    "goal_contexts",
    "task_families",
    "goals",
    "execution_events",
    "ai_runs",
    "change_log",
    "operations",
    "sync_cursors",
    "devices",
    "profiles",
    "guest_identities",
    "insight_audits",
    "chat_messages",
    "dna_insights",
  ];
  await repository.transaction(owner, async () => {
    await repository.lockPlanningOwner(owner);
    await query(
      "UPDATE zook_lighttick_local_claims SET user_id=NULL,cloud_id=NULL,payload_hash=NULL,source_payload='{}'::jsonb,deleted=TRUE WHERE app_id=$1 AND user_id=$2",
      [owner.appId, owner.userId],
    );
    await repository.lockRecordOwner(owner);
    await repository.lockActionOwner(owner);
    await query(
      `DELETE FROM zook_lighttick_account_upgrades WHERE app_id=$1
        AND (guest_user_id=$2 OR target_user_id=$2)`,
      [owner.appId, owner.userId],
    );
    for (const suffix of tables)
      await query(
        `DELETE FROM zook_lighttick_${suffix} WHERE app_id=$1 AND user_id=$2`,
        [owner.appId, owner.userId],
      );
  });
}
