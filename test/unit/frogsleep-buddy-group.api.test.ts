import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

const GROUP_FLAG = "FROGSLEEP_BUDDY_GROUP_ENABLED";

async function runtime() {
  return await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    databaseFactory: (seed) => new InMemoryDatabase(seed) });
}

async function login(app: Awaited<ReturnType<typeof runtime>>, account: string) {
  const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/auth/password/login",
    headers: {}, body: { account, password: "Password1234" }, requestId: `group_login_${account}` } as never);
  assert.equal(response.statusCode, 200);
  return String(response.body.data.access_token);
}

function auth(token: string) { return { authorization: `Bearer ${token}` }; }
function preserveFlag() {
  const saved = process.env[GROUP_FLAG];
  return () => saved === undefined ? delete process.env[GROUP_FLAG] : process.env[GROUP_FLAG] = saved;
}

test("group lifecycle: create → invite → accept → active → leave, with capability gating", async () => {
  const restore = preserveFlag();
  process.env[GROUP_FLAG] = "true";
  try {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/groups",
      headers: auth(alice), body: { domain: "sleep", group_name: "早睡小组", invitees: [{ user_id: "user_bob" }] },
      requestId: "group_create" } as never);
    assert.equal(created.statusCode, 200);
    const groupId = String(created.body.data.group_id);
    assert.equal(created.body.data.status, "forming");
    assert.equal(created.body.data.member_count, 1);

    const renamed = await app.app.handle({ method: "PATCH", path: `/api/v1/frogsleep/buddy/groups/${groupId}`,
      headers: auth(alice), body: { group_name: "早睡行动组", group_description: "22:30 打卡" },
      requestId: "group_rename" } as never);
    assert.equal(renamed.statusCode, 200);
    assert.equal(renamed.body.data.name, "早睡行动组");
    assert.equal(renamed.body.data.description, "22:30 打卡");

    const invitations = await app.app.handle({ method: "GET",
      path: `/api/v1/frogsleep/buddy/groups/${groupId}/invitations`, headers: auth(alice),
      requestId: "group_invites" } as never);
    assert.equal(invitations.statusCode, 200);
    const invitationId = String(invitations.body.data.invitations[0].invitation_id);
    assert.equal(invitations.body.data.invitations[0].status, "pending");

    const accepted = await app.app.handle({ method: "POST",
      path: `/api/v1/frogsleep/buddy/groups/invitations/${invitationId}/accept`, headers: auth(bob),
      requestId: "group_accept" } as never);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.body.data.status, "accepted");
    assert.equal(accepted.body.data.member_count, 2);

    const hub = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/groups/${groupId}/hub`,
      headers: auth(alice), requestId: "group_hub" } as never);
    assert.equal(hub.statusCode, 200);
    assert.equal(hub.body.data.group.status, "active");
    assert.equal(hub.body.data.members.length, 2);

    const detail = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/groups/${groupId}`,
      headers: auth(bob), requestId: "group_detail" } as never);
    assert.equal(detail.statusCode, 200);
    assert.equal(detail.body.data.name, "早睡行动组");
    assert.equal(detail.body.data.description, "22:30 打卡");
    assert.deepEqual(detail.body.data.members.map((item: { role: string }) => item.role).sort(),
      ["member", "owner"]);

    const left = await app.app.handle({ method: "POST", path: `/api/v1/frogsleep/buddy/groups/${groupId}/leave`,
      headers: auth(bob), requestId: "group_leave" } as never);
    assert.equal(left.statusCode, 200);
    assert.equal(left.body.data.status, "left");
    const afterLeave = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/groups/${groupId}`,
      headers: auth(alice), requestId: "group_after_leave" } as never);
    assert.equal(afterLeave.body.data.status, "forming");
  } finally { restore(); }
});

test("group is hidden when groupBuddies capability is off", async () => {
  const restore = preserveFlag();
  delete process.env[GROUP_FLAG];
  try {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const response = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/groups",
      headers: auth(alice), body: { domain: "sleep", group_name: "隐藏组" },
      requestId: "group_disabled" } as never);
    assert.equal(response.statusCode, 404);
  } finally { restore(); }
});

test("group email invitations deduplicate by normalized email", async () => {
  const restore = preserveFlag();
  process.env[GROUP_FLAG] = "true";
  try {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/groups",
      headers: auth(alice), body: { domain: "sleep", group_name: "邮箱组" },
      requestId: "group_email_create" } as never);
    const groupId = String(created.body.data.group_id);

    const invited = await app.app.handle({ method: "POST",
      path: `/api/v1/frogsleep/buddy/groups/${groupId}/invitations`, headers: auth(alice),
      body: { invitees: [{ email: "One@Example.com" }, { email: "two@example.com" }] },
      requestId: "group_email_invite" } as never);
    assert.equal(invited.statusCode, 200);
    assert.equal(invited.body.data.invitations.length, 2);

    const duplicate = await app.app.handle({ method: "POST",
      path: `/api/v1/frogsleep/buddy/groups/${groupId}/invitations`, headers: auth(alice),
      body: { email: "one@example.com" },
      requestId: "group_email_duplicate" } as never);
    assert.equal(duplicate.statusCode, 200);
    assert.equal(duplicate.body.data.invitations.length, 1);
    assert.equal(duplicate.body.data.invitations[0].invitee_email, "on***@example.com");
  } finally { restore(); }
});

test("non-member cannot read group and owner-only actions are enforced", async () => {
  const restore = preserveFlag();
  process.env[GROUP_FLAG] = "true";
  try {
    const app = await runtime();
    const alice = await login(app, "alice@example.com");
    const bob = await login(app, "bob@example.com");
    const created = await app.app.handle({ method: "POST", path: "/api/v1/frogsleep/buddy/groups",
      headers: auth(alice), body: { domain: "focus", group_name: "自习组" },
      requestId: "group_create_2" } as never);
    const groupId = String(created.body.data.group_id);
    const outsider = await app.app.handle({ method: "GET", path: `/api/v1/frogsleep/buddy/groups/${groupId}`,
      headers: auth(bob), requestId: "group_outsider" } as never);
    assert.equal(outsider.statusCode, 403);
    const memberDissolve = await app.app.handle({ method: "POST",
      path: `/api/v1/frogsleep/buddy/groups/${groupId}/dissolve`,
      headers: auth(alice), requestId: "group_dissolve_owner" } as never);
    assert.equal(memberDissolve.statusCode, 200);
    assert.equal(memberDissolve.body.data.status, "dissolved");
  } finally { restore(); }
});
