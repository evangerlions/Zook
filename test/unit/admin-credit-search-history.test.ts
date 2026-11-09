import assert from "node:assert/strict";
import test from "node:test";
import { addSearchHistory, loadSearchHistory, saveSearchHistory } from "../../apps/admin-web/app/components/ai-novel-credits/credit-search-history.ts";

test("history keeps ten newest unique searches across fields", () => {
  let history = addSearchHistory([], "uid", "  Alice  ");
  history = addSearchHistory(history, "email", "alice@example.invalid");
  history = addSearchHistory(history, "uid", "ALICE");
  assert.deepEqual(history, [{ field: "uid", query: "ALICE" }, { field: "email", query: "alice@example.invalid" }]);
  assert.deepEqual(addSearchHistory(history, "phone", "  "), history);
  for (let i = 0; i < 12; i++) history = addSearchHistory(history, "phone", `phone-${i}`);
  assert.equal(history.length, 10);
  assert.equal(history[0].query, "phone-11");
  assert.equal(history[9].query, "phone-2");
});

test("stored history is scoped to the administrator and tolerates blocked storage", () => {
  const data = new Map<string, string>();
  const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
  const history = [{ field: "uid" as const, query: "user_1" }];
  saveSearchHistory(storage, "admin-a", history);
  assert.deepEqual(loadSearchHistory(storage, "admin-a"), history);
  assert.deepEqual(loadSearchHistory(storage, "admin-b"), []);
  assert.deepEqual(loadSearchHistory({ getItem: () => { throw Error("blocked"); } }, "admin-a"), []);
  assert.doesNotThrow(() => saveSearchHistory({ setItem: () => { throw Error("blocked"); } }, "admin-a", history));
});
