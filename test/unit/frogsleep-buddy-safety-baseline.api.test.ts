import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

async function runtime() {
  return createApplication({
    frogsleepEnabled: true,
    queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed),
  });
}

async function login(app: Awaited<ReturnType<typeof runtime>>) {
  const response = await app.app.handle({
    method: "POST",
    path: "/api/v1/frogsleep/auth/password/login",
    headers: {},
    body: { account: "alice@example.com", password: "Password1234" },
    requestId: "safety_baseline_login",
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

test("v2 buddy safety baseline is authenticated, cacheable, and independent of buddy growth flags", async () => {
  const savedCapabilities = {
    inbox: process.env.FROGSLEEP_BUDDY_INBOX_ENABLED,
    consent: process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED,
    growth: process.env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED,
    interactions: process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED,
    goals: process.env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED,
    push: process.env.FROGSLEEP_BUDDY_PUSH_ENABLED,
  };
  delete process.env.FROGSLEEP_BUDDY_INBOX_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED;
  delete process.env.FROGSLEEP_BUDDY_PUSH_ENABLED;

  try {
    const app = await runtime();
    const token = await login(app);
    const response = await app.app.handle({
      method: "GET",
      path: "/api/v2/frogsleep/buddy/safety-baseline",
      headers: { authorization: `Bearer ${token}` },
      requestId: "safety_baseline_success",
    } as never);

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers?.["Cache-Control"], "private, max-age=300");
    assert.equal(response.body.code, "OK");
    assert.equal(response.body.data.schema_version, "1");
    assert.equal(response.body.data.minimum_client_version, "1.0.0");
    assert.equal(response.body.data.safety_commands.decline, true);
    assert.equal(response.body.data.safety_commands.cancel, true);
    assert.equal(response.body.data.safety_commands.pause, true);
    assert.equal(response.body.data.safety_commands.revoke, true);
    assert.equal(response.body.data.safety_commands.block, true);
    assert.ok(!Number.isNaN(Date.parse(String(response.body.data.server_time))));
    assert.equal(response.body.data.invitees, undefined);
    assert.equal(response.body.data.relationships, undefined);
    assert.equal(response.body.data.grants, undefined);
    assert.equal(response.body.data.capabilities, undefined);

    const unauthenticated = await app.app.handle({
      method: "GET",
      path: "/api/v2/frogsleep/buddy/safety-baseline",
      headers: {},
      requestId: "safety_baseline_unauthenticated",
    } as never);
    assert.equal(unauthenticated.statusCode, 401);
    assert.notEqual(unauthenticated.body.code, "OK");
  } finally {
    process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = savedCapabilities.inbox;
    process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = savedCapabilities.consent;
    process.env.FROGSLEEP_BUDDY_GROWTH_HUB_ENABLED = savedCapabilities.growth;
    process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED = savedCapabilities.interactions;
    process.env.FROGSLEEP_BUDDY_GOALS_REPORTS_ENABLED = savedCapabilities.goals;
    process.env.FROGSLEEP_BUDDY_PUSH_ENABLED = savedCapabilities.push;
  }
});
