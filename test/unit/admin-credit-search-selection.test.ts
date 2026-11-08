import assert from "node:assert/strict";
import test from "node:test";
import { selectedUserForSearch } from "../../apps/admin-web/app/components/ai-novel-credits/credit-search-selection.ts";

test("selects only an unambiguous search result", () => {
  const user = { uid: "user-1", phone: null, email: null };
  assert.equal(selectedUserForSearch({ users: [user], tooMany: false }), "user-1");
  assert.equal(selectedUserForSearch({ users: [], tooMany: false }), undefined);
  assert.equal(selectedUserForSearch({ users: [user, { ...user, uid: "user-2" }], tooMany: false }), undefined);
  assert.equal(selectedUserForSearch({ users: [user], tooMany: true }), undefined);
});
