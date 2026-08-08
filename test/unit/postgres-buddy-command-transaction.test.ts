import assert from "node:assert/strict";
import test from "node:test";

import { PostgresBuddyCommandTransaction } from "../../src/infrastructure/database/postgres/postgres-buddy-command-transaction.ts";

interface FakeQueryResult { rows: unknown[] }

function createHarness(options: { missingLock?: boolean } = {}) {
  const events: string[] = [];
  const values: unknown[][] = [];
  let connectCount = 0;
  let releaseCount = 0;
  const client = {
    query: async (sql: string, queryValues: unknown[] = []): Promise<FakeQueryResult> => {
      events.push(sql.trim().split(/\s+/).slice(0, 4).join(" "));
      values.push(queryValues);
      if (sql.includes("FOR UPDATE")) return { rows: options.missingLock ? [] : [{ app_id: queryValues[0] }] };
      return { rows: [] };
    },
    release: () => { releaseCount += 1; events.push("RELEASE"); },
  };
  const transaction = new PostgresBuddyCommandTransaction({
    connect: async () => { connectCount += 1; return client; },
    runWithClient: async (_client, fn) => { events.push("CONTEXT"); return await fn(); },
  });
  return { transaction, events, values, connectCount: () => connectCount, releaseCount: () => releaseCount };
}

test("postgres buddy command transaction ensures then locks normalized unique slots in deterministic order", async () => {
  const harness = createHarness();

  const result = await harness.transaction.run([
    { appId: " frogsleep ", userId: " user_b ", domain: "sleep" },
    { appId: "frogsleep", userId: "user_a", domain: "sleep" },
    { appId: "frogsleep", userId: "user_a", domain: "focus" },
    { appId: "frogsleep", userId: "user_a", domain: "focus" },
  ], () => { harness.events.push("CALLBACK"); return "done"; });

  assert.equal(result, "done");
  assert.deepEqual(harness.events, [
    "BEGIN", "INSERT INTO zook_frogsleep_buddy_domain_slots (app_id,", "INSERT INTO zook_frogsleep_buddy_domain_slots (app_id,",
    "INSERT INTO zook_frogsleep_buddy_domain_slots (app_id,", "SELECT app_id, user_id, domain", "SELECT app_id, user_id, domain",
    "SELECT app_id, user_id, domain", "CONTEXT", "CALLBACK", "COMMIT", "RELEASE",
  ]);
  assert.deepEqual(harness.values.slice(1, 4), [
    ["frogsleep", "user_a", "focus"], ["frogsleep", "user_a", "sleep"], ["frogsleep", "user_b", "sleep"],
  ]);
  assert.equal(harness.events.some((event) => event.includes("advisory")), false);
  assert.equal(harness.connectCount(), 1);
  assert.equal(harness.releaseCount(), 1);
});

test("postgres buddy command transaction validates before connecting", async () => {
  const harness = createHarness();
  let callbackCount = 0;

  for (const keys of [
    [],
    [{ appId: " ", userId: "user_a", domain: "sleep" }],
    [{ appId: "frogsleep", userId: " ", domain: "sleep" }],
    [{ appId: "frogsleep", userId: "user_a", domain: "bundle" }],
  ] as Array<Array<{ appId: string; userId: string; domain: "sleep" | "focus" }>>) {
    await assert.rejects(harness.transaction.run(keys, () => { callbackCount += 1; }), /buddy command transaction slot/i);
  }

  assert.equal(callbackCount, 0);
  assert.equal(harness.connectCount(), 0);
  assert.deepEqual(harness.events, []);
});

test("postgres buddy command transaction rolls back, releases and rethrows callback errors", async () => {
  const harness = createHarness();

  await assert.rejects(
    harness.transaction.run([{ appId: "frogsleep", userId: "user_a", domain: "sleep" }], () => {
      harness.events.push("CALLBACK");
      throw new Error("callback failed");
    }),
    /callback failed/,
  );

  assert.deepEqual(harness.events.slice(-3), ["CALLBACK", "ROLLBACK", "RELEASE"]);
  assert.equal(harness.releaseCount(), 1);
  assert.equal(harness.events.some((event) => event.includes("COMMIT")), false);
});

test("postgres buddy command transaction rejects a missing ensured slot before callback", async () => {
  const harness = createHarness({ missingLock: true });
  let callbackCount = 0;

  await assert.rejects(
    harness.transaction.run([{ appId: "frogsleep", userId: "user_a", domain: "sleep" }], () => { callbackCount += 1; }),
    /not found after ensure and lock/i,
  );

  assert.equal(callbackCount, 0);
  assert.deepEqual(harness.events.slice(-2), ["ROLLBACK", "RELEASE"]);
});

test("nested postgres buddy transactions reuse subset and reject additional keys without reconnecting", async () => {
  const harness = createHarness();
  const sleep = { appId: "frogsleep", userId: "user_a", domain: "sleep" } as const;
  const focus = { appId: "frogsleep", userId: "user_a", domain: "focus" } as const;
  let subsetCallbacks = 0;
  let additionalCallbacks = 0;

  await harness.transaction.run([sleep], async () => {
    await harness.transaction.run([sleep, sleep], () => { subsetCallbacks += 1; });
    await assert.rejects(
      harness.transaction.run([sleep, focus], () => { additionalCallbacks += 1; }),
      /additional buddy command transaction slot/i,
    );
  });

  assert.equal(subsetCallbacks, 1);
  assert.equal(additionalCallbacks, 0);
  assert.equal(harness.connectCount(), 1);
});
