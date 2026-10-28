import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { enableFrogSleepBuddyCapabilities } from "./enable-frogsleep-buddy-capabilities.ts";

// Opt-in local test process; never mount its fixture route in the product server.
const databaseUrl = process.env.FROGSLEEP_TEST_DATABASE_URL;
if (!databaseUrl) throw new Error("A disposable FROGSLEEP_TEST_DATABASE_URL is required.");
const parsed = new URL(databaseUrl);
if (!["localhost", "127.0.0.1"].includes(parsed.hostname) || !parsed.pathname.startsWith("/frogsleep_p0_")) {
  throw new Error("P0 simulator acceptance only supports a local frogsleep_p0_* database.");
}
enableFrogSleepBuddyCapabilities();
const runtime = await createApplication({ frogsleepEnabled: true, queueBackend: "memory",
  databaseFactory: seed => PostgresDatabase.create(databaseUrl, seed) });
type Actor = { id: string; email: string; accessToken: string; refreshToken: string };

async function call(actor: Actor, method: string, path: string, body?: unknown) {
  const result = await runtime.app.handle({ method, path: `/api/v1/frogsleep${path}`, body,
    headers: { authorization: `Bearer ${actor.accessToken}` }, requestId: "p0_simulator_setup" } as never);
  if (result.statusCode !== 200) throw new Error(`${path}: ${JSON.stringify(result.body)}`);
  return result.body.data;
}

async function participant(role: string): Promise<Actor> {
  const id = `p0_sim_${role}_${randomUUID().replaceAll("-", "")}`, email = `${id}@example.test`;
  await runtime.database.insertUser({ id, email, passwordHash: "unused", passwordAlgo: "test",
    status: "ACTIVE", createdAt: new Date().toISOString() });
  await runtime.services.appRegistryService.ensureMembership("frogsleep", id);
  const session = await runtime.services.authService.issueSession(id, "frogsleep");
  return { id, email, accessToken: session.accessToken, refreshToken: session.refreshToken };
}

async function fixture() {
  const alice = await participant("alice"), bob = await participant("bob");
  const invitation = await call(alice, "POST", "/buddy/invitations", { target: { email: bob.email }, domains: ["sleep"] });
  const accepted = await call(bob, "POST", `/buddy/invitations/${invitation.invitation_id}/domains/sleep/accept`,
    { expected_version: 1, idempotency_key: randomUUID() });
  const relationshipID = String(accepted.relationship_id);
  for (const actor of [alice, bob]) {
    const { grants } = await call(actor, "GET", `/buddy/relationships/${relationshipID}/grants`);
    for (const grant of grants.filter((item: any) => item.grantor_user_id === actor.id && item.state !== "granted")) {
      await call(actor, "PATCH", `/buddy/relationships/${relationshipID}/grants/${grant.id}`,
        { expected_version: grant.version, state: "granted" });
    }
  }
  const value = { relationshipID, alice, bob };
  const output = process.env.FROGSLEEP_P0_FIXTURE_PATH;
  if (output) await writeFile(output, JSON.stringify(value), { mode: 0o600 });
  return value;
}

async function completedFixture() {
  const value = await fixture(), { alice, bob, relationshipID } = value;
  const goal = await call(alice, "POST", "/buddy/goals", { relationship_id: relationshipID,
    type: "sleep_schedule_days", target: 1, timezone: "UTC", idempotency_key: randomUUID() });
  await call(bob, "POST", `/buddy/goals/${goal.id}/accept`, { expected_version: goal.version, idempotency_key: randomUUID() });
  const activity = await call(alice, "POST", "/buddy/joint-activities", {
    relationship_id: relationshipID, type: "tonight_together", idempotency_key: randomUUID() });
  await call(bob, "POST", `/buddy/joint-activities/${activity.id}/accept`);
  for (const actor of [alice, bob]) await call(actor, "POST", `/buddy/joint-activities/${activity.id}/start`);
  const sessions = [];
  for (const [index, actor] of [alice, bob].entries()) sessions.push(await call(actor, "POST", "/sleep-buddy/shared-sessions", {
    relationship_id: relationshipID, joint_activity_id: activity.id,
    date_anchor: new Date(Date.now() + index * 86_400_000).toISOString().slice(0, 10) }));
  if (sessions[0].session_id !== sessions[1].session_id) throw new Error("Cross-date session split in UI setup");
  for (const actor of [alice, bob]) {
    await call(actor, "POST", `/sleep-buddy/shared-sessions/${sessions[0].session_id}/accept`);
    await call(actor, "POST", `/sleep-buddy/shared-sessions/${sessions[0].session_id}/events`, {
      event_type: "morning_completed", occurred_at: new Date().toISOString() });
  }
  // Materialize the real in-app notification; queued APNs jobs are not dispatched by this local fixture process.
  await runtime.services.buddyNotificationWorkerService.processBatch(500);
  const result = { ...value, activityID: activity.id, goalID: goal.id, sessionID: sessions[0].session_id };
  const output = process.env.FROGSLEEP_P0_FIXTURE_PATH;
  if (output) await writeFile(output, JSON.stringify(result), { mode: 0o600 });
  return result;
}

const server = createServer(async (request, response) => {
  try {
    let raw = "";
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url!, "http://127.0.0.1");
    if (request.method === "POST" && ["/audit/p0/fixture", "/audit/p0/completed-fixture"].includes(url.pathname)) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify(await (url.pathname.endsWith("/completed-fixture") ? completedFixture() : fixture())));
      return;
    }
    const result = await runtime.app.handle({ method: request.method, path: url.pathname,
      headers: request.headers, query: Object.fromEntries(url.searchParams),
      body: raw ? JSON.parse(raw) : undefined, requestId: "p0_simulator_http" } as never);
    response.writeHead(result.statusCode, { "content-type": "application/json", ...result.headers });
    response.end(JSON.stringify(result.body));
    console.log(`${request.method} ${url.pathname} ${result.statusCode}`);
  } catch (error) {
    console.error(error);
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ code: "P0_FIXTURE_FAILURE" }));
  }
});
server.listen(33125, "127.0.0.1", () => console.log("P0 simulator server ready at http://127.0.0.1:33125"));
process.on("SIGTERM", () => server.close(async () => { await runtime.close(); process.exit(0); }));
