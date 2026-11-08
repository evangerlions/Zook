import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
const owner = { appId: "lighttick" as const, userId: "learning-alice" },
  bob = { ...owner, userId: "learning-bob" };
async function setup() {
  const repo = new InMemoryLightTickRepository(),
    service = new NativeLearningService(repo, true);
  await service.saveCollection(
    owner,
    "collection-test",
    { title: "Learn", archived: false, base_revision: 0 },
    "collection-create",
  );
  const body = {
    base_revision: 0,
    collection_id: "collection-test",
    number: 1,
    title: "Lesson",
    content: "Original lesson",
    references: "",
    source_url: "",
  };
  const lesson = await service.publish(
    owner,
    "lesson-native-test",
    body,
    "lesson-publish-one",
  );
  return {
    repo,
    service,
    body,
    lesson,
    v: lesson.content_version,
    id: lesson.id,
  };
}
test("new registered owner learns without a source binding; publication is immutable and private versions remain separate", async () => {
  const { repo, service, body, lesson, v, id } = await setup();
  assert.equal((await service.authority(owner))?.phase, "zook");
  assert.equal(lesson.revision, 1);
  await service.privateCommand(
    owner,
    id,
    {
      content_version: v,
      base_revision: 0,
      action: "save",
      notes: "old note",
      answers: [{ id: "q1", prompt: "What?", answer: "old answer" }],
    },
    "private-note-one",
  );
  const updated = await service.publish(
    owner,
    id,
    { ...body, base_revision: 1, content: "New lesson" },
    "lesson-publish-two",
  );
  assert.notEqual(updated.content_version, v);
  assert.equal((await service.privateState(owner, id, v)).notes, "old note");
  assert.equal(
    (await service.privateState(owner, id, updated.content_version)).notes,
    "",
  );
  assert.equal(
    (await repo.getLessonPublication(owner, id, v))?.content,
    "Original lesson",
  );
  await assert.rejects(service.publication(bob, id, v), { statusCode: 404 });
});
test("position can move backwards and does not change note CAS or explicit completion", async () => {
  const { service, v, id } = await setup();
  await service.privateCommand(
    owner,
    id,
    { content_version: v, base_revision: 0, action: "position", position: 80 },
    "position-forward",
  );
  await service.privateCommand(
    owner,
    id,
    { content_version: v, base_revision: 1, action: "position", position: 20 },
    "position-backward",
  );
  const note = await service.privateCommand(
    owner,
    id,
    {
      content_version: v,
      base_revision: 0,
      action: "save",
      notes: "independent note",
      answers: [],
    },
    "private-note-safe",
  );
  assert.equal(note.position, 20);
  assert.equal(note.completed, false);
  const completed = await service.privateCommand(
    owner,
    id,
    { content_version: v, base_revision: 0, action: "complete" },
    "explicit-complete",
  );
  assert.equal(completed.completed, true);
  assert.equal(completed.notes, "independent note");
  await assert.rejects(
    service.privateCommand(
      owner,
      id,
      {
        content_version: v,
        base_revision: 0,
        action: "save",
        notes: "stale",
        answers: [],
      },
      "private-note-stale",
    ),
    { statusCode: 409 },
  );
  assert.equal(
    (await service.privateState(owner, id, v)).notes,
    "independent note",
  );
});
test("private state, history and receipt roll back together; retry reuses the exact original result", async () => {
  const { repo, service, v, id } = await setup();
  const body = {
    content_version: v,
    base_revision: 0,
    action: "save",
    notes: "durable",
    answers: [],
  };
  const original = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("receipt failure");
  };
  await assert.rejects(
    service.privateCommand(owner, id, body, "private-durable"),
    /receipt failure/,
  );
  assert.equal(await repo.getNativePrivateState(owner, id, v), undefined);
  repo.saveOperation = original;
  const accepted = await service.privateCommand(
    owner,
    id,
    body,
    "private-durable",
  );
  await service.privateCommand(
    owner,
    id,
    { ...body, base_revision: 1, notes: "new revision" },
    "private-next-note",
  );
  assert.deepEqual(
    await service.privateCommand(owner, id, body, "private-durable"),
    accepted,
  );
  await assert.rejects(
    service.privateCommand(
      owner,
      id,
      { ...body, notes: "changed body" },
      "private-durable",
    ),
    { code: "LIGHTTICK_IDEMPOTENCY_MISMATCH" },
  );
});
test("disabled writes preserve reading and accepted replay; authorization runs before cached results", async () => {
  const { repo, service, v, id } = await setup(),
    body = {
      content_version: v,
      base_revision: 0,
      action: "save",
      notes: "saved",
      answers: [],
    };
  const result = await service.privateCommand(
    owner,
    id,
    body,
    "private-disable",
  );
  const disabled = new NativeLearningService(repo, false);
  assert.equal((await disabled.privateState(owner, id, v)).notes, "saved");
  assert.deepEqual(
    await disabled.privateCommand(owner, id, body, "private-disable"),
    result,
  );
  await assert.rejects(
    disabled.privateCommand(
      owner,
      id,
      { ...body, base_revision: 1 },
      "private-new-write",
    ),
    { statusCode: 503 },
  );
  await assert.rejects(
    disabled.privateCommand(owner, id, body, "private-disable", async () => {
      throw Error("revoked");
    }),
    /revoked/,
  );
});
test("legacy private contract receives an applied receipt directly and rejects stale publication input", async () => {
  const { service, v, id, body } = await setup();
  const before = await service.legacyPrivate(owner, id);
  assert.equal(before.state.revision, 1);
  const input = {
    id: "legacy-command-1",
    content_version: v,
    revision: 1,
    action: "save",
    notes: "legacy note",
    answers: [],
    position: 0,
  };
  const saved = await service.legacy(owner, id, input);
  assert.equal(saved?.state.notes, "legacy note");
  assert.deepEqual(saved?.operations, [
    { id: "legacy-command-1", status: "applied", error: "" },
  ]);
  assert.deepEqual(await service.legacy(owner, id, input), saved);
  await service.publish(
    owner,
    id,
    { ...body, base_revision: 1, content: "Updated content" },
    "new-content-version",
  );
  await assert.rejects(
    service.legacy(owner, id, { ...input, id: "legacy-command-2" }),
    { statusCode: 409 },
  );
});
test("existing learning mirrors never auto-activate as native authority and frozen sources cannot write", async () => {
  const repo = new InMemoryLightTickRepository();
  await repo.saveLearningLibrary(owner, {
    binding_id: "old-binding",
    lessons: [],
    consent_enabled: true,
  });
  const service = new NativeLearningService(repo, true),
    a = (await service.authority(owner))!;
  assert.equal(a.phase, "legacy");
  await assert.rejects(service.collections(owner), { statusCode: 409 });
  await repo.saveLearningAuthority(
    { ...a, phase: "frozen", epoch: 1, revision: a.revision + 1 },
    a.revision,
  );
  await assert.rejects(service.assertLegacyWrite(owner), { statusCode: 409 });
});

test('an existing source binding without a learning mirror remains legacy until reviewed migration',async()=>{
 const repo=new InMemoryLightTickRepository();await repo.saveActionLink({...owner,source_account_id:'source-account-original',binding_id:'source-binding-original',phase:'active'});
 const service=new NativeLearningService(repo,true),authority=await service.authority(owner);
 assert.equal(authority?.phase,'legacy');assert.equal(authority?.readingEnabled,false);
 await assert.rejects(service.collections(owner),{statusCode:409});
});
test("catalog cursors are owner/query bound and catalog updates require projection restart without changing drafts", async () => {
  const { service } = await setup();
  await service.saveCollection(
    owner,
    "collection-second",
    { base_revision: 0, title: "Second", archived: false },
    "collection-second-key",
  );
  const first = await service.collections(owner, "", 1);
  assert.ok(first.next_cursor);
  await assert.rejects(service.collections(bob, first.next_cursor!, 1), {
    statusCode: 400,
  });
  await assert.rejects(service.lessons(owner, first.next_cursor!, 1), {
    statusCode: 400,
  });
  const last = await service.collections(owner, first.next_cursor!, 1);
  assert.equal(last.items.length, 1);
  await service.saveCollection(
    owner,
    "collection-third",
    { base_revision: 0, title: "Third", archived: false },
    "collection-third-key",
  );
  await assert.rejects(service.collections(owner, first.next_cursor!, 1), {
    statusCode: 409,
  });
  assert.equal((await service.collections(owner)).items.length, 3);
});
test("withdrawing private consent blocks original receipt replay and restores only after explicit owner opt-in", async () => {
  const { service, v, id } = await setup();
  const body = {
    content_version: v,
    base_revision: 0,
    action: "save",
    notes: "private",
    answers: [],
  };
  await service.privateCommand(owner, id, body, "consent-private-receipt");
  let a = (await service.authority(owner))!;
  await service.consent(
    owner,
    {
      base_revision: a.revision,
      reading_enabled: true,
      private_enabled: false,
    },
    "withdraw-private-only",
  );
  assert.equal((await service.legacyPrivate(owner, id)).enabled, false);
  await assert.rejects(
    service.privateCommand(owner, id, body, "consent-private-receipt"),
    { statusCode: 403 },
  );
  a = (await service.authority(owner))!;
  await service.consent(
    owner,
    { base_revision: a.revision, reading_enabled: true, private_enabled: true },
    "restore-private-only",
  );
  assert.equal((await service.privateState(owner, id, v)).notes, "private");
});
