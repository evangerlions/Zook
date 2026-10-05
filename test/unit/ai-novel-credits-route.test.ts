import assert from "node:assert/strict";
import test from "node:test";
import { tryHandleAiNovelCreditsRoutes } from "../../src/app/ai-novel-credits-routes.ts";
import type { BackendRouteContext } from "../../src/app/backend-route-context.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { creditMicrosInteger } from "../../src/modules/ai-novel/credits/ai-novel-credits-dto.ts";

test("credits APIs expose integer micros, not rounded or floating point balances", async () => {
  const context = {
    authenticateProductRequest: async () => ({ userId: "u" }),
    aiNovelLlmService: { creditsFlow: { enabled: true, credits: {
      balanceMicros: async () => ({ tier: "free", refreshAt: "2026-10-05T00:00:00.000Z", periodicMicros: "19999000", periodicLimitMicros: "20000000", giftMicros: "0", remainingMicros: "19999000" }),
    } } },
    validationPipe: { asObject: (body: unknown) => body },
    ok: (data: unknown) => ({ statusCode: 200, body: { data } }),
  } as unknown as BackendRouteContext;
  const balance = await tryHandleAiNovelCreditsRoutes.call(context, {
    method: "GET", path: "/api/v1/ai_novel/credits", requestId: "r",
  } as HttpRequest);
  assert.deepEqual((balance?.body as { data: unknown }).data, {
    enabled: true, tier: "free", refreshAt: "2026-10-05T00:00:00.000Z",
    periodicMicros: 19999000, periodicLimitMicros: 20000000, giftMicros: 0, remainingMicros: 19999000,
  });
  const result = await tryHandleAiNovelCreditsRoutes.call(context, {
    method: "POST", path: "/api/v1/ai_novel/credits/jobs/finish", requestId: "r",
    body: { jobId: "job", outcome: "success" },
  } as HttpRequest);
  assert.equal(result, undefined); // Clients cannot submit settlement outcomes.
});

test("integer transport rejects unsafe amounts rather than silently losing precision", () => {
  assert.equal(creditMicrosInteger("0"), 0);
  assert.equal(creditMicrosInteger(String(Number.MAX_SAFE_INTEGER)), Number.MAX_SAFE_INTEGER);
  for (const value of ["9007199254740992", "-1", "1.2", "invalid"]) {
    assert.throws(() => creditMicrosInteger(value));
  }
});
