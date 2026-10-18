import assert from "node:assert/strict";
import test from "node:test";
import { createJourneyServer } from "../helpers/frogsleep-journey-server.ts";

async function fixture() {
  const server = await createJourneyServer();
  try {
  const request = async (token: string, method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.url}/api/v1/frogsleep/${path}`, { method,
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: response.status, data: (await response.json() as any).data };
  };
  const login = async (name: string) => (await request("", "POST", "auth/password/login", { account: `${name}@example.com`, password: "Password1234" })).data.access_token;
  const a = await login("alice"), b = await login("bob");
  const invitation = await request(a, "POST", "buddy/invitations", { target: { user_id: "user_bob" }, domains: ["sleep", "focus"] });
  assert.equal(invitation.status, 200);
  const relationships: Record<string, string> = {};
  for (const domain of ["sleep", "focus"]) {
    const accepted = await request(b, "POST", `buddy/invitations/${invitation.data.invitation_id}/domains/${domain}/accept`, { expected_version: 1, idempotency_key: `journey_${domain}` });
    assert.equal(accepted.status, 200); relationships[domain] = accepted.data.relationship_id;
    for (const token of [a, b]) {
      const granted = await request(token, "PUT", `buddy/relationships/${relationships[domain]}/grants`, { domain,
        categories: ["presence", "daily_summary", "weekly_trend", "shared_activity"],
        expected_versions: { presence: 0, daily_summary: 0, weekly_trend: 0, shared_activity: 0 } });
      assert.equal(granted.status, 200);
    }
  }
  return { server, request, login, a, b, relationships };
  } catch (error) { await server.close(); throw error; }
}
const focus = (id: string) => ({ session_id: id, status: "completed", room_id: "room-one", planned_minutes: 25, actual_minutes: 25,
  started_at: "2026-10-11T10:00:00Z", ended_at: "2026-10-11T10:25:00Z" });

test("real HTTP two-account canonical Focus journey exposes current buddy, consented comparison and one shared moment", async () => {
  const f = await fixture();
  try {
    for (const [actor, peer] of [[f.a, "user_bob"], [f.b, "user_alice"]]) {
      const current = await f.request(actor, "GET", "focus-buddy/relationships/current");
      assert.equal(current.status, 200); assert.equal(current.data.relationship.id, f.relationships.focus);
      assert.equal(current.data.relationship.buddy_user_id, peer); assert.equal(current.data.relationship.invite_status, "accepted");
    }
    const reports = await Promise.all([f.request(f.a, "POST", "focus-buddy/sessions", focus("a-focus")), f.request(f.b, "POST", "focus-buddy/sessions", focus("b-focus"))]);
    assert.deepEqual(reports.map(value => value.status), [200, 200]);
    for (const actor of [f.a, f.b]) {
      const comparison = await f.request(actor, "GET", "focus-buddy/comparison?week_start=2026-10-05");
      assert.equal(comparison.status, 200); assert.equal(comparison.data.comparison.my_minutes, 25); assert.equal(comparison.data.comparison.buddy_minutes, 25);
      const moments = await f.request(actor, "GET", "focus-buddy/shared");
      assert.equal(moments.status, 200); assert.equal(moments.data.moments.length, 1);
    }
    await f.request(f.a, "POST", "focus-buddy/sessions", focus("a-focus"));
    assert.equal((await f.request(f.b, "GET", "focus-buddy/shared")).data.moments.length, 1);
  } finally { await f.server.close(); }
});

test("real HTTP morning acknowledgements stay independent, retry once and expose viewer-correct recaps", async () => {
  const f = await fixture();
  try {
    const started = await f.request(f.a, "POST", "sleep-buddy/shared-sessions", { relationship_id: f.relationships.sleep, date_anchor: "2026-10-11" });
    assert.equal(started.status, 200); const id = started.data.session_id;
    assert.equal((await f.request(f.b, "POST", `sleep-buddy/shared-sessions/${id}/accept`)).status, 200);
    const event = async (token: string, type: string) => f.request(token, "POST", `sleep-buddy/shared-sessions/${id}/events`, { event_type: type, occurred_at: "2026-10-11T23:00:00Z" });
    assert.equal((await event(f.a, "morning_completed")).data.status, "active");
    assert.equal((await f.request(f.b, "GET", "sleep-buddy/shared-summaries/latest")).data.summary.completed_morning, false);
    const bRecap = (await f.request(f.b, "GET", "sleep-buddy/shared-recaps/latest")).data.recap;
    assert.equal(bRecap.my_result_state, "incomplete"); assert.equal(bRecap.partner_result_state, "completed");
    assert.equal((await event(f.b, "morning_completed")).data.status, "completed");
    await event(f.a, "morning_completed"); await event(f.b, "morning_completed");
    for (const actor of [f.a, f.b]) assert.equal((await f.request(actor, "GET", "sleep-buddy/shared-recaps/latest")).data.recap.combined_result_type, "both_completed");
    assert.equal((await f.server.database().listFrogSleepEntities({ appId: "frogsleep", kind: "sleep_event", sessionId: id })).length, 2);
    for (const kind of ["sleep_summary", "night_recap"] as const) assert.equal((await f.server.database().listFrogSleepEntities({ appId: "frogsleep", kind, sessionId: id })).length, 2);
    assert.equal((await event(f.a, "returned")).status, 409);
  } finally { await f.server.close(); }
});

test("real HTTP pause, block and token revocation never gate the other account's private Focus history or new reports", async () => {
  const f = await fixture();
  try {
    await f.request(f.a, "POST", "focus-buddy/sessions", focus("before-change"));
    assert.equal((await f.request(f.b, "POST", `buddy/relationships/${f.relationships.focus}/pause`, { expected_version: 1 })).status, 200);
    assert.equal((await f.request(f.a, "POST", "focus-buddy/sessions", focus("paused-private"))).status, 200);
    assert.equal((await f.request(f.a, "GET", "focus-buddy/relationships/current")).data.relationship, null);
    assert.equal((await f.request(f.b, "POST", "buddy/users/user_alice/block", {})).status, 200);
    assert.equal((await f.request(f.a, "POST", "focus-buddy/sessions", focus("blocked-private"))).status, 200);
    assert.equal((await f.request(f.a, "GET", "focus-buddy/sessions")).data.sessions.length, 3);
    assert.equal((await f.request(f.b, "GET", "focus-buddy/sessions")).data.sessions.length, 0);
    assert.equal((await f.request(f.a, "POST", "auth/logout", { scope: "all" })).status, 200);
    assert.equal((await f.request(f.a, "POST", "focus-buddy/sessions", focus("expired-private"))).status, 401);
    assert.equal((await f.request(f.b, "POST", "focus-buddy/sessions", focus("peer-still-valid"))).status, 200);
    const renewed = await f.login("alice");
    assert.equal((await f.request(renewed, "POST", "focus-buddy/sessions", focus("expired-private"))).status, 200);
    assert.equal((await f.request(renewed, "GET", "focus-buddy/sessions")).data.sessions.length, 4);
  } finally { await f.server.close(); }
});
