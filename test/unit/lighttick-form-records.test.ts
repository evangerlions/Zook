import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import {
  FormRecordsService,
  emptyFormRecords,
} from "../../src/modules/lighttick/form-records/form-records.service.ts";
const owner = { appId: "lighttick" as const, userId: "synthetic-forms" };
const body = {
  base_revision: 0,
  data: {
    ...emptyFormRecords(),
    modules: [
      { id: "module-synthetic", name: "学习", color: "#4F6EF7", order: 1 },
    ],
  },
};
test("form categories preserve original identity and CAS receipts across owners and concurrent edits", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new FormRecordsService(repo);
  const saved = await service.save(owner, body, "forms-original");
  assert.equal(saved.revision, 1);
  assert.deepEqual(await service.save(owner, body, "forms-original"), saved);
  await assert.rejects(
    service.save(
      owner,
      { ...body, data: emptyFormRecords() },
      "forms-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(service.save(owner, body, "forms-stale"), {
    statusCode: 409,
  });
  assert.equal((await service.read({ ...owner, userId: "other" })).revision, 0);
  const attempts = await Promise.allSettled(
    ["forms-one", "forms-two"].map((key) =>
      service.save(owner, { ...body, base_revision: 1 }, key),
    ),
  );
  assert.equal(attempts.filter((x) => x.status === "fulfilled").length, 1);
  assert.equal((await service.read(owner)).revision, 2);
});
test("form clear is scoped, replay safe, requires current revision, and rolls back with its receipt", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new FormRecordsService(repo);
  await service.save(owner, body, "forms-original");
  const original = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt crash");
  };
  await assert.rejects(
    service.clear(owner, { base_revision: 1 }, "forms-clear"),
  );
  assert.equal((await service.read(owner)).data.modules.length, 1);
  repo.saveOperation = original;
  const result = await service.clear(
    owner,
    { base_revision: 1 },
    "forms-clear",
  );
  assert.deepEqual(result.data, emptyFormRecords());
  assert.deepEqual(
    await service.clear(owner, { base_revision: 1 }, "forms-clear"),
    result,
  );
  await repo.deleteOwnerData(owner);
  assert.equal((await service.read(owner)).revision, 0);
});
test("form input validates module relationships, JSON limits, dates and refuses secret/foreign scopes", async () => {
  const s = new FormRecordsService(new InMemoryLightTickRepository());
  for (const data of [
    { ...body.data, token: "not-allowed" },
    { ...body.data, modules: [...body.data.modules, ...body.data.modules] },
    { ...body.data, checkins: { "2026-02-30": { "module-synthetic": 1 } } },
    { ...body.data, checkins: { "2026-11-08": { other: 1 } } },
    {
      ...body.data,
      modules: [
        { ...body.data.modules[0], color: "url(https://invalid.test)" },
      ],
    },
    { ...body.data, customRecords: [{ text: "x".repeat(100001) }] },
  ])
    await assert.rejects(
      s.save(owner, { base_revision: 0, data }, "forms-invalid"),
      { statusCode: 422 },
    );
});
test("form replay rechecks authorization and cannot return another domain receipt", async () => {
  const repo = new InMemoryLightTickRepository();
  let allowed = true;
  const s = new FormRecordsService(repo, async () => {
    if (!allowed) throw Error("revoked");
  });
  await s.save(owner, body, "forms-original");
  allowed = false;
  await assert.rejects(s.save(owner, body, "forms-original"), /revoked/);
  await assert.rejects(s.read(owner), /revoked/);
});
