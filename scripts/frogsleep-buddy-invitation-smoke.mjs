#!/usr/bin/env node

const baseUrl = (process.env.ZOOK_BASE_URL ?? "http://127.0.0.1:3100").replace(/\/+$/, "");
const api = `${baseUrl}/api/v1/frogsleep`;

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

async function requestResponse(method, path, token, body) {
  const response = await fetch(`${api}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  return { status: response.status, text, data: payload.data ?? payload };
}

async function request(method, path, token, body) {
  const response = await requestResponse(method, path, token, body);
  if (response.status < 200 || response.status >= 300) {
    throw new Error(`${method} ${path}: ${response.status} ${response.text}`);
  }
  return response.data;
}

async function login(label) {
  const account = required(`BUDDY_SMOKE_${label}_EMAIL`);
  const password = required(`BUDDY_SMOKE_${label}_PASSWORD`);
  const result = await request("POST", "/auth/password/login", undefined, { account, password });
  return { email: account, token: result.access_token, userId: result.user_id };
}

const inviter = await login("A");
const recipient = await login("B");
const wrongAccount = process.env.BUDDY_SMOKE_C_EMAIL?.trim()
  ? await login("C")
  : undefined;
const created = await request("POST", "/buddy/invitations", inviter.token, {
  target: { email: recipient.email },
  domains: ["sleep", "focus"],
});
if (!created.invitation_id || !created.share_code || !created.share_link) {
  throw new Error("Canonical create response is missing invitation_id/share_code/share_link");
}

if (wrongAccount) {
  const rejected = await requestResponse(
    "POST",
    `/buddy/invitations/${encodeURIComponent(created.invitation_id)}/accept`,
    wrongAccount.token,
    {
      expected_version: 1,
      idempotency_key: `wrong-account-${Date.now()}`,
      sharing_categories: ["presence", "daily_summary"],
    },
  );
  if (![403, 404].includes(rejected.status)) {
    throw new Error(`Wrong account expected a privacy-safe rejection, got ${rejected.status}: ${rejected.text}`);
  }
}

let delivery = created.delivery;
for (let index = 0; index < 6 && ["queued", "processing", "retryable_failed"].includes(delivery?.status); index += 1) {
  await new Promise((resolve) => setTimeout(resolve, 2_000));
  delivery = (await request(
    "GET", `/buddy/invitations/${encodeURIComponent(created.invitation_id)}/delivery`, inviter.token,
  )).delivery;
}

const preview = await request(
  "GET", `/buddy/invitations/preview?code=${encodeURIComponent(created.share_code)}`, recipient.token,
);
if (!preview.viewer_can_accept) throw new Error("Recipient cannot accept the canonical invitation");
const idempotencyKey = `smoke-${Date.now()}`;
const accepted = await request(
  "POST", `/buddy/invitations/${encodeURIComponent(created.invitation_id)}/accept`, recipient.token,
  {
    expected_version: preview.version,
    idempotency_key: idempotencyKey,
    sharing_categories: ["presence", "daily_summary"],
  },
);
if (accepted.results?.filter((item) => item.status === "accepted").length !== 2) {
  throw new Error(`Expected two accepted domain results: ${JSON.stringify(accepted.results)}`);
}
const replayed = await request(
  "POST", `/buddy/invitations/${encodeURIComponent(created.invitation_id)}/accept`, recipient.token,
  {
    expected_version: preview.version,
    idempotency_key: idempotencyKey,
    sharing_categories: ["presence", "daily_summary"],
  },
);
if (replayed.results?.filter((item) => item.status === "accepted").length !== 2) {
  throw new Error(`Idempotent acceptance replay was not accepted: ${JSON.stringify(replayed.results)}`);
}

const [sent, received] = await Promise.all([
  request("GET", "/buddy/invitations?direction=outgoing", inviter.token),
  request("GET", "/buddy/invitations?direction=incoming", recipient.token),
]);
const visible = (page) => page.invitations?.some((item) => item.invitation_id === created.invitation_id);
if (!visible(sent) || !visible(received)) throw new Error("Invitation is not bilaterally visible");

const relationships = await Promise.all([
  request("GET", "/sleep-buddy/relationships/current", inviter.token),
  request("GET", "/focus-buddy/relationships/current", inviter.token),
]);
for (const [index, current] of relationships.entries()) {
  const relationship = current.relationship ?? current;
  const relationshipId = relationship.relationship_id ?? relationship.id;
  if (!relationshipId) throw new Error("Accepted relationship is missing its id");
  const domain = index === 0 ? "sleep-buddy" : "focus-buddy";
  await request("POST", `/${domain}/relationships/${encodeURIComponent(relationshipId)}/revoke`, inviter.token);
}

console.log(JSON.stringify({
  ok: true,
  invitation_id: created.invitation_id,
  delivery_status: delivery?.status ?? "not_queued",
  domains: accepted.results.map((item) => ({ domain: item.domain, status: item.status })),
  inviter_user_id: inviter.userId,
  recipient_user_id: recipient.userId,
  wrong_account_rejected: Boolean(wrongAccount),
  idempotent_replay: true,
  relationships_revoked: true,
}, null, 2));
