import type { ApplicationDatabase } from "../infrastructure/database/application-database.ts";
import type { StructuredLogger } from "../infrastructure/logging/pino-logger.module.ts";
import type { AiNovelBillingMembershipInfo } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import type { AlipayCreateInput, AlipayEnvironmentOptions } from "../modules/billing/alipay-models.ts";
import type { AlipayPrices } from "../modules/billing/ainovel-alipay-pricing.ts";
import { billingEnvironment, billingEnvironments, type BillingEnvironment } from "../modules/billing/billing-environment.ts";
import type { MembershipSyncInput } from "../modules/billing/membership-sync.ts";
import { parseAlipayNotify } from "../modules/billing/alipay-notify.ts";
import { AiNovelAlipayService } from "./ainovel-alipay.service.ts";

/** Routes credentials only. Every environment uses the same checkout/settlement implementation. */
export class AiNovelAlipayEnvironments {
  private readonly services = new Map<BillingEnvironment, AiNovelAlipayService>();
  constructor(private readonly database: ApplicationDatabase, options: AlipayEnvironmentOptions, deployment: string,
    getMembership: (user: string) => Promise<AiNovelBillingMembershipInfo>, private readonly logger: StructuredLogger,
    readPrices: () => Promise<AlipayPrices | undefined>) {
    for (const environment of billingEnvironments(deployment)) {
      this.services.set(environment, new AiNovelAlipayService(database, { ...options[environment], environment }, getMembership, logger, readPrices));
    }
  }
  private service(environment = billingEnvironment()): AiNovelAlipayService {
    const service = this.services.get(environment);
    if (!service) throw new ApplicationError(403, "BILLING_ENVIRONMENT_FORBIDDEN", "Sandbox membership is not allowed on this server.");
    return service;
  }
  get available() { return this.service().available; }
  async checkoutCatalog() { return this.service().checkoutCatalog(); }
  async create(user: string, region: string, input: AlipayCreateInput, requestId?: string) {
    return this.service().create(user, region, input, requestId);
  }
  async readOrder(user: string, orderId: string) { return this.service().readOrder(user, orderId); }
  async syncAlipayMembership(input: MembershipSyncInput) { return this.service().syncAlipayMembership(input); }
  async notify(body: unknown, requestId?: string): Promise<string> {
    const fields = parseAlipayNotify(body);
    const order = typeof fields.out_trade_no === "string" ? await this.database.findAiNovelAlipayOrder(fields.out_trade_no) : undefined;
    if (!order) throw new ApplicationError(404, "BILLING_ORDER_NOT_FOUND", "Alipay order not found.");
    // The stored order selects the verifier; caller headers/app_id never authorize a different environment.
    return this.service(order.environment).notify(body, requestId);
  }
  async recoverOrders(limit = 20): Promise<void> {
    const results = await Promise.allSettled([...this.services].map(async ([environment, service]) => {
      try { await service.recoverOrders(limit); }
      catch (error) {
        this.logger.warn("alipay environment recovery failed", { environment });
        throw error;
      }
    }));
    const errors = results.filter((result): result is PromiseRejectedResult => result.status === "rejected");
    if (errors.length) throw new AggregateError(errors.map(result => result.reason), "Alipay environment recovery failed.");
  }
}
