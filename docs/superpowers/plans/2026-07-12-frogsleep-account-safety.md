# FrogSleep Account Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make FrogSleep account deletion and buddy matching compliant with account-deletion and UGC safety requirements.

**Architecture:** The existing FrogSleep account endpoint remains app-scoped. Zook stores reports and blocks in the FrogSleep entity store, enforces isolation in `FrogSleepFocusBuddyService`, and reuses `ContentSafetyService` for profile text. iOS calls protocol-based API clients and clears local state only after a successful server response.

**Tech Stack:** Node TypeScript, Zook `ApplicationDatabase`, Swift 5.1, SwiftUI, XCTest, GRDB.

## Global Constraints

- Delete only FrogSleep membership, sessions, and app-scoped data; retain the shared Zook user and other app memberships.
- Public routes use `/api/v1/frogsleep/...` and are documented in `README_API.md`.
- New iOS user-facing text is localized in `Localizable.xcstrings`.
- Buddy messages accept predefined templates only; custom text is rejected server-side.
- An active block excludes both directions from matching, invitations, messages, presence, comparisons, and shared moments.

---

### Task 1: Add report/block data contracts and isolate blocked users in Zook

**Files:**
- Modify: `src/shared/types/records.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy-invites.ts`
- Modify: `src/app/frogsleep-v1-routes.ts`
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`

**Interfaces:**
- Add `focus_user_report` and `focus_user_block` to `FrogSleepEntityKind`.
- Add `reportUser(userId, targetUserId, reason)` and `setUserBlocked(userId, targetUserId, blocked)` to `FrogSleepFocusBuddyService`.
- Add `POST /focus-buddy/users/:id/report`, `PUT|DELETE /focus-buddy/users/:id/block`, and `GET /focus-buddy/blocked-users`.

- [ ] **Step 1: Add failing API tests**

```ts
test("block revokes an accepted relationship and rejects a new invite", async () => {
  const runtime = await createApplication();
  const { alice, bob, relationshipId } = await createAcceptedFocusPair(runtime);
  const response = await runtime.app.handle({
    method: "PUT",
    path: `/api/v1/frogsleep/focus-buddy/users/${bob.userId}/block`,
    headers: frogSleepHeaders(alice.accessToken),
  });
  assert.equal(response.statusCode, 200);
  assert.equal(runtime.database.findFrogSleepEntity("focus_relationship", "frogsleep", relationshipId)?.status, "revoked");
  assert.equal((await runtime.app.handle({ method: "POST", path: `/api/v1/frogsleep/focus-buddy/matches/${bob.userId}/invite`, headers: frogSleepHeaders(alice.accessToken) })).statusCode, 403);
});

test("the same unresolved report is stored once", async () => {
  const runtime = await createApplication();
  const { alice, bob } = await createFocusCandidates(runtime);
  const request = { method: "POST" as const, path: `/api/v1/frogsleep/focus-buddy/users/${bob.userId}/report`, headers: frogSleepHeaders(alice.accessToken), body: { reason: "harassment" } };
  assert.equal((await runtime.app.handle(request)).statusCode, 200);
  assert.equal((await runtime.app.handle(request)).statusCode, 200);
  assert.equal(runtime.database.frogSleepEntities.filter((item) => item.kind === "focus_user_report").length, 1);
});
```

- [ ] **Step 2: Run the test before implementation**

Run: `npm test -- test/unit/frogsleep-focus-buddy.api.test.ts`

Expected: FAIL because no report/block routes exist.

- [ ] **Step 3: Implement the smallest shared enforcement**

```ts
async isBlockedEitherDirection(userId: string, targetUserId: string): Promise<boolean> {
  const records = await this.database.listFrogSleepEntities({ appId: FROGSLEEP_APP_ID, kind: "focus_user_block", limit: 500 });
  return records.some((item) => item.status === "active" && ((item.ownerUserId === userId && item.partnerUserId === targetUserId) || (item.ownerUserId === targetUserId && item.partnerUserId === userId)));
}
```

Call this guard before match search result assembly, invite create/accept, message send/list, presence, comparison, and shared moments. A new active block revokes the pair's `focus_relationship`; unblock sets `status: "inactive"`. Accept only report reasons `harassment`, `impersonation`, `sexual_content`, `hate_or_abuse`, and `other`.

- [ ] **Step 4: Add canonical routes and verify**

```ts
if (routeRequest.method === "PUT" && routeRequest.path === `/v1/focus/buddy/users/${userId}/block`) {
  return frogSleepOk(this, await focusBuddyService(this).setUserBlocked(auth.userId, userId, true), routeRequest.requestId as string);
}
```

Run: `npm test -- test/unit/frogsleep-focus-buddy.api.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the slice**

```bash
git add src/shared/types/records.ts src/modules/frogsleep/focus-buddy src/app/frogsleep-v1-routes.ts test/unit/frogsleep-focus-buddy.api.test.ts
git commit -m "feat(frogsleep): add buddy report and block controls"
```

### Task 2: Moderate profile text and add operations review in Zook

**Files:**
- Modify: `src/app/backend-route-context.ts`
- Modify: `src/app/backend-application.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy.service.ts`
- Modify: `src/modules/frogsleep/focus-buddy/focus-buddy-message-validation.ts`
- Modify: `src/app/admin-security-routes.ts`
- Modify: `src/app/admin-routes.ts`
- Test: `test/unit/frogsleep-focus-buddy.api.test.ts`

**Interfaces:**
- Pass `ContentSafetyService` to `FrogSleepFocusBuddyService`.
- Add `listReports()` and `setReportStatus(reportId, status, reviewerId)`.
- Add operator-only report list/status endpoints with audit records.

- [ ] **Step 1: Add a failing profile-moderation test**

```ts
test("unsafe profile text is rejected before persistence", async () => {
  const runtime = await createApplication({ contentSafetyKeywordRules: [{ id: "abuse", term: "forbidden", category: "abuse", enabled: true }] });
  const session = await loginFrogSleepUser(runtime, "alice");
  const response = await runtime.app.handle({ method: "POST", path: "/api/v1/frogsleep/focus-buddy/match-profile", headers: frogSleepHeaders(session.accessToken), body: { display_name: "Alice", bio: "forbidden text", scene_tags: ["study"], matching_consent: true } });
  assert.equal(response.statusCode, 422);
  assert.equal(runtime.database.frogSleepEntities.some((item) => item.kind === "focus_profile"), false);
});
```

- [ ] **Step 2: Run the focused test before implementation**

Run: `npm test -- test/unit/frogsleep-focus-buddy.api.test.ts`

Expected: FAIL because unsafe text is persisted.

- [ ] **Step 3: Reuse ContentSafetyService and remove arbitrary message text**

```ts
await this.contentSafetyService.assertUserInputAllowed({ appId: FROGSLEEP_APP_ID, userId, taskType: "frogsleep_focus_profile", text: displayName });
if (bio) await this.contentSafetyService.assertUserInputAllowed({ appId: FROGSLEEP_APP_ID, userId, taskType: "frogsleep_focus_profile", text: bio });
```

Add the service dependency through `BackendRouteContext` and `BackendApplication`. In `validateFocusMessagePayload`, reject every defined `custom_text` and require a non-empty `template_key`.

- [ ] **Step 4: Implement report disposition**

Report statuses are `open`, `reviewing`, `resolved`, and `dismissed`. The admin transition writes `reviewed_by`, `review_note`, and `reviewed_at` into the entity payload and records `frogsleep.user_report.update` through the existing audit interceptor.

- [ ] **Step 5: Run regression tests and commit**

Run: `npm test`

Expected: PASS.

```bash
git add src/app src/modules/frogsleep/focus-buddy test/unit
git commit -m "feat(frogsleep): moderate profiles and review reports"
```

### Task 3: Publish Zook's account-safety contract

**Files:**
- Modify: `README_API.md`
- Modify: `docs/current-backend-implementation-overview.md`
- Modify: `src/generated/openapi/public-contracts.generated.ts`

- [ ] **Step 1: Document request and response shapes**

Add the account deletion boundary and these examples:

```json
{ "reason": "harassment" }
```

```json
{ "target_user_id": "user_x", "status": "active" }
```

- [ ] **Step 2: Generate contracts and verify**

Run: `npm run generate:public-contracts && npm test && npm run check:line-count`

Expected: every command exits `0`.

- [ ] **Step 3: Commit the documentation slice**

```bash
git add README_API.md docs/current-backend-implementation-overview.md src/generated/openapi/public-contracts.generated.ts
git commit -m "docs(frogsleep): publish account safety contract"
```

### Task 4: Wire existing app-scoped deletion into iOS

**Files:**
- Modify: `FrogSleep/Core/Services/SharedGuardianshipAPIClient.swift`
- Modify: `FrogSleep/App/AppEnvironment.swift`
- Modify: `FrogSleep/Features/SharedGuardianship/SharedGuardianshipAccountSectionView.swift`
- Modify: `FrogSleepTests/SharedGuardianshipAPIClientContractTests.swift`

**Interfaces:**
- Add `deleteAccount() async throws` to `SharedGuardianshipAPIClient`.
- Add `deleteSharedGuardianshipAccount() async -> Bool` to `AppEnvironment`.

- [ ] **Step 1: Add failing iOS contract tests**

```swift
func testDeleteAccountUsesFrogSleepScopedEndpoint() async throws {
    let request = try await recorder.recordDeleteAccountRequest()
    XCTAssertEqual(request.httpMethod, "DELETE")
    XCTAssertEqual(request.url?.path, "/api/v1/frogsleep/me/account")
}
```

- [ ] **Step 2: Run the test before implementation**

Run: `xcodebuild test -project FrogSleep.xcodeproj -scheme FrogSleepTests -destination 'platform=iOS Simulator,name=iPhone 17 Pro Review' -only-testing:FrogSleepTests/SharedGuardianshipAPIClientContractTests`

Expected: FAIL because the delete method does not exist.

- [ ] **Step 3: Implement server-confirmed cleanup and confirmation UI**

```swift
func deleteAccount() async throws {
    let _: EmptyResponse = try await send(path: "/api/v1/frogsleep/me/account", method: "DELETE", requiresAuth: true)
    await sessionStore.save(nil)
}
```

Only after this succeeds, call `clearLocalSharedGuardianshipAccount(state: .loggedOut, messageKey: "settings.account.message.account_deleted")`. Add a destructive confirmation alert and leave all local state intact after an error.

- [ ] **Step 4: Verify and commit**

Run: `xcodebuild build -project FrogSleep.xcodeproj -scheme FrogSleep -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`

Expected: PASS.

### Task 5: Add report/block actions to iOS matching

**Files:**
- Modify: `FrogSleep/Core/Services/FocusAPIClient.swift`
- Modify: `FrogSleep/Core/Services/BuddyMatchService.swift`
- Modify: `FrogSleep/Features/BuddyInteraction/BuddyMatchResultView.swift`
- Modify: `FrogSleep/Resources/Localizable.xcstrings`
- Modify: `FrogSleepTests/BuddyMatchServiceTests.swift`
- Modify: `FrogSleepUITests/LocalBackendUITests.swift`

**Interfaces:**
- Add `reportMatchCandidate(userId:reason:)` and `blockMatchCandidate(userId:)` to `FocusMatchmakingAPIClient`.
- Add `reportMatch(_:reason:)` and `blockMatch(_:)` to `BuddyMatchService`.

- [ ] **Step 1: Write failing service tests**

```swift
func testBlockRemovesCandidateOnlyAfterServerAcknowledgement() async {
    let service = makeBuddyMatchService(results: [candidate])
    await service.blockMatch(candidate)
    XCTAssertFalse(service.matchResults.contains(where: { $0.id == candidate.id }))
}
```

- [ ] **Step 2: Implement protocol calls and UI actions**

```swift
func blockMatchCandidate(userId: String) async throws {
    let session = try await requiredAuthSession()
    try await sendWithoutResponse(path: "/api/v1/frogsleep/focus-buddy/users/\(userId)/block", method: "PUT", authSession: session)
}
```

Add a destructive match-card menu with report reason selection and a block confirmation dialog. On acknowledged report or block, remove that candidate from the visible results. Add localized result and error copy.

- [ ] **Step 3: Verify and commit**

Run: `xcodebuild build -project FrogSleep.xcodeproj -scheme FrogSleep -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO`

Expected: PASS.

### Task 6: Cross-repository acceptance evidence

**Files:**
- Modify: `QA/APP_FLOW_TEST_MATRIX.md`
- Modify: `QA/PHASE2_DEVICE_SMOKE.md`

- [ ] **Step 1: Add account deletion, profile rejection, report, block, and unblock cases**

Add these cases to both matrices: delete success clears local state; delete failure preserves state; unsafe profile is not published; report reaches operations; block prevents every buddy interaction; unblock permits a new relationship.

- [ ] **Step 2: Run the release gate**

```bash
git -C /Users/hao/Documents/project/Zook status --short
cd /Users/hao/Documents/project/Zook && npm test && npm run check:line-count
cd /Users/hao/Documents/project/sleep/iOS项目 && xcodebuild build -project FrogSleep.xcodeproj -scheme FrogSleep -configuration Release -destination 'generic/platform=iOS' CODE_SIGNING_ALLOWED=NO
```

Expected: test and build commands exit `0`; each repository contains only task-related staged changes before its own commit.
