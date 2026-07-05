#!/usr/bin/env node

import pg from "pg";

const baseUrl = normalizeBaseUrl(process.env.ZOOK_BASE_URL ?? "http://127.0.0.1:3100");
const cleanupExisting = process.env.SMOKE_CLEANUP_EXISTING !== "0";
const enableExpiredInviteDbMutation = process.env.SMOKE_EXPIRED_INVITE_DB_MUTATION === "1";
const databaseUrl = normalizeDatabaseUrl(process.env.SMOKE_DATABASE_URL ?? process.env.DATABASE_URL ?? "");

const accounts = {
  A: readAccount("A"),
  B: readAccount("B"),
  C: readAccount("C"),
};

const evidence = [];

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function normalizeDatabaseUrl(value) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  const parsed = new URL(trimmed);
  parsed.searchParams.delete("schema");
  return parsed.toString();
}

function readAccount(label) {
  const email = process.env[`SMOKE_${label}_EMAIL`]?.trim();
  if (!email) {
    throw new Error(`Missing SMOKE_${label}_EMAIL`);
  }
  return {
    label,
    email,
    password: process.env[`SMOKE_${label}_PASSWORD`]?.trim(),
    code: process.env[`SMOKE_${label}_CODE`]?.trim(),
    token: undefined,
    userId: undefined,
  };
}

function record(step, details = {}) {
  evidence.push({ step, ...details });
  console.log(`[smoke] ${step}`, JSON.stringify(details));
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function request(method, path, { token, body, expectedStatus } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(body ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (expectedStatus !== undefined) {
    assert(
      response.status === expectedStatus,
      `${method} ${path} expected ${expectedStatus}, got ${response.status}: ${text}`,
    );
  } else if (!response.ok) {
    throw new Error(`${method} ${path} failed with ${response.status}: ${text}`);
  }
  return { status: response.status, body: payload };
}

async function healthCheck() {
  const response = await fetch(`${baseUrl}/api/health`);
  const text = await response.text();
  assert(response.ok, `GET /api/health failed with ${response.status}: ${text}`);
  record("health", { baseUrl, status: response.status });
}

async function login(account) {
  let response;
  if (account.password) {
    response = await request("POST", "/v1/auth/password/login", {
      body: {
        account: account.email,
        password: account.password,
      },
    });
  } else {
    assert(account.code, `SMOKE_${account.label}_PASSWORD or SMOKE_${account.label}_CODE is required`);
    await request("POST", "/v1/auth/email/auth-code", {
      body: {
        email: account.email,
      },
    });
    response = await request("POST", "/v1/auth/email/complete", {
      body: {
        email: account.email,
        code: account.code,
      },
    });
  }

  account.token = response.body.access_token ?? response.body.data?.access_token;
  account.userId = response.body.user_id ?? response.body.data?.user_id;
  assert(account.token, `Login did not return an access token for ${account.label}`);
  assert(account.userId, `Login did not return a user id for ${account.label}`);
  record(`login_${account.label}`, { userId: account.userId, email: account.email });
}

function invitePayload(response) {
  return response.body.data ?? response.body.invite ?? response.body;
}

function relationshipPayload(response) {
  return response.body.relationship ?? response.body.data?.relationship ?? response.body.data ?? response.body;
}

function relationshipFromCurrent(response) {
  const relationship = response.body.relationship ?? response.body.data?.relationship;
  return relationship && typeof relationship === "object" ? relationship : undefined;
}

async function cleanupExistingRelationships() {
  if (!cleanupExisting) {
    record("cleanup_skipped", { reason: "SMOKE_CLEANUP_EXISTING=0" });
    return;
  }
  for (const account of Object.values(accounts)) {
    await cleanupCurrentRelationship(account, "/v1/relationships/current", "/v1/relationships", "sleep");
    await cleanupCurrentRelationship(account, "/v1/focus/relationships/current", "/v1/focus/relationships", "focus");
  }
}

async function cleanupCurrentRelationship(account, currentPath, actionBasePath, kind) {
  const current = relationshipFromCurrent(await request("GET", currentPath, {
    token: account.token,
  }));
  const relationshipId = current?.relationship_id ?? current?.id;
  if (!relationshipId) {
    return;
  }
  await request("POST", `${actionBasePath}/${relationshipId}/revoke`, {
    token: account.token,
  });
  record(`${kind}_relationship_revoked_for_${account.label}`, {
    relationshipId,
  });
}

async function createSleepInvite(inviter, inviteeEmail, label) {
  const response = await request("POST", "/v1/relationships/invites", {
    token: inviter.token,
    body: {
      invitee: inviteeEmail,
    },
  });
  const invite = invitePayload(response);
  for (const field of ["invite_id", "invite_code", "invite_token", "invite_link", "status", "expires_at"]) {
    assert(invite[field], `${label} missing ${field}`);
  }
  assert(
    String(invite.invitee_email_snapshot ?? "").toLowerCase() === inviteeEmail.toLowerCase(),
    `${label} invitee_email_snapshot mismatch`,
  );
  record(label, {
    inviteId: invite.invite_id,
    code: invite.invite_code,
    inviteeEmailSnapshot: invite.invitee_email_snapshot,
  });
  return invite;
}

async function sleepBuddyFlow() {
  const invite = await createSleepInvite(accounts.A, accounts.B.email, "sleep_invite_created_for_B");

  const mismatched = await request("POST", "/v1/relationships/invites/accept-token", {
    token: accounts.C.token,
    body: {
      token: invite.invite_token,
    },
    expectedStatus: 403,
  });
  record("sleep_mismatched_email_rejected", { status: mismatched.status, code: mismatched.body.code });

  const accepted = await request("POST", "/v1/relationships/invites/accept-token", {
    token: accounts.B.token,
    body: {
      token: invite.invite_token,
    },
  });
  const relationship = relationshipPayload(accepted);
  assert(relationship.status === "active", "Sleep relationship was not active after B accepted");
  record("sleep_invite_accepted_by_B", {
    relationshipId: relationship.relationship_id ?? relationship.id,
    status: relationship.status,
  });

  const reused = await request("POST", "/v1/relationships/invites/accept-code", {
    token: accounts.B.token,
    body: {
      code: invite.invite_code,
    },
    expectedStatus: 400,
  });
  record("sleep_reused_invite_rejected", { status: reused.status, code: reused.body.code });

  const aCurrent = relationshipPayload(await request("GET", "/v1/relationships/current", {
    token: accounts.A.token,
  }));
  const bCurrent = relationshipPayload(await request("GET", "/v1/relationships/current", {
    token: accounts.B.token,
  }));
  assert(aCurrent.status === "active", "A current sleep relationship is not active");
  assert(bCurrent.status === "active", "B current sleep relationship is not active");
  record("sleep_current_relationships_active", {
    aRelationshipId: aCurrent.relationship_id ?? aCurrent.id,
    bRelationshipId: bCurrent.relationship_id ?? bCurrent.id,
  });
}

async function invalidSleepInviteFlow() {
  await expiredSleepInviteFlow();

  const cancelledInvite = await createSleepInvite(accounts.A, accounts.C.email, "sleep_invite_created_for_cancel");
  await request("POST", `/v1/relationships/invites/${cancelledInvite.invite_id}/cancel`, {
    token: accounts.A.token,
  });
  const cancelledAccept = await request("POST", "/v1/relationships/invites/accept-code", {
    token: accounts.C.token,
    body: {
      code: cancelledInvite.invite_code,
    },
    expectedStatus: 400,
  });
  record("sleep_cancelled_invite_rejected", { status: cancelledAccept.status, code: cancelledAccept.body.code });

  const selfInvite = await createSleepInvite(accounts.A, accounts.C.email, "sleep_invite_created_for_self_accept");
  const selfAccept = await request("POST", "/v1/relationships/invites/accept-token", {
    token: accounts.A.token,
    body: {
      token: selfInvite.invite_token,
    },
    expectedStatus: 400,
  });
  record("sleep_self_accept_rejected", { status: selfAccept.status, code: selfAccept.body.code });
}

async function expiredSleepInviteFlow() {
  if (!enableExpiredInviteDbMutation) {
    record("sleep_expired_invite_not_publicly_seeded", {
      note: "Set SMOKE_EXPIRED_INVITE_DB_MUTATION=1 with SMOKE_DATABASE_URL or DATABASE_URL to verify expired invite acceptance.",
    });
    return;
  }
  assert(databaseUrl, "SMOKE_EXPIRED_INVITE_DB_MUTATION=1 requires SMOKE_DATABASE_URL or DATABASE_URL");

  const expiredInvite = await createSleepInvite(accounts.A, accounts.C.email, "sleep_invite_created_for_expire");
  await mutateSleepInviteExpiresAt(expiredInvite.invite_id, "2020-01-01T00:00:00.000Z");
  const expiredAccept = await request("POST", "/v1/relationships/invites/accept-code", {
    token: accounts.C.token,
    body: {
      code: expiredInvite.invite_code,
    },
    expectedStatus: 400,
  });
  record("sleep_expired_invite_rejected", { status: expiredAccept.status, code: expiredAccept.body.code });
}

async function mutateSleepInviteExpiresAt(inviteId, expiresAt) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const result = await pool.query(
      `UPDATE zook_frogsleep_sleep_invites
         SET payload = jsonb_set(payload, '{expires_at}', to_jsonb($2::text), true),
             updated_at = NOW()
       WHERE app_id = 'frogsleep'
         AND id = $1
         AND status = 'pending'
         AND deleted_at IS NULL`,
      [inviteId, expiresAt],
    );
    assert(result.rowCount === 1, `Expected to mutate one sleep invite, mutated ${result.rowCount}`);
    record("sleep_invite_mutated_to_expired", { inviteId, expiresAt });
  } finally {
    await pool.end();
  }
}

async function saveFocusProfile(account, displayName) {
  await request("POST", "/v1/focus/match-profile", {
    token: account.token,
    body: {
      display_name: displayName,
      study_types: ["deep_work"],
      scene_tags: ["morning", "reading"],
      active_period: "morning",
      matching_consent: true,
    },
  });
  record(`focus_profile_saved_${account.label}`, { userId: account.userId });
}

async function focusBuddyFlow() {
  await saveFocusProfile(accounts.A, "Smoke A");
  await saveFocusProfile(accounts.B, "Smoke B");

  const inviteResponse = await request("POST", `/v1/focus/matches/${encodeURIComponent(accounts.B.userId)}/invite`, {
    token: accounts.A.token,
  });
  const invite = invitePayload(inviteResponse);
  assert(invite.invite_code, "Focus invite missing invite_code");
  assert(invite.status === "pending", "Focus invite was not pending");
  record("focus_invite_created", {
    relationshipId: invite.relationship_id,
    code: invite.invite_code,
  });

  const acceptedResponse = await request("POST", "/v1/focus/buddy/invites/accept-code", {
    token: accounts.B.token,
    body: {
      code: invite.invite_code,
    },
  });
  const accepted = relationshipPayload(acceptedResponse);
  assert(accepted.status === "accepted", "Focus relationship was not accepted");
  record("focus_invite_accepted", {
    relationshipId: accepted.relationship_id ?? accepted.id,
    status: accepted.status,
  });

  const current = relationshipPayload(await request("GET", "/v1/focus/relationships/current", {
    token: accounts.A.token,
  }));
  assert(current.status === "accepted", "Focus current relationship is not accepted");
  record("focus_current_relationship_accepted", {
    relationshipId: current.relationship_id ?? current.id,
    buddyUserId: current.buddy_user_id,
  });
}

async function main() {
  await healthCheck();
  await login(accounts.A);
  await login(accounts.B);
  await login(accounts.C);
  await cleanupExistingRelationships();
  await sleepBuddyFlow();
  await invalidSleepInviteFlow();
  await focusBuddyFlow();
  console.log(JSON.stringify({ ok: true, baseUrl, evidence }, null, 2));
}

main().catch((error) => {
  console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
