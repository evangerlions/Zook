import assert from "node:assert/strict";
import test from "node:test";

import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

type SlotKey = { appId: string; userId: string; domain: "sleep" | "focus" };

const runTransaction = async <T>(
  database: InMemoryDatabase,
  keys: SlotKey[],
  callback: () => Promise<T> | T,
): Promise<T> => await (database as unknown as {
  withFrogSleepBuddyCommandTransaction: <Result>(
    slotKeys: SlotKey[],
    fn: () => Promise<Result> | Result,
  ) => Promise<Result>;
}).withFrogSleepBuddyCommandTransaction(keys, callback);

test("in-memory buddy command transaction normalizes, orders and deduplicates slots before callback", async () => {
  const database = new InMemoryDatabase();

  const observed = await runTransaction(database, [
    { appId: " frogsleep ", userId: " user_b ", domain: "sleep" },
    { appId: "frogsleep", userId: "user_a", domain: "sleep" },
    { appId: "frogsleep", userId: "user_a", domain: "focus" },
    { appId: "frogsleep", userId: "user_a", domain: "focus" },
  ], () => database.frogSleepBuddyDomainSlots.map(({ appId, userId, domain }) => ({ appId, userId, domain })));

  assert.deepEqual(observed, [
    { appId: "frogsleep", userId: "user_a", domain: "focus" },
    { appId: "frogsleep", userId: "user_a", domain: "sleep" },
    { appId: "frogsleep", userId: "user_b", domain: "sleep" },
  ]);
});

test("in-memory buddy command transaction rejects invalid keys before callback", async () => {
  const database = new InMemoryDatabase();
  let callbackCount = 0;

  for (const keys of [
    [],
    [{ appId: " ", userId: "user_a", domain: "sleep" }],
    [{ appId: "frogsleep", userId: " ", domain: "sleep" }],
    [{ appId: "frogsleep", userId: "user_a", domain: "bundle" }],
  ] as SlotKey[][]) {
    await assert.rejects(
      runTransaction(database, keys, () => { callbackCount += 1; }),
      /buddy command transaction slot/i,
    );
  }

  assert.equal(callbackCount, 0);
  assert.deepEqual(database.frogSleepBuddyDomainSlots, []);
});

test("in-memory buddy command transaction rethrows and rolls back callback changes", async () => {
  const database = new InMemoryDatabase();

  await assert.rejects(
    runTransaction(database, [{ appId: "frogsleep", userId: "user_a", domain: "sleep" }], async () => {
      await database.compareAndUpdateFrogSleepBuddyDomainSlot({
        appId: "frogsleep", userId: "user_a", domain: "sleep", expectedVersion: 1,
        state: "occupied", relationshipId: "relationship_1", updatedAt: "2026-07-15T00:00:00.000Z",
      });
      throw new Error("callback failed");
    }),
    /callback failed/,
  );

  assert.deepEqual(database.frogSleepBuddyDomainSlots, []);
});

test("nested buddy command transactions reuse subsets and reject additional keys", async () => {
  const database = new InMemoryDatabase();
  const sleep = { appId: "frogsleep", userId: "user_a", domain: "sleep" } as const;
  const focus = { appId: "frogsleep", userId: "user_a", domain: "focus" } as const;
  let subsetCallbacks = 0;
  let additionalCallbacks = 0;

  await runTransaction(database, [sleep], async () => {
    await runTransaction(database, [sleep, sleep], () => { subsetCallbacks += 1; });
    await assert.rejects(
      runTransaction(database, [sleep, focus], () => { additionalCallbacks += 1; }),
      /additional buddy command transaction slot/i,
    );
  });

  assert.equal(subsetCallbacks, 1);
  assert.equal(additionalCallbacks, 0);
});

test("a queued in-memory rollback preserves an earlier committed transaction", async () => {
  const database = new InMemoryDatabase();
  let finishFirst = () => undefined;
  const firstCanFinish = new Promise<void>((resolve) => { finishFirst = resolve; });
  let firstStarted = () => undefined;
  const firstDidStart = new Promise<void>((resolve) => { firstStarted = resolve; });

  const first = runTransaction(database, [
    { appId: "frogsleep", userId: "user_a", domain: "sleep" },
  ], async () => {
    firstStarted();
    await firstCanFinish;
    database.compareAndUpdateFrogSleepBuddyDomainSlot({
      appId: "frogsleep", userId: "user_a", domain: "sleep", expectedVersion: 1,
      state: "occupied", relationshipId: "relationship_1", updatedAt: "2026-07-15T00:00:00.000Z",
    });
  });
  await firstDidStart;
  const second = runTransaction(database, [
    { appId: "frogsleep", userId: "user_b", domain: "focus" },
  ], () => { throw new Error("second failed"); });
  finishFirst();

  await first;
  await assert.rejects(second, /second failed/);
  assert.deepEqual(database.frogSleepBuddyDomainSlots.map(({ userId, domain, state }) => ({ userId, domain, state })), [
    { userId: "user_a", domain: "sleep", state: "occupied" },
  ]);
});
