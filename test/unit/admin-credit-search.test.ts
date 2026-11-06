import assert from "node:assert/strict";
import test from "node:test";
import { searchCreditUsers, type CreditUserCandidate, type CreditUserSearchField } from "../../src/modules/ai-novel/credits/admin-credit-search.ts";

for (const field of ["uid", "phone", "email"] as const) {
  for (const count of [0, 1, 10, 11]) {
    test(`${field} search handles ${count} matches`, async () => {
      const rows: CreditUserCandidate[] = Array.from({ length: count }, (_, i) => ({ uid: `u${i}`, phone: null, email: null }));
      const store = { async searchUsers(actual: CreditUserSearchField, term: string) {
        assert.equal(actual, field); assert.equal(term, "partial"); return rows;
      }};
      const result = await searchCreditUsers(store, field, " partial ");
      assert.equal(result.tooMany, count > 10);
      assert.equal(result.users.length, count > 10 ? 0 : count);
    });
  }
}
test("search rejects unknown fields and empty values", async () => {
  const store = { async searchUsers() { throw new Error("must not query"); } };
  await assert.rejects(searchCreditUsers(store, "name", "test"));
  await assert.rejects(searchCreditUsers(store, "uid", "  "));
});
