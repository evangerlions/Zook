import { ApplicationError } from "../shared/errors.ts";
import type { AiNovelCreditsStore } from "../modules/ai-novel/credits/ai-novel-credits-model.ts";
import type { UsageFilter } from "../shared/types/ai-novel-usage-admin.ts";
import { buildUsageReport } from "../modules/admin/ai-novel-usage-report.ts";

export function usageFilter(
  query: Record<string, string | undefined>,
  now = new Date(),
): UsageFilter {
  const days = query.days ?? "30";
  if (!["7", "30", "90"].includes(days))
    throw new ApplicationError(
      400,
      "REQ_INVALID_QUERY",
      "days must be 7, 30 or 90",
    );
  const tier = query.tier ?? "all";
  if (!["all", "free", "plus", "pro"].includes(tier))
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid credit tier");
  const environment = query.environment ?? "production";
  if (!["production", "sandbox"].includes(environment))
    throw new ApplicationError(
      400,
      "REQ_INVALID_QUERY",
      "Invalid payment environment",
    );
  const userId = query.userId?.trim();
  if (userId && !/^[A-Za-z0-9_.:-]{1,160}$/.test(userId))
    throw new ApplicationError(400, "REQ_INVALID_QUERY", "Invalid user ID");
  const to = new Date(now);
  to.setUTCHours(0, 0, 0, 0);
  to.setUTCDate(to.getUTCDate() + 1);
  const from = new Date(to.getTime() - Number(days) * 86400_000);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
    asOf: now.toISOString(),
    tier: tier as UsageFilter["tier"],
    sandbox: environment === "sandbox",
    ...(userId ? { userId } : {}),
  };
}
export class AiNovelUsageAdminService {
  constructor(private readonly store: AiNovelCreditsStore) {}
  async report(query: Record<string, string | undefined>) {
    if (!this.store.readUsageReport)
      throw new ApplicationError(
        503,
        "ADMIN_USAGE_UNAVAILABLE",
        "Credit reporting storage is unavailable",
      );
    const filter = usageFilter(query);
    return buildUsageReport(await this.store.readUsageReport(filter), filter);
  }
}
