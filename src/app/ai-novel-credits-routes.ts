import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { ApplicationError } from "../shared/errors.ts";
import { creditMicrosInteger } from "../modules/ai-novel/credits/ai-novel-credits-dto.ts";

export async function tryHandleAiNovelCreditsRoutes(this: BackendRouteContext, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const balance = request.method === "GET" && request.path === "/api/v1/ai_novel/credits";
  if (!balance) return undefined;
  const auth = await this.authenticateProductRequest(request, "ai_novel");
  const flow = this.aiNovelLlmService.creditsFlow;
  if (!flow) throw new ApplicationError(503, "AINOVEL_CREDITS_DISABLED", "Credits service is unavailable.");
  if (balance) {
    const raw = await flow.credits.balanceMicros(auth.userId);
    return this.ok({
      enabled: flow.enabled, tier: raw.tier, refreshAt: raw.refreshAt,
      periodicMicros: creditMicrosInteger(raw.periodicMicros),
      periodicLimitMicros: creditMicrosInteger(raw.periodicLimitMicros),
      giftMicros: creditMicrosInteger(raw.giftMicros),
      remainingMicros: creditMicrosInteger(raw.remainingMicros),
    }, request.requestId as string);
  }
  return undefined;
}
