import type { ApplicationDatabase } from "../../../infrastructure/database/application-database.ts";
import type { FrogSleepBuddyInvitationReceiptAttemptRecord } from "../../../shared/types.ts";
import { badRequest } from "../../../shared/errors.ts";
import { randomId, sha256 } from "../../../shared/utils.ts";
import { FROGSLEEP_APP_ID } from "../frogsleep-app.ts";
import { isBuddyPairBlocked } from "./buddy-safety.ts";

const RECEIPT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const receiptDomains = ["focus", "sleep"] as const;
type ReceiptDomain = (typeof receiptDomains)[number];

/** Records recipient-bound opaque invitation receipts without creating a deliverable invitation. */
export class BuddyInvitationReceiptService {
  constructor(private readonly database: ApplicationDatabase) {}

  async create(inviterUserId: string, body: Record<string, unknown>) {
    this.assertBodyKeys(body);
    const email = this.email(body.email);
    const domains = this.domains(body.domains);
    const recipientIdentityHash = sha256(email);
    const domainsFingerprint = sha256(JSON.stringify(domains));
    const existing = await this.database.findFrogSleepBuddyInvitationReceiptAttempt(
      FROGSLEEP_APP_ID, inviterUserId, recipientIdentityHash, domainsFingerprint,
    );
    const receipt = existing ?? await this.record({ inviterUserId, email, recipientIdentityHash, domains, domainsFingerprint });
    return this.payload(receipt);
  }

  private assertBodyKeys(body: Record<string, unknown>) {
    if (Object.keys(body).some((key) => key !== "email" && key !== "domains")) {
      badRequest("REQ_INVALID_BODY", "Invalid invitation receipt body.");
    }
  }

  private email(value: unknown): string {
    const email = typeof value === "string" ? value.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      badRequest("REQ_INVALID_BODY", "Invalid invitation receipt email.");
    }
    return email;
  }

  private domains(value: unknown): ReceiptDomain[] {
    if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string")) {
      badRequest("REQ_INVALID_BODY", "Invalid invitation receipt domains.");
    }
    const domains = value.map((item) => item as string);
    if (new Set(domains).size !== domains.length || domains.some((item) => !receiptDomains.includes(item as ReceiptDomain))) {
      badRequest("REQ_INVALID_BODY", "Invalid invitation receipt domains.");
    }
    return [...domains].sort() as ReceiptDomain[];
  }

  private async record(input: {
    inviterUserId: string; email: string; recipientIdentityHash: string;
    domains: ReceiptDomain[]; domainsFingerprint: string;
  }) {
    const now = new Date().toISOString();
    const inviteeUserId = await this.eligibleInvitee(input.email, input.inviterUserId);
    return await this.database.upsertFrogSleepBuddyInvitationReceiptAttempt({
      id: randomId("buddy_receipt"), appId: FROGSLEEP_APP_ID, inviterUserId: input.inviterUserId,
      inviteeUserId, recipientIdentityHash: input.recipientIdentityHash, domains: input.domains,
      domainsFingerprint: input.domainsFingerprint, status: inviteeUserId ? "recorded" : "decoy",
      expiresAt: new Date(Date.now() + RECEIPT_TTL_MS).toISOString(), createdAt: now, updatedAt: now,
    });
  }

  private async eligibleInvitee(email: string, inviterUserId: string): Promise<string | undefined> {
    const user = await this.database.findUserByAccount(email);
    if (!user || user.id === inviterUserId || user.status !== "ACTIVE") return undefined;
    if (await isBuddyPairBlocked(this.database, inviterUserId, user.id)) return undefined;
    return user.id;
  }

  private payload(receipt: FrogSleepBuddyInvitationReceiptAttemptRecord) {
    return { receipt_id: receipt.id, status: "recorded", expires_at: receipt.expiresAt };
  }
}
