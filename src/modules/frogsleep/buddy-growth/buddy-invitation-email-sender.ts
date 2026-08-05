import type { CommonEmailConfigService } from "../../../services/common-email-config.service.ts";
import type {
  TemplateEmailSendResult,
  VerificationEmailSender,
} from "../../../services/tencent-ses-registration-email.service.ts";
import type { FrogSleepBuddyInvitationBundleRecord, TencentSesRegion } from "../../../shared/types.ts";

export const BUDDY_INVITATION_EMAIL_TEMPLATE_NAME = "frogsleep_buddy_invitation";

export interface BuddyInvitationEmailSender {
  send(command: {
    invitation: FrogSleepBuddyInvitationBundleRecord;
    recipientEmail: string;
  }): Promise<TemplateEmailSendResult>;
}

/** Dedicated FrogSleep invitation adapter over the common Tencent SES transport. */
export class TencentSesBuddyInvitationEmailSender implements BuddyInvitationEmailSender {
  constructor(
    private readonly configService: CommonEmailConfigService,
    private readonly emailSender: VerificationEmailSender,
    private readonly region: TencentSesRegion = "ap-guangzhou",
  ) {}

  async send(command: {
    invitation: FrogSleepBuddyInvitationBundleRecord;
    recipientEmail: string;
  }): Promise<TemplateEmailSendResult> {
    const runtime = await this.configService.getRuntimeConfig(
      command.invitation.locale,
      this.region,
      BUDDY_INVITATION_EMAIL_TEMPLATE_NAME,
    );
    const isChinese = command.invitation.locale.toLowerCase().startsWith("zh");
    return await this.emailSender.sendTemplateEmail({
      email: command.recipientEmail,
      clientRegion: this.region,
      region: runtime.resolvedRegion,
      fromEmailAddress: runtime.sender.address,
      subject: isChinese ? "你收到了一份 FrogSleep 搭子邀请" : "You have a FrogSleep buddy invitation",
      templateId: runtime.template.templateId,
      templateData: {
        invitationLink: command.invitation.shareLink,
        invitationCode: command.invitation.shareCode,
        domains: command.invitation.domains.join(","),
        expiresAt: command.invitation.expiresAt,
        productName: "FrogSleep",
      },
    });
  }
}
