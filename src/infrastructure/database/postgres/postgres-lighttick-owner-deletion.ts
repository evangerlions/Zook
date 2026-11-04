import {LIGHTTICK_OWNED_TABLES} from "./postgres-lighttick-owned-tables.ts";
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
    for (const suffix of LIGHTTICK_OWNED_TABLES)
      await query(
        `DELETE FROM zook_lighttick_${suffix} WHERE app_id=$1 AND user_id=$2`,
        [owner.appId, owner.userId],
      );
  });
}
