import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminAppSummary,
  AdminSmsVerificationItem,
  AdminSmsVerificationListDocument,
  AdminSmsVerificationRevealDocument,
  SmsVerificationLifecycle,
  SmsVerificationRecord,
  SmsVerificationScene,
} from "../shared/types.ts";
import { randomId, sha256 } from "../shared/utils.ts";

const SMS_VISIBILITY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

export const SMS_VERIFICATION_REVEAL_OPERATION = "sms.verification.reveal";

export class SmsVerificationRecordService {
  constructor(private readonly database: ApplicationDatabase) {}

  async recordIssued(input: {
    appId: string;
    scene: SmsVerificationScene;
    phone: string;
    phoneNa?: string;
    code: string;
    isTest: boolean;
    sentAt: string;
    expiresAt: string;
  }): Promise<SmsVerificationRecord> {
    const nowIso = input.sentAt;
    const record: SmsVerificationRecord = {
      id: randomId("sms_verify"),
      appId: input.appId,
      scene: input.scene,
      channel: "sms",
      phoneMasked: this.maskPhone(input.phone),
      phoneHash: sha256(input.phone.trim().toLowerCase()),
      phoneNa: input.phoneNa?.trim() || undefined,
      codePlaintext: input.code,
      status: input.isTest ? "test_generated" : "created",
      isTest: input.isTest,
      provider: "tencent_sms",
      sentAt: input.sentAt,
      expiresAt: input.expiresAt,
      revealCount: 0,
      createdAt: nowIso,
      updatedAt: nowIso,
    };
    await this.database.insertSmsVerificationRecord(record);
    return record;
  }

  async markProviderAccepted(recordId: string, input: {
    providerRequestId?: string;
    providerSerialNo?: string;
    providerMessage?: string;
    now?: Date;
  }): Promise<void> {
    await this.database.updateSmsVerificationRecord(recordId, {
      status: "provider_accepted",
      providerRequestId: input.providerRequestId,
      providerSerialNo: input.providerSerialNo,
      providerMessage: input.providerMessage,
      updatedAt: (input.now ?? new Date()).toISOString(),
    });
  }

  async markProviderFailed(recordId: string, input: {
    providerRequestId?: string;
    providerSerialNo?: string;
    providerMessage?: string;
    now?: Date;
  }): Promise<void> {
    const nowIso = (input.now ?? new Date()).toISOString();
    await this.database.updateSmsVerificationRecord(recordId, {
      status: "provider_failed",
      providerRequestId: input.providerRequestId,
      providerSerialNo: input.providerSerialNo,
      providerMessage: input.providerMessage,
      failedAt: nowIso,
      updatedAt: nowIso,
    });
  }

  async markConsumed(input: {
    appId: string;
    scene: SmsVerificationScene;
    phone: string;
    code: string;
    now?: Date;
  }): Promise<void> {
    const now = input.now ?? new Date();
    const phoneHash = sha256(input.phone.trim().toLowerCase());
    const candidates = await this.database.listSmsVerificationRecords(input.appId);
    const matched = candidates.find((item) =>
      item.phoneHash === phoneHash
      && item.scene === input.scene
      && item.codePlaintext === input.code.trim()
      && this.resolveLifecycle(item, now) !== "expired"
      && item.status !== "consumed"
      && item.status !== "provider_failed"
    );
    if (!matched) {
      return;
    }
    await this.database.updateSmsVerificationRecord(matched.id, {
      status: "consumed",
      consumedAt: now.toISOString(),
      updatedAt: now.toISOString(),
    });
  }

  async listForAdmin(app: AdminAppSummary, filterAppId?: string, now = new Date()): Promise<AdminSmsVerificationListDocument> {
    const items = await this.database.listSmsVerificationRecords(filterAppId?.trim() || undefined);
    return {
      app,
      items: items
        .filter((item) => this.isWithinVisibilityWindow(item, now))
        .map((item) => this.toAdminItem(item, now)),
    };
  }

  async revealForAdmin(app: AdminAppSummary, recordId: string, now = new Date()): Promise<AdminSmsVerificationRevealDocument> {
    const record = await this.database.findSmsVerificationRecord(recordId);
    if (!record || !this.isWithinVisibilityWindow(record, now)) {
      throw new ApplicationError(404, "SMS_VERIFICATION_NOT_FOUND", "SMS verification record was not found.");
    }
    const updatedAt = now.toISOString();
    await this.database.updateSmsVerificationRecord(record.id, {
      revealCount: record.revealCount + 1,
      lastRevealedAt: updatedAt,
      updatedAt,
    });
    const refreshed = (await this.database.findSmsVerificationRecord(record.id)) ?? record;
    return {
      app,
      item: this.toAdminItem(refreshed, now),
      code: refreshed.codePlaintext,
      revealedAt: updatedAt,
    };
  }

  private toAdminItem(record: SmsVerificationRecord, now: Date): AdminSmsVerificationItem {
    return {
      id: record.id,
      appId: record.appId,
      scene: record.scene,
      channel: record.channel,
      phoneMasked: record.phoneMasked,
      phoneNa: record.phoneNa,
      status: this.resolveLifecycle(record, now),
      isTest: record.isTest,
      provider: record.provider,
      providerRequestId: record.providerRequestId,
      providerSerialNo: record.providerSerialNo,
      providerMessage: record.providerMessage,
      sentAt: record.sentAt,
      expiresAt: record.expiresAt,
      consumedAt: record.consumedAt,
      failedAt: record.failedAt,
      revealCount: record.revealCount,
      lastRevealedAt: record.lastRevealedAt,
    };
  }

  private resolveLifecycle(record: SmsVerificationRecord, now: Date): SmsVerificationLifecycle {
    if (record.status === "consumed" || record.status === "provider_failed") {
      return record.status;
    }
    if (new Date(record.expiresAt).getTime() <= now.getTime()) {
      return "expired";
    }
    return record.status;
  }

  private isWithinVisibilityWindow(record: SmsVerificationRecord, now: Date): boolean {
    return now.getTime() - new Date(record.createdAt).getTime() <= SMS_VISIBILITY_WINDOW_MS;
  }

  private maskPhone(phone: string): string {
    const normalized = phone.trim();
    if (normalized.length <= 5) {
      return normalized;
    }
    return `${normalized.slice(0, 3)}****${normalized.slice(-4)}`;
  }
}
