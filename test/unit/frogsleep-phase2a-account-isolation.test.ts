import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const buddyFlags = ["INBOX", "EXPLICIT_CONSENT", "GROWTH_HUB", "INTERACTIONS", "GOALS_REPORTS", "PUSH", "EMAIL", "FOCUS_MATCHING", "GROUP"]
  .map((name) => `FROGSLEEP_BUDDY_${name}_ENABLED`);

async function withoutBuddy(action: () => Promise<void>) {
  const saved = buddyFlags.map((key) => [key, process.env[key]] as const);
  try {
    for (const key of buddyFlags) process.env[key] = "false";
    await action();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

type Runtime = Awaited<ReturnType<typeof runtime>>;
async function request(app: Runtime, method: string, path: string, token?: string, body?: unknown) {
  return await app.app.handle({ method, path: `/api/v1/frogsleep${path}`,
    headers: token ? { authorization: `Bearer ${token}` } : {}, body,
    requestId: `phase2a_${method}_${path}` } as never);
}

async function login(app: Runtime, account: string) {
  const response = await request(app, "POST", "/auth/password/login", undefined,
    { account, password: "Password1234" });
  assert.equal(response.statusCode, 200);
  return response.body.data;
}

async function saveFocus(app: Runtime, token: string, id: string, claimedOwner: string) {
  const response = await request(app, "POST", "/focus-buddy/sessions", token, {
    session_id: id, owner_user_id: claimedOwner, user_id: claimedOwner,
    goal_tag: "study", planned_minutes: 25, actual_minutes: 25, status: "completed",
    started_at: "2026-10-10T10:00:00Z", ended_at: "2026-10-10T10:25:00Z",
  });
  assert.equal(response.statusCode, 200);
}

async function assertFocusIDs(app: Runtime, token: string, ids: string[]) {
  const result = await request(app, "GET", "/focus-buddy/sessions", token);
  assert.equal(result.statusCode, 200);
  assert.deepEqual(result.body.data.sessions.map((item: { id: string }) => item.id).sort(), ids.sort());
}

test("2A accounts remain real while every buddy capability is disabled", async () => {
  await withoutBuddy(async () => {
    const app = await runtime();
    const session = await login(app, "alice@example.com");
    assert.equal((await request(app, "GET", "/me", session.access_token)).body.data.user_id, "user_alice");
    const capabilities = await request(app, "GET", "/buddy/capabilities", session.access_token);
    assert.equal(capabilities.statusCode, 200);
    assert.ok(Object.values(capabilities.body.data.commands).every((enabled) => enabled === false));
    const refreshed = await request(app, "POST", "/auth/token/refresh", undefined, { refresh_token: session.refresh_token });
    assert.equal(refreshed.statusCode, 200);
    const next = refreshed.body.data;
    assert.equal(next.user_id, "user_alice");
    const logout = await request(app, "POST", "/auth/logout", next.access_token, { refresh_token: next.refresh_token });
    assert.equal(logout.statusCode, 200);
    assert.equal((await request(app, "POST", "/auth/token/refresh", undefined, { refresh_token: next.refresh_token })).statusCode, 401);
  });
});

test("2A personal focus ignores claimed ownership and remains isolated without buddies", async () => {
  await withoutBuddy(async () => {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    await saveFocus(app, alice.access_token, "phase2a_alice_focus", "user_bob");
    await saveFocus(app, bob.access_token, "phase2a_bob_focus", "user_alice");
    await assertFocusIDs(app, alice.access_token, ["phase2a_alice_focus"]);
    await assertFocusIDs(app, bob.access_token, ["phase2a_bob_focus"]);
  });
});

test("2A account deletion preserves another user's focus and another app's login", async () => {
  await withoutBuddy(async () => {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    await saveFocus(app, alice.access_token, "phase2a_delete_alice", "user_alice");
    await saveFocus(app, bob.access_token, "phase2a_keep_bob", "user_bob");
    await app.services.appRegistryService.ensureMembership("ai_novel", "user_alice");
    const otherApp = await app.services.authService.issueSession("user_alice", "ai_novel");
    assert.equal((await request(app, "DELETE", "/me/account", alice.access_token)).statusCode, 200);
    assert.equal((await request(app, "GET", "/me", alice.access_token)).statusCode, 401);
    assert.equal((await request(app, "POST", "/auth/token/refresh", undefined, { refresh_token: alice.refresh_token })).statusCode, 401);
    await assertFocusIDs(app, bob.access_token, ["phase2a_keep_bob"]);
    assert.equal(app.database.findAppUser("ai_novel", "user_alice")?.status, "ACTIVE");
    const refreshed = await app.services.authService.refresh({ appId: "ai_novel", refreshToken: otherApp.refreshToken });
    assert.equal(refreshed.userId, "user_alice");
  });
});
