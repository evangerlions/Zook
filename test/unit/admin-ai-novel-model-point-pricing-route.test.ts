import assert from "node:assert/strict";
import test from "node:test";

import { tryHandleAdminAiNovelModelPointPricingRoutes } from "../../src/app/admin-ai-novel-model-point-pricing-routes.ts";
import type { BackendRouteContext } from "../../src/app/backend-route-context.ts";
import type { HttpRequest } from "../../src/shared/types.ts";

test("AINovel model point pricing admin routes authenticate, pass config, and audit mutations", async () => {
  const audits: Array<Record<string, unknown>> = [];
  let updatedInput: unknown;
  const document = {
    configKey: "ai_novel.model_point_pricing",
    config: { schemaVersion: 1, models: [] },
  };
  const context = {
    authenticateAdmin: () => "admin-user",
    adminConsoleService: {
      getAiNovelModelPointPricing: async () => document,
      updateAiNovelModelPointPricing: async (input: unknown) => {
        updatedInput = input;
        return document;
      },
    },
    validationPipe: {
      asObject: (value: unknown) => value as Record<string, unknown>,
      optionalString: (value: Record<string, unknown>, key: string) =>
        typeof value[key] === "string" ? value[key] as string : undefined,
    },
    auditInterceptor: { record: async (input: Record<string, unknown>) => { audits.push(input); } },
    ok: (data: unknown) => ({ statusCode: 200, body: { data } }),
  } as unknown as BackendRouteContext;

  const getResponse = await tryHandleAdminAiNovelModelPointPricingRoutes.call(
    context,
    { method: "GET", path: "/api/v1/admin/apps/ai_novel/model-point-pricing" } as HttpRequest,
  );
  assert.equal(getResponse?.statusCode, 200);
  assert.equal(audits[0]?.action, "admin.ai_novel_model_point_pricing.read");

  const config = { schemaVersion: 1, models: [{ modelKey: "m", inputPointsPerMillionTokens: 1, outputPointsPerMillionTokens: 2 }] };
  const putResponse = await tryHandleAdminAiNovelModelPointPricingRoutes.call(
    context,
    {
      method: "PUT",
      path: "/api/v1/admin/apps/ai_novel/model-point-pricing",
      body: { config, desc: "update" },
    } as HttpRequest,
  );
  assert.equal(putResponse?.statusCode, 200);
  assert.deepEqual(updatedInput, config);
  assert.equal(audits[1]?.action, "admin.ai_novel_model_point_pricing.update");
  assert.equal(
    await tryHandleAdminAiNovelModelPointPricingRoutes.call(
      context,
      { method: "GET", path: "/api/v1/admin/apps/common/model-point-pricing" } as HttpRequest,
    ),
    undefined,
  );
});
