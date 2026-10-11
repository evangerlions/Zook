import { adminPath, requestJson } from "./admin-api-client.ts";
export type {
  UsageReport,
  UsageUser,
  UsageTier,
} from "../../../../src/shared/types/ai-novel-usage-admin";
import type { UsageReport } from "../../../../src/shared/types/ai-novel-usage-admin";

export interface UsageQuery {
  days: number;
  tier: string;
  environment: string;
  userId?: string;
}
export const loadAiNovelUsage = (query: UsageQuery) => {
  const params = new URLSearchParams(
    Object.entries(query)
      .filter(([, value]) => value !== undefined)
      .map(([key, value]) => [key, String(value)]),
  );
  return requestJson<UsageReport>(adminPath(`/apps/ai_novel/usage?${params}`));
};
