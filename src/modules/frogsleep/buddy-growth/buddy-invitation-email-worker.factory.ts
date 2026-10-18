import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { CommonEmailConfigService } from "../../../services/common-email-config.service.ts";
import type { VerificationEmailSender } from "../../../services/tencent-ses-registration-email.service.ts";
import { TencentSesBuddyInvitationEmailSender } from "./buddy-invitation-email-sender.ts";
import { BuddyInvitationEmailWorkerService } from "./buddy-invitation-email-worker.service.ts";

export function createBuddyInvitationEmailWorker(
  database: ApplicationDatabase,
  configService: CommonEmailConfigService,
  sender: VerificationEmailSender,
) {
  return new BuddyInvitationEmailWorkerService(
    database,
    new TencentSesBuddyInvitationEmailSender(configService, sender),
  );
}
