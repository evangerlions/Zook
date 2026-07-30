import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const capabilityVariables = [
  "FROGSLEEP_BUDDY_INBOX_ENABLED",
  "FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED",
  "FROGSLEEP_BUDDY_INTERACTIONS_ENABLED",
  "FROGSLEEP_BUDDY_FOCUS_MATCHING_ENABLED",
] as const;

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
    requestId: "buddy_capabilities_login",
  } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function preserveCapabilities() {
  const saved = Object.fromEntries(capabilityVariables.map((name) => [name, process.env[name]]));
  return () => {
    for (const name of capabilityVariables) {
      const value = saved[name];
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
}

test("v1 buddy capabilities are authenticated, cacheable, and expose only ordinary commands", async () => {
  const restore = preserveCapabilities();
  process.env.FROGSLEEP_BUDDY_INBOX_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_EXPLICIT_CONSENT_ENABLED = "true";
  process.env.FROGSLEEP_BUDDY_INTERACTIONS_ENABLED = "true";

  try {
    const app = await runtime();
    const token = await login(app);
    const requestedAt = Date.now();
    const response = await app.app.handle({
      method: "GET",
      path: "/api/v1/frogsleep/buddy/capabilities",
      headers: { authorization: `Bearer ${token}` },
      requestId: "buddy_capabilities_enabled",
    } as never);
    const respondedAt = Date.now();

    assert.equal(response.statusCode, 200);
    assert.equal(response.headers?.["Cache-Control"], "private, max-age=300");
    assert.equal(response.body.code, "OK");
    assert.equal(response.body.data.schema_version, "1");
    assert.equal(response.body.data.buddy_api_version, "1");
    assert.equal(response.body.data.minimum_client_version, "1.0.0");
    const expiresAt = Date.parse(String(response.body.data.expires_at));
    assert.ok(expiresAt >= requestedAt);
    assert.ok(expiresAt <= respondedAt + (5 * 60 * 1000));
    assert.deepEqual(response.body.data.commands, {
      create: true, accept: true, preview: true, email_delivery: false, activity: true, share: true,
      focus_matching: false,
    });
    assert.equal(response.body.data.safety_commands, undefined);
    assert.equal(response.body.data.invitation, undefined);
    assert.equal(response.body.data.relationship, undefined);
    assert.equal(response.body.data.grant, undefined);
    assert.equal(response.body.data.account, undefined);
    assert.equal(response.body.data.capabilities, undefined);
    assert.equal(response.body.data.feature_flags, undefined);

    const unauthenticated = await app.app.handle({
      method: "GET",
      path: "/api/v1/frogsleep/buddy/capabilities",
      headers: {},
      requestId: "buddy_capabilities_unauthenticated",
    } as never);
    assert.equal(unauthenticated.statusCode, 401);
    assert.equal(unauthenticated.body.code, "AUTH_BEARER_REQUIRED");
  } finally {
    restore();
  }
});

test("v1 buddy capabilities fail closed when ordinary growth flags are disabled", async () => {
  const restore = preserveCapabilities();
  for (const name of capabilityVariables) delete process.env[name];

  try {
    const app = await runtime();
    const token = await login(app);
    const response = await app.app.handle({
      method: "GET",
      path: "/api/v1/frogsleep/buddy/capabilities",
      headers: { authorization: `Bearer ${token}` },
      requestId: "buddy_capabilities_disabled",
    } as never);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data.commands, {
      create: false, accept: false, preview: false, email_delivery: false, activity: false, share: false,
      focus_matching: false,
    });
  } finally {
    restore();
  }
});
