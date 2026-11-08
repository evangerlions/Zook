import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { KnowledgeService } from "../../src/modules/lighttick/knowledge/knowledge.service.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-knowledge" },
  id = "knowledge-synthetic";
const body = {
  base_revision: 0,
  kind: "knowledge",
  title: "Confirmed note",
  body: "Local knowledge body",
  tags: ["reasoning"],
  sources: [],
};
test("knowledge CAS, immutable history, owner isolation and exact original receipt survive conflict", async () => {
  const r = new InMemoryLightTickRepository(),
    s = new KnowledgeService(r);
  const first = await s.mutate(o, id, "save", body, "knowledge-original");
  assert.deepEqual(
    await s.mutate(o, id, "save", body, "knowledge-original"),
    first,
  );
  await assert.rejects(
    s.mutate(
      o,
      id,
      "save",
      { ...body, body: "Different" },
      "knowledge-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(s.mutate(o, id, "save", body, "knowledge-stale"), {
    statusCode: 409,
  });
  await assert.rejects(s.read({ ...o, userId: "other-owner" }, id), {
    statusCode: 404,
  });
  const second = await s.mutate(
    o,
    id,
    "save",
    {
      ...body,
      base_revision: 1,
      kind: "cognition",
      body: "Revised interpretation",
    },
    "knowledge-second",
  );
  assert.equal(second.revision, 2);
  assert.deepEqual(
    (await s.history(o, id)).items.map((e) => e.body),
    ["Revised interpretation", "Local knowledge body"],
  );
  await s.mutate(o, id, "archive", { base_revision: 2 }, "knowledge-archive");
  assert.equal((await s.read(o, id)).archived, true);
  await s.mutate(o, id, "restore", { base_revision: 3 }, "knowledge-restore");
  assert.equal((await s.read(o, id)).archived, false);
});
test("knowledge command rolls back both body/history on receipt failure, deletion removes all versions", async () => {
  const r = new InMemoryLightTickRepository(),
    s = new KnowledgeService(r),
    original = r.saveOperation.bind(r);
  r.saveOperation = async () => {
    throw Error("Simulated crash");
  };
  await assert.rejects(s.mutate(o, id, "save", body, "knowledge-crash"));
  assert.equal(await r.knowledge.get(o, id), undefined);
  assert.equal((await r.knowledge.history(o, id, 99, 10)).length, 0);
  r.saveOperation = original;
  await s.mutate(o, id, "save", body, "knowledge-crash");
  await r.deleteOwnerData(o);
  assert.equal(await r.knowledge.get(o, id), undefined);
  assert.equal((await r.knowledge.history(o, id, 99, 10)).length, 0);
});
