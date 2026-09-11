import assert from "node:assert/strict";
import test from "node:test";

import { ApiError, requestJson } from "../../apps/admin-web/app/lib/admin-api-client.ts";

test("admin JSON client rejects a successful non-JSON response", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("<!doctype html>", {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  try {
    await assert.rejects(
      () => requestJson("/api/v1/ai_novel/debug/traces/session"),
      (error: unknown) => error instanceof ApiError &&
        error.code === "ADMIN_INVALID_RESPONSE" &&
        error.message.includes("非 JSON"),
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
