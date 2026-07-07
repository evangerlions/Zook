import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PublicContractValidator } from "../../src/generated/openapi/public-contract-validator.ts";
import { FROGSLEEP_APP_ID } from "../../src/modules/frogsleep/frogsleep-app.ts";
import { FrogSleepProductDataService } from "../../src/modules/frogsleep/product-data/frogsleep-product-data.service.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function createTestRuntime() {
  return await createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(runtime: Awaited<ReturnType<typeof createTestRuntime>>, account: string) {
  const response = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: {
      account,
      password: "Password1234",
    },
    requestId: `req_product_data_login_${account}`,
  } as never);
  assert.equal(response.statusCode, 200);
  return {
    accessToken: String(response.body.data.access_token),
    refreshToken: String(response.body.data.refresh_token),
  };
}

test("FrogSleep product data stores reports, progress, and entitlement state", async () => {
  const runtime = await createTestRuntime();
  const { accessToken, refreshToken } = await login(runtime, "alice@example.com");
  const reportBody = {
    snapshot_id: "report_2026_06_01",
    schema_version: "1",
    recorded_at: "2026-06-01T08:00:00.000Z",
    date_anchor: "2026-06-01",
    data: { sleep_minutes: 430 },
  };
  assert.equal(PublicContractValidator.validateFrogSleepSleepReport(reportBody).ok, true);

  const report = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/product-data/sleep-reports",
    headers: { authorization: `Bearer ${accessToken}` },
    body: reportBody,
    requestId: "req_product_data_report_create",
  } as never);
  assert.equal(report.statusCode, 200);
  assert.equal(report.body.data.snapshot_id, "report_2026_06_01");
  assert.equal(report.body.data.snapshot_data.sleep_minutes, 430);

  const invalidReport = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/product-data/sleep-reports",
    headers: { authorization: `Bearer ${accessToken}` },
    body: { snapshot_id: "missing_version" },
    requestId: "req_product_data_report_invalid",
  } as never);
  assert.equal(invalidReport.statusCode, 400);

  const reports = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/product-data/sleep-reports",
    headers: { authorization: `Bearer ${accessToken}` },
    query: { limit: "10" },
    requestId: "req_product_data_report_list",
  } as never);
  assert.equal(reports.statusCode, 200);
  assert.equal(reports.body.data.sleep_reports.length, 1);
  assert.equal(reports.body.data.pagination.limit, 10);

  const progress = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/frogsleep/product-data/progress/companion_state",
    headers: { authorization: `Bearer ${accessToken}` },
    body: {
      schema_version: "1",
      state: { cat_name: "Momo", level: 3 },
    },
    requestId: "req_product_data_progress_upsert",
  } as never);
  assert.equal(progress.statusCode, 200);
  assert.equal(progress.body.data.namespace, "companion_state");
  assert.equal(PublicContractValidator.validateFrogSleepProgressSnapshot({
    version: "2",
    data: { cat_name: "Momo", level: 4 },
  }).ok, true);

  const patchedProgress = await runtime.app.handle({
    method: "PATCH",
    path: "/api/v1/frogsleep/product-data/progress/companion_state",
    headers: { authorization: `Bearer ${accessToken}` },
    body: {
      version: "2",
      data: { cat_name: "Momo", level: 4 },
    },
    requestId: "req_product_data_progress_patch",
  } as never);
  assert.equal(patchedProgress.statusCode, 200);
  assert.equal(patchedProgress.body.data.state.level, 4);

  const invalidProgress = await runtime.app.handle({
    method: "PUT",
    path: "/api/v1/frogsleep/product-data/progress/unknown",
    headers: { authorization: `Bearer ${accessToken}` },
    body: { schema_version: "1", state: {} },
    requestId: "req_product_data_progress_invalid",
  } as never);
  assert.equal(invalidProgress.statusCode, 400);

  const storedProgress = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/product-data/progress/companion_state",
    headers: { authorization: `Bearer ${accessToken}` },
    requestId: "req_product_data_progress_get",
  } as never);
  assert.equal(storedProgress.statusCode, 200);
  assert.equal(storedProgress.body.data.progress.state.cat_name, "Momo");

  const productData = new FrogSleepProductDataService(runtime.database);
  await productData.upsertEntitlement("user_alice", {
    state: "active",
    plan: "companion_plus",
    source: "storekit",
    verified_at: "2026-06-01T08:05:00.000Z",
  });
  const entitlement = await runtime.app.handle({
    method: "GET",
    path: "/api/v1/frogsleep/product-data/entitlements/current",
    headers: { authorization: `Bearer ${accessToken}` },
    requestId: "req_product_data_entitlement_get",
  } as never);
  assert.equal(entitlement.statusCode, 200);
  assert.equal(entitlement.body.data.entitlement.state, "active");
  assert.equal(entitlement.body.data.entitlement.plan, "companion_plus");

  const logout = await runtime.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/logout",
    headers: { authorization: `Bearer ${accessToken}` },
    body: { refresh_token: refreshToken },
    requestId: "req_product_data_logout",
  } as never);
  assert.equal(logout.statusCode, 200);
  assert.equal(runtime.database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "entitlement_record",
    ownerUserId: "user_alice",
  }).length, 1);
});
