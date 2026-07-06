# Focus Buddy Match Invite Conversion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the B+A scope: controlled Focus Partner matching plus invite conversion tracking/preview/recovery for FrogSleep.

**Architecture:** Keep sleep and focus relationship domains independent. Add small FrogSleep invite lifecycle helpers that update existing `sleep_invite` / `focus_invite` entity payloads instead of introducing a separate table. Add controlled matching controls as `focus_match_feedback` records so search can exclude dismissed/reported/cooldown users without changing profile storage.

**Tech Stack:** TypeScript, Node test runner, in-memory FrogSleep entity repository, Postgres migration `006_frogsleep_app.sql`, FrogSleep `/v1/*` API docs.

---

## Files

- Modify: `src/app/frogsleep-v1-routes.ts`
  - Track invite redirect opens.
  - Add authenticated preview endpoints.
  - Add focus match dismiss/report routes.
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
  - Add focus invite preview metadata.
  - Persist acceptance conversion metadata.
  - Add focus match feedback, cooldown, and search exclusion.
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts`
  - Add sleep invite preview metadata.
  - Persist acceptance conversion metadata.
- Modify: `src/modules/frogsleep/focus-buddy/focus-match-ranking.ts`
  - Accept excluded feedback user ids and add recommendation explanation fields.
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy-mappers.ts`
  - Return conversion metadata and controlled recommendation fields.
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy-mappers.ts`
  - Return conversion metadata.
- Modify: `src/infrastructure/database/postgres/migrations/006_frogsleep_app.sql`
  - Add indexes for invite lookup and focus match feedback lookup if missing.
- Modify: `README_API.md`
  - Document new preview, dismiss, report, conversion metadata, and controlled matching semantics.
- Modify: `docs/public-frogsleep-invites.md`
  - Document invite lifecycle and recovery flow.
- Modify: `docs/current-backend-implementation-overview.md`
  - Update backend capability matrix.
- Test: `test/unit/frogsleep-invites.api.test.ts`
  - Invite redirect tracking, preview, and acceptance metadata.
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`
  - Controlled matching dismiss/report/cooldown behavior.

## Task 1: Invite Redirect Open Tracking

**Files:**
- Modify: `src/app/frogsleep-v1-routes.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts`
- Test: `test/unit/frogsleep-invites.api.test.ts`

- [x] **Step 1: Write the failing test**

Add this test near the existing redirect test in `test/unit/frogsleep-invites.api.test.ts`:

```ts
test("FrogSleep invite redirects track open conversion metadata", async () => {
  const runtime = await createFrogSleepTestRuntime();
  const aliceToken = await loginWithPassword(runtime, "alice");

  const sleepInvite = await runtime.app.handle({
    method: "POST",
    path: "/v1/relationships/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { invitee: "user_bob", role: "friend" },
    requestId: "req_sleep_invite_open_create",
  });
  assert.equal(sleepInvite.statusCode, 200);

  const sleepRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/sleep-buddy-invite",
    query: {
      token: sleepInvite.body.data.invite_token,
      code: sleepInvite.body.data.invite_code,
    },
    headers: { "user-agent": "UnitTest/1.0" },
    requestId: "req_sleep_invite_open_redirect",
  });
  assert.equal(sleepRedirect.statusCode, 302);

  const storedSleepInvite = await runtime.database.findFrogSleepEntity(
    "sleep_invite",
    FROGSLEEP_APP_ID,
    String(sleepInvite.body.data.invite_id),
  );
  assert.equal(storedSleepInvite?.payload.open_count, 1);
  assert.equal(storedSleepInvite?.payload.last_open_source, "redirect");
  assert.equal(storedSleepInvite?.payload.last_open_user_agent, "UnitTest/1.0");
  assert.match(String(storedSleepInvite?.payload.first_opened_at), /^\d{4}-\d{2}-\d{2}T/);
  assert.match(String(storedSleepInvite?.payload.last_opened_at), /^\d{4}-\d{2}-\d{2}T/);

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { user_id: "user_bob" },
    requestId: "req_focus_invite_open_create",
  });
  assert.equal(focusInvite.statusCode, 200);

  const focusRedirect = await runtime.app.handle({
    method: "GET",
    path: "/frogsleep/focus-invite",
    query: {
      token: focusInvite.body.data.invite_token,
      code: focusInvite.body.data.invite_code,
    },
    headers: { "user-agent": "UnitTest/2.0" },
    requestId: "req_focus_invite_open_redirect",
  });
  assert.equal(focusRedirect.statusCode, 302);

  const storedFocusInvite = await runtime.database.findFrogSleepEntityByToken(
    "focus_invite",
    FROGSLEEP_APP_ID,
    String(focusInvite.body.data.invite_token),
  );
  assert.equal(storedFocusInvite?.payload.open_count, 1);
  assert.equal(storedFocusInvite?.payload.last_open_source, "redirect");
  assert.equal(storedFocusInvite?.payload.last_open_user_agent, "UnitTest/2.0");
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts
```

Expected: FAIL because `open_count` and open timestamp fields are not written on redirect.

- [x] **Step 3: Add redirect tracking methods**

Add to `FrogSleepSleepBuddyService`:

```ts
async trackInviteOpenByToken(token: string, userAgent?: string) {
  const invite = await this.database.findFrogSleepEntityByToken("sleep_invite", FROGSLEEP_APP_ID, token.trim());
  if (!invite) {
    return;
  }
  await this.markInviteOpened(invite, userAgent);
}

private async markInviteOpened(invite: FrogSleepEntityRecord, userAgent?: string) {
  const openedAt = nowIso();
  const payload = invite.payload ?? {};
  await this.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, invite.id, {
    payload: {
      ...payload,
      first_opened_at: payload.first_opened_at ?? openedAt,
      last_opened_at: openedAt,
      open_count: Number(payload.open_count ?? 0) + 1,
      last_open_source: "redirect",
      last_open_user_agent: userAgent,
    },
  });
}
```

Add the same shape to `FrogSleepFocusBuddyService`, changing kind to `"focus_invite"`.

- [x] **Step 4: Call tracking from redirect routes**

In `src/app/frogsleep-v1-routes.ts`, before each `redirectTo(...)`, call:

```ts
await new FrogSleepSleepBuddyService(this.database, this.notificationService)
  .trackInviteOpenByToken(String(token), request.headers?.["user-agent"]);
```

and:

```ts
await focusBuddyService(this)
  .trackInviteOpenByToken(String(token), request.headers?.["user-agent"]);
```

- [x] **Step 5: Run test to verify it passes**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts
```

Expected: PASS.

## Task 2: Authenticated Invite Preview and Recovery

**Files:**
- Modify: `src/app/frogsleep-v1-routes.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts`
- Test: `test/unit/frogsleep-invites.api.test.ts`

- [x] **Step 1: Write the failing test**

Add:

```ts
test("FrogSleep invite preview supports post-login recovery without accepting", async () => {
  const runtime = await createFrogSleepTestRuntime();
  const aliceToken = await loginWithPassword(runtime, "alice");
  const bobToken = await loginWithPassword(runtime, "bob");

  const focusInvite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/buddy/invites",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { user_id: "user_bob" },
    requestId: "req_focus_preview_invite_create",
  });

  const preview = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/buddy/invites/preview",
    query: { token: focusInvite.body.data.invite_token },
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_focus_preview_token",
  });
  assert.equal(preview.statusCode, 200);
  assert.equal(preview.body.data.invite.invite_id, focusInvite.body.data.relationship_id);
  assert.equal(preview.body.data.invite.status, "pending");
  assert.equal(preview.body.data.invite.viewer_can_accept, true);
  assert.equal(preview.body.data.invite.accept_method, "token");
  assert.equal(preview.body.data.invite.domain, "focus");

  const current = await runtime.app.handle({
    method: "GET",
    path: "/v1/focus/relationships/current",
    headers: { authorization: `Bearer ${bobToken}` },
    requestId: "req_focus_preview_current",
  });
  assert.equal(current.body.data.relationship, null);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts
```

Expected: FAIL with route not found.

- [x] **Step 3: Implement preview methods**

Add to `FrogSleepFocusBuddyService`:

```ts
async previewInvite(userId: string, input: { token?: string; code?: string }) {
  const invite = input.token
    ? await this.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, input.token.trim())
    : input.code
      ? await this.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, input.code.trim())
      : undefined;
  const currentInvite = invite ? await this.refreshInviteStatus(invite) : undefined;
  if (!currentInvite) {
    badRequest("REQ_INVALID_BODY", "Invite not found.");
  }
  const relationship = currentInvite.relationshipId
    ? await this.database.findFrogSleepEntity("focus_relationship", FROGSLEEP_APP_ID, currentInvite.relationshipId)
    : undefined;
  return {
    invite: {
      domain: "focus",
      invite_id: relationship?.id ?? currentInvite.id,
      raw_invite_id: currentInvite.id,
      status: currentInvite.status,
      inviter_user_id: currentInvite.ownerUserId,
      invitee_user_id: currentInvite.partnerUserId,
      viewer_can_accept: currentInvite.status === "pending" && currentInvite.partnerUserId === userId,
      accept_method: input.token ? "token" : "code",
      expires_at: currentInvite.payload.expires_at ?? currentInvite.payload.expiresAt,
      share_title: currentInvite.payload.shareTitle,
      share_subtitle: currentInvite.payload.shareSubtitle,
    },
  };
}
```

Add sleep equivalent to `FrogSleepSleepBuddyService`, using kind `"sleep_invite"`, domain `"sleep"`, and allowing `viewer_can_accept` when invite is pending and either `partnerUserId === userId` or the email ownership check would pass.

- [x] **Step 4: Add routes**

In `src/app/frogsleep-v1-routes.ts`:

```ts
if (request.method === "GET" && request.path === "/v1/focus/buddy/invites/preview") {
  const auth = await authenticateFrogSleepRequest(this, request);
  return frogSleepOk(this, await focusBuddyService(this).previewInvite(auth.userId, {
    token: request.query?.token,
    code: request.query?.code,
  }), request.requestId as string);
}
```

Add the sleep route:

```ts
if (request.method === "GET" && request.path === "/v1/relationships/invites/preview") {
  const auth = await authenticateFrogSleepRequest(this, request);
  return frogSleepOk(this, await new FrogSleepSleepBuddyService(this.database, this.notificationService).previewInvite(auth.userId, {
    token: request.query?.token,
    code: request.query?.code,
  }), request.requestId as string);
}
```

- [x] **Step 5: Run test to verify it passes**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts
```

Expected: PASS.

## Task 3: Acceptance Conversion Metadata

**Files:**
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy.service.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy-mappers.ts`
- Modify: `src/modules/frogsleep/sleep-buddy/sleep-buddy-mappers.ts`
- Test: `test/unit/frogsleep-invites.api.test.ts`

- [x] **Step 1: Write the failing test**

Extend an existing accept-token test with:

```ts
const acceptedInvite = await runtime.database.findFrogSleepEntity(
  "sleep_invite",
  FROGSLEEP_APP_ID,
  String(inviteResponse.body.data.invite_id),
);
assert.equal(acceptedInvite?.payload.accepted_by_user_id, "user_new-buddy@example.com");
assert.equal(acceptedInvite?.payload.accept_source, "token");
assert.match(String(acceptedInvite?.payload.accepted_at), /^\d{4}-\d{2}-\d{2}T/);
assert.equal(inviteeAcceptResponse.body.data.source_invite_id, inviteResponse.body.data.invite_id);
assert.equal(inviteeAcceptResponse.body.data.accept_source, "token");
```

For focus, after accept-code:

```ts
const acceptedFocusInvite = await runtime.database.findFrogSleepEntityByCode(
  "focus_invite",
  FROGSLEEP_APP_ID,
  String(inviteResponse.body.data.invite_code),
);
assert.equal(acceptedFocusInvite?.payload.accepted_by_user_id, "user_bob");
assert.equal(acceptedFocusInvite?.payload.accept_source, "code");
assert.equal(acceptResponse.body.data.source_invite_id, acceptedFocusInvite?.id);
assert.equal(acceptResponse.body.data.accept_source, "code");
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: FAIL because accept metadata is not persisted or returned.

- [x] **Step 3: Thread accept source through service methods**

Change signatures:

```ts
async acceptInviteByCode(userId: string, code: string) {
  const invite = await this.database.findFrogSleepEntityByCode("focus_invite", FROGSLEEP_APP_ID, code);
  return await this.acceptInvite(userId, invite, "code");
}

async acceptInviteByToken(userId: string, token: string) {
  const invite = await this.database.findFrogSleepEntityByToken("focus_invite", FROGSLEEP_APP_ID, token);
  return await this.acceptInvite(userId, invite, "token");
}
```

Do the same for sleep, and use `"id"` in `acceptInviteById`.

- [x] **Step 4: Persist metadata**

In each private `acceptInvite(...)`, when updating the invite:

```ts
await this.database.updateFrogSleepEntity("focus_invite", FROGSLEEP_APP_ID, currentInvite.id, {
  status: "accepted",
  payload: {
    ...currentInvite.payload,
    accepted_at: nowIso(),
    accepted_by_user_id: userId,
    accept_source: source,
  },
});
```

For sleep, preserve existing `partnerUserId` and `relationshipId` update:

```ts
await this.database.updateFrogSleepEntity("sleep_invite", FROGSLEEP_APP_ID, currentInvite.id, {
  status: "accepted",
  partnerUserId: userId,
  relationshipId: relationship.id,
  payload: {
    ...currentInvite.payload,
    accepted_at: nowIso(),
    accepted_by_user_id: userId,
    accept_source: source,
  },
});
```

- [x] **Step 5: Return metadata in mappers**

In focus relationship mapper:

```ts
source_invite_id: invite?.id ?? relationship.payload.source_invite_id,
accept_source: invite?.payload.accept_source ?? relationship.payload.accept_source,
accepted_at: invite?.payload.accepted_at ?? relationship.payload.accepted_at,
```

In sleep relationship mapper, add the same fields from `relationship.payload` and pass accepted invite data into relationship payload during creation:

```ts
payload: {
  inviteId: currentInvite.id,
  source_invite_id: currentInvite.id,
  accept_source: source,
  accepted_at,
},
```

- [x] **Step 6: Run tests**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: PASS.

## Task 4: Controlled Match Dismiss and Report

**Files:**
- Modify: `src/app/frogsleep-v1-routes.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`

- [x] **Step 1: Write the failing test**

Add:

```ts
test("FrogSleep controlled matching excludes dismissed and reported candidates", async () => {
  const runtime = await createFrogSleepTestRuntime();
  const aliceToken = await loginWithPassword(runtime, "alice");
  const bobToken = await loginWithPassword(runtime, "bob");

  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);

  const firstSearch = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_control_first_search",
  });
  assert.equal(firstSearch.body.data.candidates[0].user_id, "user_bob");

  const dismiss = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/dismiss",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "not_now" },
    requestId: "req_match_control_dismiss",
  });
  assert.equal(dismiss.statusCode, 200);
  assert.equal(dismiss.body.data.status, "dismissed");

  const afterDismiss = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_control_after_dismiss",
  });
  assert.deepEqual(afterDismiss.body.data.candidates, []);

  const report = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/report",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { reason: "unsafe_profile", note: "test" },
    requestId: "req_match_control_report",
  });
  assert.equal(report.statusCode, 200);
  assert.equal(report.body.data.status, "reported");
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: FAIL because dismiss/report routes do not exist.

- [x] **Step 3: Add service methods**

Add:

```ts
async recordMatchFeedback(userId: string, targetUserId: string, action: "dismissed" | "reported", input: Record<string, unknown>) {
  if (userId === targetUserId) {
    badRequest("REQ_INVALID_BODY", "Cannot record feedback for yourself.");
  }
  const createdAt = nowIso();
  const record: FrogSleepEntityRecord = {
    id: randomId("focus_match_feedback"),
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: userId,
    partnerUserId: targetUserId,
    status: action,
    payload: {
      reason: input.reason,
      note: input.note,
    },
    createdAt,
    updatedAt: createdAt,
  };
  await this.database.insertFrogSleepEntity(record);
  return {
    id: record.id,
    target_user_id: targetUserId,
    status: action,
    reason: record.payload.reason,
    created_at: record.createdAt,
  };
}

private async excludedMatchUserIds(userId: string) {
  const feedback = await this.database.listFrogSleepEntities({
    appId: FROGSLEEP_APP_ID,
    kind: "focus_match_feedback",
    ownerUserId: userId,
    limit: 500,
  });
  return new Set(feedback
    .filter((item) => item.status === "dismissed" || item.status === "reported")
    .map((item) => item.partnerUserId)
    .filter(Boolean) as string[]);
}
```

- [x] **Step 4: Exclude feedback in search**

In `searchMatches`, after relationship exclusions:

```ts
const feedbackExcluded = await this.excludedMatchUserIds(userId);
for (const excludedUserId of feedbackExcluded) {
  excluded.add(excludedUserId);
}
```

- [x] **Step 5: Add routes**

In `src/app/frogsleep-v1-routes.ts`:

```ts
const focusMatchFeedbackMatch = request.path.match(/^\/v1\/focus\/matches\/([^/]+)\/(dismiss|report)$/);
if (request.method === "POST" && focusMatchFeedbackMatch) {
  const auth = await authenticateFrogSleepRequest(this, request);
  return frogSleepOk(this, await focusBuddyService(this).recordMatchFeedback(
    auth.userId,
    decodeURIComponent(focusMatchFeedbackMatch[1] as string),
    focusMatchFeedbackMatch[2] === "report" ? "reported" : "dismissed",
    asBody(request),
  ), request.requestId as string);
}
```

- [x] **Step 6: Run test**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: PASS.

## Task 5: Invite Cooldown for Controlled Matching

**Files:**
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`

- [x] **Step 1: Write the failing test**

Add:

```ts
test("FrogSleep controlled matching hides candidates with pending outgoing invites", async () => {
  const runtime = await createFrogSleepTestRuntime();
  const aliceToken = await loginWithPassword(runtime, "alice");
  const bobToken = await loginWithPassword(runtime, "bob");

  await saveFocusMatchProfile(runtime, aliceToken, "Alice", ["study"], "evening", true);
  await saveFocusMatchProfile(runtime, bobToken, "Bob", ["study"], "evening", true);

  const invite = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/user_bob/invite",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: {},
    requestId: "req_match_cooldown_invite",
  });
  assert.equal(invite.statusCode, 200);

  const search = await runtime.app.handle({
    method: "POST",
    path: "/v1/focus/matches/search",
    headers: { authorization: `Bearer ${aliceToken}` },
    body: { limit: 10 },
    requestId: "req_match_cooldown_search",
  });
  assert.deepEqual(search.body.data.candidates, []);
  assert.equal(search.body.data.empty_state.reason, "pending_invites");
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: FAIL because empty state reason is not `pending_invites`.

- [x] **Step 3: Return pending invite empty state**

In `searchMatches`, if the user has any pending relationship, return:

```ts
const pendingOutgoing = relationships.find((item) => item.status === "pending" && item.ownerUserId === userId);
if (pendingOutgoing) {
  return {
    candidates: [],
    empty_state: {
      reason: "pending_invites",
      title_key: "buddy_match.empty.pending_invites.title",
      subtitle_key: "buddy_match.empty.pending_invites.subtitle",
      pending_relationship_id: pendingOutgoing.id,
      pending_user_id: this.otherUserId(pendingOutgoing, userId),
    },
  };
}
```

- [x] **Step 4: Run test**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: PASS.

## Task 6: Recommendation Explanation Fields

**Files:**
- Modify: `src/modules/frogsleep/focus-buddy/focus-match-ranking.ts`
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`

- [x] **Step 1: Write failing assertions**

In the existing ranking test, add:

```ts
assert.equal(samePeriodSearch.body.data.candidates[0].recommendation_type, "controlled_focus_partner");
assert.equal(samePeriodSearch.body.data.candidates[0].privacy_note_key, "buddy_match.privacy.summary_only");
assert.ok(Array.isArray(samePeriodSearch.body.data.candidates[0].why_recommended));
assert.ok(samePeriodSearch.body.data.candidates[0].why_recommended.includes("active_period"));
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: FAIL because new fields are absent.

- [x] **Step 3: Add fields**

In `toMatchCandidate` return object:

```ts
recommendation_type: "controlled_focus_partner",
privacy_note_key: "buddy_match.privacy.summary_only",
why_recommended: explanation,
invite_prompt_key: "buddy_match.invite.controlled_prompt",
```

- [x] **Step 4: Run test**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-focus-buddy.api.test.ts
```

Expected: PASS.

## Task 7: Postgres Indexes

**Files:**
- Modify: `src/infrastructure/database/postgres/migrations/006_frogsleep_app.sql`

- [x] **Step 1: Add indexes**

Append:

```sql
CREATE INDEX IF NOT EXISTS idx_frogsleep_invite_token_kind_app
  ON frogsleep_entities (app_id, kind, token)
  WHERE deleted_at IS NULL AND token IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_frogsleep_invite_code_kind_app
  ON frogsleep_entities (app_id, kind, code)
  WHERE deleted_at IS NULL AND code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_match_feedback_owner_partner
  ON frogsleep_entities (app_id, kind, owner_user_id, partner_user_id, status)
  WHERE deleted_at IS NULL AND kind = 'focus_match_feedback';
```

- [x] **Step 2: Run focused persistence tests**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-persistence.test.ts
```

Expected: PASS.

## Task 8: API Documentation

**Files:**
- Modify: `README_API.md`
- Modify: `docs/public-frogsleep-invites.md`
- Modify: `docs/current-backend-implementation-overview.md`

- [x] **Step 1: Update public API table**

Add to `README_API.md` FrogSleep route table:

```md
| `GET` | `/v1/relationships/invites/preview` | 登录后预览睡眠搭子邀请，不接受 |
| `GET` | `/v1/focus/buddy/invites/preview` | 登录后预览专注搭子邀请，不接受 |
| `POST` | `/v1/focus/matches/{userId}/dismiss` | 不再推荐该专注搭子候选人 |
| `POST` | `/v1/focus/matches/{userId}/report` | 举报专注搭子候选人并从推荐中移除 |
```

- [x] **Step 2: Document invite lifecycle**

Add to `docs/public-frogsleep-invites.md`:

```md
## 邀请转化生命周期

邀请会保存在 `pending -> opened -> accepted | declined | cancelled | expired` 的业务链路中。`opened` 不是独立状态，而是写入邀请 payload 的转化指标：`first_opened_at`、`last_opened_at`、`open_count`、`last_open_source`。客户端打开 deep link 后，如用户未登录，应本地保存 token/code，登录后先调用 preview，再由用户确认 accept。
```

- [x] **Step 3: Document controlled matching**

Add to `README_API.md` focus buddy section:

```md
专注搭子匹配是受控推荐，不是公开陌生人社交。候选人必须主动开启 `matching_consent`，资料 30 天内更新，且满足互相性别偏好、无既有 pending/accepted 关系、未被当前用户 dismiss/report。搜索响应会返回 `recommendation_type`、`why_recommended`、`privacy_note_key`，客户端应展示“只共享摘要，不共享原始行为”的隐私说明。
```

- [x] **Step 4: Update implementation overview**

In `docs/current-backend-implementation-overview.md`, update FrogSleep capability bullet:

```md
专注搭子匹配已收敛为受控推荐：资料 consent、近期活跃、互相偏好、pending invite 冷却、dismiss/report 排除；邀请链路记录 open/accept 转化元数据，并提供登录后 preview 以支持 deep link 恢复接受。
```

## Task 9: Final Verification

**Files:**
- All files touched in Tasks 1-8.

- [x] **Step 1: Run focused FrogSleep tests**

Run:

```bash
node --experimental-transform-types --test test/unit/frogsleep-invites.api.test.ts test/unit/frogsleep-focus-buddy.api.test.ts test/unit/frogsleep-persistence.test.ts
```

Expected: PASS.

- [x] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [x] **Step 3: Run line-count check**

Run:

```bash
npm run check:line-count
```

Expected: PASS.

- [x] **Step 4: Run whitespace check**

Run:

```bash
git diff --check
```

Expected: no output.

- [x] **Step 5: Summarize rollout impact**

Include in final handoff:

```md
上线影响：FrogSleep 仍受 `FROGSLEEP_ENABLED` 控制；新增 preview/dismiss/report 路由只影响 FrogSleep `/v1/*`；redirect tracking 只写 invite payload，不改变 302 行为；search 将隐藏已有 pending invite 的候选人，这是受控匹配的预期行为。
```

## Self-Review

- Spec coverage: B is covered by controlled candidate recommendation, dismiss/report, pending invite cooldown, and explanation/privacy fields. A is covered by redirect open tracking, login recovery preview, and acceptance conversion metadata.
- Placeholder scan: No TBD/TODO/implement-later placeholders remain.
- Type consistency: New entity kind is consistently `focus_match_feedback`; invite metadata keys use snake_case across services and docs; preview routes use `token`/`code` query parameters for both domains.
