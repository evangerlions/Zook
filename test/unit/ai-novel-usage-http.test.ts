import assert from "node:assert/strict";
import test from "node:test";
import { startUsageAdminRuntime } from "../support/usage-admin-http-runtime.ts";

test("fresh HTTP Admin flow reads canonical credit fixtures, validates filters, returns empty exact user and recovers", async () => {
  const server = await startUsageAdminRuntime();
  try {
    const path = `${server.url}/api/v1/admin/apps/ai_novel/usage`;
    assert.equal((await fetch(path)).status, 401);
    const login = await fetch(`${server.url}/api/v1/admin/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: "usage-qa",
        password: "UsageQA-local-only!",
      }),
    });
    assert.equal(login.status, 200);
    const cookie = login.headers.get("set-cookie")!;
    const get = (query: string) =>
      fetch(`${path}?${query}`, { headers: { cookie } });
    const response = await get("days=30");
    assert.equal(response.status, 200);
    const data = (await response.json()).data;
    assert.equal(data.summary.chargedPoints, 16350);
    assert.equal(data.summary.activeUsers, 6);
    assert.equal(data.summary.payingUsers, 4);
    assert.equal(data.summary.absorbedPoints, 885);
    const plus = (await (await get("tier=plus")).json()).data;
    assert.equal(plus.summary.chargedPoints, 4215);
    assert.equal(
      plus.simulation.find((s: { tier: string }) => s.tier === "pro")
        .consumption.length,
      4,
    );
    const user = (await (await get("userId=qa_usage_4")).json()).data;
    assert.equal(user.users.length, 1);
    assert.equal(
      user.detailEvents.filter((e: { kind: string }) => e.kind === "debit")
        .length,
      3,
    );
    const empty = (await (await get("userId=qa_absent")).json()).data;
    assert.equal(empty.users.length, 0);
    assert.equal(empty.tiers[0].p50, null);
    assert.equal((await get("days=invalid")).status, 400);
    assert.equal((await get("days=7")).status, 200);
    console.log(
      JSON.stringify({
        evidence: "usage-admin-http",
        url: server.url,
        chargedPoints: data.summary.chargedPoints,
        storage: "explicit QA fixture",
        routes: "session/filter/detail/empty/error/recovery",
      }),
    );
  } finally {
    await server.close();
  }
});
