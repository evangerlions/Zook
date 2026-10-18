import { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import { badRequest } from "../../../shared/errors.ts";
import type { FrogSleepEntityRecord } from "../../../shared/types.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";

function nowIso(): string {
  return new Date().toISOString();
}

export class FrogSleepGuestUpgradeService {
  constructor(private readonly database: ApplicationDatabase) {}

  async upgradeGuestData(guestDeviceId: string, userId: string) {
    // Validate inputs
    if (!guestDeviceId || !guestDeviceId.trim()) {
      badRequest("REQ_INVALID_BODY", "guest_device_id is required.");
    }
    if (!userId || !userId.trim()) {
      badRequest("REQ_INVALID_BODY", "user_id is required.");
    }

    // Find guest data by device ID
    // Note: This requires adding guestDeviceId field to FrogSleepEntityRecord
    // For now, we'll use a workaround by querying all entities and filtering
    const allRecords = await this.database.listFrogSleepEntities({
      appId: FROGSLEEP_APP_ID,
      ownerUserId: `guest:${guestDeviceId}`,
      limit: 1000,
    });

    // Migrate data to new user account
    let migratedCount = 0;
    const migratedKinds = new Set<string>();
    const now = nowIso();

    for (const record of allRecords) {
      // Update owner from guest to registered user
      const updatedPayload = {
        ...record.payload,
        migrated_from_guest: true,
        migrated_at: now,
      };

      await this.database.updateFrogSleepEntity(record.kind, FROGSLEEP_APP_ID, record.id, {
        ownerUserId: userId,
        payload: updatedPayload,
        updatedAt: now,
      });

      migratedCount++;
      migratedKinds.add(record.kind);
    }

    return {
      user_id: userId,
      migrated_data_count: migratedCount,
      migrated_kinds: Array.from(migratedKinds),
    };
  }
}
