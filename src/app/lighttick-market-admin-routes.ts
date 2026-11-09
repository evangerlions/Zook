import type { BackendRouteContext } from "./backend-route-context.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest } from "../shared/types.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleMarketAdmin(
  context: BackendRouteContext,
  runtime: LightTickRuntime | undefined,
  enabled: boolean,
  r: HttpRequest,
) {
  if (
    r.path !==
    "/api/v1/admin/apps/lighttick/market-providers/tushare-credential"
  )
    return;
  const session = context.requireAdminSession(r);
  if (!enabled || !runtime?.marketPolicy)
    fail(503, "LightTick market is unavailable.");
  if (r.method === "GET") {
    const result = await runtime.marketPolicy.summary();
    await context.recordAdminReadAudit(
      session.adminUser,
      "lighttick.market.credential.read",
      "market_provider",
      "tushare",
      r.requestId,
      "metadata_only",
    );
    return context.ok(result, r.requestId ?? "", {
      "Cache-Control": "no-store",
    });
  }
  if (r.method === "PUT") {
    await context.assertAdminSensitiveOperation(
      session,
      "lighttick.market.credentials.write",
    );
    const result = await runtime.marketPolicy.rotate(
      object(r.body),
      r.headers["idempotency-key"] ?? "",
    );
    await context.recordAdminMutationAudit({
      appId: "lighttick",
      actorUserId: session.adminUser,
      action: "lighttick.market.credential.rotate",
      resourceType: "market_provider",
      resourceId: "tushare",
      payload: { ...result, requestId: r.requestId },
    });
    return context.ok(result, r.requestId ?? "", {
      "Cache-Control": "no-store",
    });
  }
  fail(404, "Market admin route was not found.");
}
