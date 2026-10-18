import { badRequest, conflict } from "../../../shared/errors.ts";

export class FrogSleepGuestUpgradeService {
  async upgradeGuestData(guestDeviceId: string, userId: string): Promise<never> {
    if (!guestDeviceId.trim()) {
      badRequest("REQ_INVALID_BODY", "guest_device_id is required.");
    }
    if (!userId.trim()) {
      badRequest("REQ_INVALID_BODY", "user_id is required.");
    }

    // A legacy device identifier is not proof of ownership. Only the separate
    // credential-based guest protocol may authorize a cloud transfer.
    conflict("FROGSLEEP_GUEST_UPGRADE_UNSUPPORTED",
      "Device-only cloud transfer is unavailable. Use the credential-based guest upgrade protocol, or explicitly confirm local report/focus imports.");
  }
}
