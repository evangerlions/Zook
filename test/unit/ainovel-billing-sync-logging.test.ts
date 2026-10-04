import assert from "node:assert/strict";
import test from "node:test";
import { StructuredLogger } from "../../src/infrastructure/logging/pino-logger.module.ts";
import { buildEmptyMembershipInfo } from "../../src/modules/billing/billing-membership.ts";
import { normalizeRevenueCatSnapshot } from "../../src/modules/billing/ainovel-revenuecat-normalizer.ts";
import { runBillingSync } from "../../src/services/ainovel-billing-sync.ts";
import { RevenueCatApiError } from "../../src/services/ainovel-revenuecat-client.ts";

test("sync pending logs RC diagnostics with the route request ID", async () => {
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const result = await runBillingSync({ userId: "user-1", requestId: "req-1", reason: "purchase" }, {
    logger,
    fetchSnapshot: async () => { throw new RevenueCatApiError("request_failed", { httpStatus: 429, failureKind: "http_error" }); },
    persistSnapshot: async () => { assert.fail("unverified evidence must not persist"); },
    getMembership: async () => buildEmptyMembershipInfo(),
  });
  assert.equal(result.syncStatus, "pending");
  assert.equal(logger.records.at(-1)!.httpStatus, 429);
  assert.ok(logger.records.every((record) => record.requestId === "req-1"));
});

test("sync persistence failure keeps original exception and logs no database payload", async () => {
  const logger = new StructuredLogger("test", { emitToConsole: false });
  const failure = new Error("SECRET_DATABASE_CONNECTION");
  const snapshot = normalizeRevenueCatSnapshot({ observedAt: "2026-10-03T00:00:00Z", activeEntitlements: [], subscriptions: [] }, "user-1", new Date("2026-10-03T00:00:00Z"), { allowSandbox: true });
  await assert.rejects(runBillingSync({ userId: "user-1", requestId: "req-2" }, {
    logger, fetchSnapshot: async () => snapshot,
    persistSnapshot: async () => { throw failure; },
    getMembership: async () => buildEmptyMembershipInfo(),
  }), (error: unknown) => error === failure);
  assert.equal(logger.records.at(-1)!.failureReason, "database_error");
  assert.ok(!JSON.stringify(logger.records).includes("SECRET_"));
});
