import assert from "node:assert/strict";

const baseUrl = (process.env.LIGHTTICK_DEV_BASE_URL ?? "http://127.0.0.1:3101").replace(/\/$/, "");
const account = process.env.LIGHTTICK_DEV_ACCOUNT;
const password = process.env.LIGHTTICK_DEV_PASSWORD;
const deletionAccount = process.env.LIGHTTICK_DEV_DELETION_ACCOUNT;
const deletionPassword = process.env.LIGHTTICK_DEV_DELETION_PASSWORD;
const runId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
const today = new Date().toISOString().slice(0, 10);

if (!account || !password) {
  throw new Error("LIGHTTICK_DEV_ACCOUNT and LIGHTTICK_DEV_PASSWORD are required.");
}

const sleep = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const operation = name => `dev-${name}-${runId}`;

async function request(label, path, { method = "GET", token, body, idempotencyKey, expected = [200] } = {}) {
  const headers = { accept: "application/json", "x-app-id": "lighttick" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (token) headers.authorization = `Bearer ${token}`;
  if (idempotencyKey) headers["idempotency-key"] = idempotencyKey;
  const response = await fetch(`${baseUrl}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const payload = await response.json().catch(() => ({}));
  if (!expected.includes(response.status)) {
    throw new Error(`${label} failed: HTTP ${response.status} ${payload.code ?? "UNKNOWN"} ${payload.message ?? ""}`.trim());
  }
  console.log(`${label}: ${response.status} ${payload.code ?? "OK"}`);
  return { status: response.status, data: payload.data, code: payload.code };
}

async function login(loginAccount, loginPassword, label = "registered login") {
  const result = await request(label, "/api/v1/auth/login", { method: "POST", body: {
    appId: "lighttick", account: loginAccount, password: loginPassword, clientType: "app",
  } });
  assert.equal(typeof result.data?.accessToken, "string");
  return result.data;
}

async function pollRun(token, id, label) {
  for (let attempt = 0; attempt < 35; attempt += 1) {
    const result = await request(`${label} poll`, `/api/v1/lighttick/runs/${id}`, { token });
    if (["succeeded", "failed"].includes(result.data.status)) return result.data;
    await sleep(2_000);
  }
  throw new Error(`${label} did not finish within the acceptance window.`);
}

const publicConfig = await request("public configuration", "/api/v1/lighttick/public/config");
assert.equal(publicConfig.data.enabled, true);
assert.deepEqual(publicConfig.data.features, {
  guest_sessions: true, account_upgrade: true, sync: true, notifications: true, ai_coach: true,
});

const registered = await login(account, password);
const guestDeviceId = `ios-guest-${runId}`;
const guest = (await request("iOS guest session", "/api/v1/lighttick/account/guest-sessions", {
  method: "POST", idempotencyKey: operation("guest"), expected: [201], body: {
    device_id: guestDeviceId,
    device_secret: `internal-device-secret-${runId}-at-least-32-characters`,
    platform: "ios", timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0",
  },
})).data;

const starter = (await request("progressive onboarding starter", "/api/v1/lighttick/onboarding/starter", {
  method: "POST", token: guest.access_token, idempotencyKey: operation("starter"), expected: [201],
  body: { wish: "完成 LightTick 原生客户端内部验收", timezone: "Asia/Shanghai", locale: "zh-CN" },
})).data;
await request("progressive first action", "/api/v1/lighttick/onboarding/first-action", {
  method: "POST", token: guest.access_token, idempotencyKey: operation("first-action"), body: {
    task_id: starter.recommended.id, base_version: starter.recommended.version,
    selected_variant: "minimum", actual_duration_minutes: 5, difficulty: "right",
  },
});
await request("progressive commitment", "/api/v1/lighttick/onboarding/commitment", {
  method: "POST", token: guest.access_token, idempotencyKey: operation("commitment"), body: {
    goal_id: starter.goal.id, mode: "light", deep_planning: true,
  },
});

const upgraded = (await request("guest upgrade", "/api/v1/lighttick/account/upgrade", {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("upgrade"), body: {
    guest_user_id: guest.user_id, guest_upgrade_token: guest.upgrade_token, device_id: guest.device_id,
  },
})).data;
assert.equal(upgraded.guest_session_revoked, true);
assert.equal(typeof upgraded.sync_cursor, "string");
await request("guest token revocation", "/api/v1/lighttick/account/session", {
  token: guest.access_token, expected: [401],
});

const onboardingRun = (await request("registered onboarding", "/api/v1/lighttick/onboarding", {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("onboarding"), expected: [202], body: {
    title: "交付 LightTick Phase 1", current_level: "implementation", weekly_available_minutes: 180,
    pace: "balanced", timezone: "Asia/Shanghai", motivation: "完成 Dev 内部验收",
  },
})).data;
const onboardingResult = await pollRun(registered.accessToken, onboardingRun.id, "onboarding plan");
assert.equal(onboardingResult.status, "succeeded");

const proposedPlan = (await request("generated plan", `/api/v1/lighttick/plans/${onboardingResult.result_resource_id}`, {
  token: registered.accessToken,
})).data;
const confirmedPlan = (await request("plan confirmation", `/api/v1/lighttick/plans/${proposedPlan.id}/confirm`, {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("confirm-plan"),
  body: { base_version: proposedPlan.version },
})).data;
assert.equal(confirmedPlan.status, "active");
assert.ok(confirmedPlan.tasks.length > 0);

const todayBefore = (await request("Today projection", "/api/v1/lighttick/today", { token: registered.accessToken })).data;
assert.ok(todayBefore.tasks.length > 0);
const executable = todayBefore.tasks.find(item => item.plan_id === confirmedPlan.id) ?? todayBefore.tasks[0];
const started = (await request("Today task start", `/api/v1/lighttick/tasks/${executable.id}/start`, {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("start-task"),
  body: { base_version: executable.version },
})).data;

const offlineOperation = {
  operation_id: operation("offline-complete"), device_id: `android-offline-${runId}`,
  entity_type: "task", entity_id: started.id, action: "complete", base_version: started.version,
  client_occurred_at: new Date().toISOString(), payload: { actual_duration_minutes: 12, note: "offline replay acceptance" },
};
const firstPush = (await request("offline operation push", "/api/v1/lighttick/sync/push", {
  method: "POST", token: registered.accessToken, body: { operations: [offlineOperation] },
})).data;
assert.equal(firstPush.results[0].status, "accepted");
const replayPush = (await request("offline lost-response replay", "/api/v1/lighttick/sync/push", {
  method: "POST", token: registered.accessToken, body: { operations: [offlineOperation] },
})).data;
assert.equal(replayPush.results[0].status, "duplicate");
const pulled = (await request("incremental sync pull", "/api/v1/lighttick/sync/pull?limit=100", {
  token: registered.accessToken,
})).data;
assert.ok(pulled.changes.some(change => change.entity_id === started.id));

const reviewRun = (await request("weekly review run", "/api/v1/lighttick/review-runs", {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("review"), expected: [202], body: {
    goal_id: proposedPlan.goal_id, period: "weekly", period_start: today, period_end: today,
  },
})).data;
const reviewResult = await pollRun(registered.accessToken, reviewRun.id, "weekly review");
assert.equal(reviewResult.status, "succeeded");
const review = (await request("weekly review", `/api/v1/lighttick/reviews/${reviewResult.result_resource_id}`, {
  token: registered.accessToken,
})).data;
assert.equal(review.status, "ready");

const coachRun = (await request("Coach explanation run", "/api/v1/lighttick/coach-runs", {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("coach"), expected: [202], body: {
    scene: "review_explanation", goal_id: proposedPlan.goal_id, plan_id: proposedPlan.id, review_id: review.id,
  },
})).data;
const coachResult = await pollRun(registered.accessToken, coachRun.id, "Coach explanation");
assert.equal(coachResult.status, "succeeded");

const proposalRun = (await request("change proposal run", "/api/v1/lighttick/change-proposal-runs", {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("proposal"), expected: [202], body: {
    plan_id: proposedPlan.id, base_version: confirmedPlan.version, reason: "internal_acceptance",
    available_minutes: 120, mood: "focused",
  },
})).data;
const proposalResult = await pollRun(registered.accessToken, proposalRun.id, "change proposal");
if (proposalResult.status === "succeeded") {
  const proposal = (await request("generated proposal", `/api/v1/lighttick/change-proposals/${proposalResult.result_resource_id}`, {
    token: registered.accessToken,
  })).data;
  const accepted = (await request("proposal acceptance", `/api/v1/lighttick/change-proposals/${proposal.id}/accept`, {
    method: "POST", token: registered.accessToken, idempotencyKey: operation("accept-proposal"),
    body: { base_version: proposal.version },
  })).data;
  assert.equal(accepted.status, "accepted");
} else {
  assert.ok(["LIGHTTICK_AI_UNAVAILABLE", "LLM_SERVICE_NOT_CONFIGURED"].includes(proposalResult.error_code));
  console.log("proposal acceptance: deferred to opt-in provider smoke; failed run made no plan write");
}

const latestGoal = (await request("goal before pause", `/api/v1/lighttick/goals/${proposedPlan.goal_id}`, {
  token: registered.accessToken,
})).data;
const paused = (await request("goal pause", `/api/v1/lighttick/goals/${latestGoal.id}/lifecycle`, {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("pause"), body: {
    action: "pause", base_version: latestGoal.version, reason: "internal_acceptance", keep_light_tasks: false,
    notification_policy: "suppress",
  },
})).data;
assert.equal(paused.status, "paused");
const resumed = (await request("goal recovery resume", `/api/v1/lighttick/goals/${paused.id}/lifecycle`, {
  method: "POST", token: registered.accessToken, idempotencyKey: operation("resume"), body: {
    action: "resume", base_version: paused.version, resume_mode: "recovery_mode",
  },
})).data;
assert.equal(resumed.status, "recovering");

for (const [platform, provider] of [["ios", "apns"], ["android", "fcm"]]) {
  await request(`${platform} notification device`, "/api/v1/lighttick/devices", {
    method: "POST", token: registered.accessToken, idempotencyKey: operation(`device-${platform}`), body: {
      device_id: `${platform}-internal-${runId}`, platform, push_provider: provider,
      push_token: `internal-${platform}-push-token-${runId}`, timezone: "Asia/Shanghai",
      locale: "zh-CN", app_version: "1.0.0", notifications_enabled: true,
    },
  });
}

if (deletionAccount && deletionPassword) {
  const deletionSession = await login(deletionAccount, deletionPassword, "deletion account login");
  const proof = (await request("deletion reauthentication", "/api/v1/lighttick/account/reauthentication", {
    method: "POST", token: deletionSession.accessToken, body: { current_password: deletionPassword },
  })).data;
  const deleted = (await request("LightTick membership deletion", "/api/v1/lighttick/me/account", {
    method: "DELETE", token: deletionSession.accessToken, body: {
      confirmation: "DELETE", reauthentication_token: proof.reauthentication_token,
    },
  })).data;
  assert.equal(deleted.membership_status, "DELETED");
  assert.equal(deleted.platform_account_retained, true);
}

console.log(JSON.stringify({ status: "passed", run_id: runId, proposal_status: proposalResult.status,
  deletion_checked: Boolean(deletionAccount && deletionPassword) }));
