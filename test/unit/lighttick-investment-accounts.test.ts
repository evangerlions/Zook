import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
const owner = { appId: "lighttick" as const, userId: "synthetic-investor" },
  accountId = "inv-account-fixture";
const symbol = {
  code: "600000.SH",
  market: "SSE",
  kind: "stock",
  name: "Synthetic symbol",
};
test("instrument natural identity and account baselines preserve decimal strings, null costs, receipts and owner CAS", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new InvestmentService(repo);
  const first = await s.createInstrument(owner, symbol, "instrument-original");
  assert.equal(first.instrument.code, "600000");
  assert.deepEqual(
    await s.createInstrument(owner, symbol, "instrument-original"),
    first,
  );
  assert.equal(
    (
      await s.createInstrument(
        owner,
        { ...symbol, code: "600000" },
        "instrument-repeat",
      )
    ).instrument.id,
    first.instrument.id,
  );
  await assert.rejects(
    s.createInstrument(
      owner,
      { ...symbol, kind: "etf" },
      "instrument-wrong-kind",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.createInstrument(
      owner,
      { ...symbol, market: "SZSE" },
      "instrument-wrong-market",
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    s.createInstrument(
      owner,
      { ...symbol, code: "ß" },
      "instrument-unicode-alias",
    ),
    { statusCode: 422 },
  );
  const b = {
    base_revision: 0,
    name: "Synthetic account",
    currency: "CNY",
    baseline_date: "2026-11-04",
    opening_cash: "0.1000000000",
    opening_positions: [
      {
        instrument_id: first.instrument.id,
        quantity: "2.0000000001",
        cost: null,
      },
    ],
  };
  const account = await s.createAccount(
    owner,
    accountId,
    b,
    "account-original",
  );
  assert.equal(account.opening_cash, "0.1");
  assert.equal(account.opening_positions[0].cost, null);
  assert.equal(account.opening_positions[0].quantity, "2.0000000001");
  await assert.rejects(
    s.createAccount(
      { ...owner, userId: "another-owner" },
      accountId,
      b,
      "account-foreign-reference",
    ),
    { statusCode: 404 },
  );
  await assert.rejects(
    s.createAccount(
      owner,
      accountId,
      { ...b, opening_cash: "0.2" },
      "account-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(
    s.createAccount(
      owner,
      accountId,
      { ...b, opening_cash: 0.1 },
      "account-float",
    ),
    { statusCode: 422 },
  );
  await assert.rejects(
    s.createAccount(
      owner,
      accountId,
      {
        ...b,
        opening_positions: [b.opening_positions[0], b.opening_positions[0]],
      },
      "account-duplicate-opening",
    ),
    { statusCode: 422 },
  );
  const archived = await s.archiveAccount(
    owner,
    accountId,
    { base_revision: 1, archived: true },
    "account-archive",
  );
  assert.equal(archived.revision, 2);
  assert.equal(archived.archived, true);
  assert.deepEqual(
    await s.createAccount(owner, accountId, b, "account-original"),
    account,
    "accepted receipt retains its original version",
  );
  await assert.rejects(
    s.archiveAccount(
      owner,
      accountId,
      { base_revision: 1, archived: false },
      "account-stale-restore",
    ),
    { statusCode: 409 },
  );
  await s.archiveAccount(
    owner,
    accountId,
    { base_revision: 2, archived: false },
    "account-restore",
  );
  assert.equal((await s.read(owner, "accounts", accountId)).revision, 3);
});
test("investment catalog cursor is owner/version bound and receipt crash rolls back financial baseline", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new InvestmentService(repo);
  await s.createInstrument(owner, symbol, "catalog-one");
  await s.createInstrument(
    owner,
    { ...symbol, code: "000001.SZ", market: "SZSE" },
    "catalog-two",
  );
  const page = await s.list(owner, "instruments", "", 1);
  assert.ok(page.next_cursor);
  assert.deepEqual(
    await s.list(owner, "instruments", page.next_cursor!, 1),
    await s.list(owner, "instruments", page.next_cursor!, 1),
  );
  await assert.rejects(
    s.list(
      { ...owner, userId: "another-owner" },
      "instruments",
      page.next_cursor!,
      1,
    ),
    { statusCode: 409 },
  );
  const i = page.items[0];
  await s.updateInstrument(
    owner,
    i.id,
    {
      base_revision: i.revision,
      name: "Changed synthetic name",
      archived: false,
    },
    "catalog-change",
  );
  await assert.rejects(s.list(owner, "instruments", page.next_cursor!, 1), {
    statusCode: 409,
  });
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("Receipt storage crash");
  };
  await assert.rejects(
    s.createAccount(
      owner,
      accountId,
      {
        base_revision: 0,
        name: "Opening",
        currency: "CNY",
        baseline_date: "2026-11-04",
        opening_cash: "1",
        opening_positions: [],
      },
      "account-crash",
    ),
  );
  repo.saveOperation = save;
  assert.equal(await repo.investments.account(owner, accountId), undefined);
  await repo.deleteOwnerData(owner);
  assert.equal((await repo.investments.instruments(owner)).length, 0);
});
