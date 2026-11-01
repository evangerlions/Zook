import assert from "node:assert/strict";
import test from "node:test";
import { tryHandleAiNovelRoutes } from "../../src/app/ai-novel-routes.ts";
import type { BackendRouteContext } from "../../src/app/backend-route-context.ts";
import type { HttpRequest } from "../../src/shared/types.ts";

test("catalog authenticates AINovel scope before reading model data", async () => {
  const order: string[] = [];
  const context = {
    authenticateProductRequest: async (_request: unknown, appId: string) => { order.push(appId); },
    aiNovelLlmService: { getPublicModels: async () => { order.push("catalog"); return { models: [] }; } },
    ok: (data: unknown, requestId: string) => ({ statusCode: 200, body: { code: "OK", data, requestId } }),
  } as unknown as BackendRouteContext;
  const request = { method: "GET", path: "/api/v1/ai_novel/models", requestId: "r" } as HttpRequest;
  const response = await tryHandleAiNovelRoutes.call(context, request);
  assert.deepEqual(order, ["ai_novel", "catalog"]);
  assert.deepEqual(response?.body, { code: "OK", data: { models: [] }, requestId: "r" });
});

test("catalog never exposes data when authentication fails", async () => {
  let reads = 0;
  const context = {
    authenticateProductRequest: async () => { throw new Error("unauthorized"); },
    aiNovelLlmService: { getPublicModels: async () => { reads++; return { models: [] }; } },
  } as unknown as BackendRouteContext;
  await assert.rejects(tryHandleAiNovelRoutes.call(context, { method: "GET", path: "/api/v1/ai_novel/models" } as HttpRequest), /unauthorized/);
  assert.equal(reads, 0);
});
