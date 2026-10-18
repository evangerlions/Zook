import { badRequest, conflict } from "../../../shared/errors.ts";

export class FrogSleepGuestUpgradeService {
  async upgradeGuestData(guestDeviceId: string, userId: string): Promise<never> {
    if (!guestDeviceId.trim()) {
      badRequest("REQ_INVALID_BODY", "guest_device_id is required.");
    }
    if (!userId.trim()) {
      badRequest("REQ_INVALID_BODY", "user_id is required.");
    }

    // A device identifier is not proof of ownership. FrogSleep has no cloud
    // guest session or transfer credential, so it cannot authorize a transfer.
    conflict("FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED",
      "Cloud guest transfer is unavailable. After user confirmation, upload local sleep reports and completed focus sessions through the authenticated product-data/sleep-reports and focus/sessions endpoints.");
  }
}
