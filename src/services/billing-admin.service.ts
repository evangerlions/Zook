import { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import { ApplicationError } from "../shared/errors.ts";
import { AiNovelBillingAdminService } from "./ainovel-billing-admin.service.ts";
import { effectiveBillingMembership } from "../modules/billing/billing-admin-membership.ts";

type Query = Record<string, string | undefined>;

function invalid(message: string): never {
  throw new ApplicationError(400, "ADMIN_BILLING_INVALID_QUERY", message);
}

function boundedText(value: string | undefined): string | undefined {
  if (value !== undefined && (!value.trim() || value.length > 200)) invalid("Invalid billing query value.");
  return value;
}

/** Server-owned read facade. Only registered product adapters supply financial data. */
export class BillingAdminService {
  private readonly aiNovel: AiNovelBillingAdminService;
  constructor(private readonly database: ApplicationDatabase) {
    this.aiNovel = new AiNovelBillingAdminService(database);
  }

  async listApps() {
    return (await this.database.listApps()).map((app) => ({ appId: app.code,
      appName: app.name, integrated: app.code === "ai_novel" }));
  }

  async assertScope(appId?: string, requireApp = false) {
    if (!appId || appId === "all") {
      if (requireApp) invalid("An explicit appId is required for order details.");
      return;
    }
    const app = (await this.listApps()).find((item) => item.appId === appId);
    if (!app) invalid("Unknown appId.");
    if (!app.integrated) throw new ApplicationError(409, "ADMIN_BILLING_NOT_INTEGRATED", "This app has not integrated billing reporting.");
  }

  async listOrders(query: Query) {
    await this.assertScope(query.appId);
    if (!(await this.hasIntegratedApp())) return { items: [], nextCursor: null };
    return await this.aiNovel.listOrders(query);
  }

  async getOrder(paymentId: string, query: Query) {
    await this.assertScope(query.appId, true);
    return await this.aiNovel.getOrder({ paymentId, eventsCursor: query.eventsCursor, eventsLimit: query.eventsLimit });
  }

  async listMemberships(query: Query) {
    await this.assertScope(query.appId);
    const limit = query.limit === undefined ? 50 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) invalid("limit must be 1–100.");
    if (!(await this.hasIntegratedApp())) return { items: [], nextCursor: null };
    const records = await this.database.listBillingAdminMemberships({ userId: boundedText(query.userId),
      after: boundedText(query.cursor), limit: limit + 1 });
    const now = Date.now();
    const items = records.slice(0, limit).map((item) => effectiveBillingMembership(item, now));
    return { items, nextCursor: records.length > limit ? items.at(-1)!.userId : null };
  }

  async overview(query: Query) {
    await this.assertScope(query.appId);
    if (query.environment !== undefined && !["PRODUCTION", "SANDBOX"].includes(query.environment)) invalid("Invalid environment.");
    const now = new Date();
    const from = query.from ?? new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString();
    const to = query.to ?? now.toISOString();
    const start = Date.parse(from), end = Date.parse(to);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 366 * 86400000) {
      invalid("Use a positive reporting window of at most 366 days.");
    }
    const environment = query.environment ?? "PRODUCTION";
    const rows = await this.hasIntegratedApp() ? await this.database.getBillingAdminRevenue({ from: new Date(start).toISOString(),
      to: new Date(end).toISOString(), sandbox: environment === "SANDBOX" }) : [];
    return { from: new Date(start).toISOString(), to: new Date(end).toISOString(), environment, rows,
      integratedApps: (await this.listApps()).filter((item) => item.integrated).map((item) => item.appId) };
  }

  private async hasIntegratedApp() {
    return (await this.listApps()).some((app) => app.integrated);
  }
}
