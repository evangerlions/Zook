import { ApplicationError } from "../shared/errors.ts";
import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { AiNovelCreditsService } from "../modules/ai-novel/credits/ai-novel-credits.service.ts";
import { createCreditsMembershipReader } from "../modules/ai-novel/credits/credits-membership-reader.ts";
import { searchCreditUsers } from "../modules/ai-novel/credits/admin-credit-search.ts";
import type { AiNovelBillingService } from "./ainovel-billing.service.ts";

export class AiNovelCreditAdminService {
  private readonly credits: AiNovelCreditsService;
  constructor(private readonly database: ApplicationDatabase, billing: AiNovelBillingService) {
    this.credits = new AiNovelCreditsService(database.aiNovelCreditsStore, createCreditsMembershipReader(billing));
  }
  async search(field: unknown, query: unknown) {
    const store = this.database.aiNovelCreditsStore;
    if (!store.searchUsers) throw new ApplicationError(503, "SYS_INTERNAL_ERROR", "User search is unavailable.");
    return searchCreditUsers({ searchUsers: store.searchUsers.bind(store) }, field, query);
  }
  async records(rawOffset: unknown) {
    const offset = rawOffset === undefined ? 0 : Number(rawOffset);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid offset.");
    const store = this.database.aiNovelCreditsStore;
    if (!store.listAdminGrants) throw new ApplicationError(503, "SYS_INTERNAL_ERROR", "Grant records are unavailable.");
    const rows = await store.listAdminGrants(offset, 51);
    return { items: rows.slice(0, 50), hasMore: rows.length > 50, offset };
  }
  async grant(body: Record<string, unknown>, adminUser: string) {
    const { uid, points, idempotencyKey } = body;
    if (typeof uid !== "string" || !uid || typeof idempotencyKey !== "string" ||
        !/^[A-Za-z0-9._:-]{1,150}$/.test(idempotencyKey) ||
        typeof points !== "number" || !Number.isSafeInteger(points) || points <= 0) {
      throw new ApplicationError(400, "REQ_INVALID_BODY", "Invalid grant details.");
    }
    const user = await this.database.findUserById(uid);
    if (!user) throw new ApplicationError(400, "REQ_INVALID_BODY", "User not found.");
    await this.credits.grant(uid, idempotencyKey, points, adminUser);
    return { uid, points, idempotencyKey };
  }
}
