import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningMigrationService } from "../../src/modules/lighttick/learning/learning-migration.service.ts";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
import { digest } from "../../src/modules/lighttick/learning/native-learning.validation.ts";
const owner = { appId: "lighttick" as const, userId: "migration-alice" };
test("source completion without private consent remains anchored to its original publication across republishing", async () => {
  const f = await setup(),
    bundle = structuredClone(f.bundle);
  bundle.consent.private = false;
  bundle.private_states = [];
  bundle.private_history = [];
  bundle.receipts = [];
  bundle.lessons[0].learning_state = "completed";
  f.bundle = bundle;
  f.digest = digest(bundle);
  await f.repo.saveLearningPrivate(owner, {
    binding_id: "synthetic-binding",
    source_revision: 7,
    enabled: false,
    lessons: [],
    requests: [],
  });
  for (const action of ["freeze", "import", "verify", "activate"] as const)
    await step(f, action);
  const original = await f.native.publication(owner, f.lesson),
    body = {
      base_revision: 1,
      collection_id: original.lesson.collectionId,
      number: original.lesson.number,
      title: original.lesson.title,
      content: original.publication.content,
      references: original.publication.references,
      source_url: original.publication.sourceUrl,
    };
  await f.native.publish(owner, f.lesson, body, "same-source-body-new-title");
  assert.equal(
    (await f.native.legacy(owner, f.lesson))?.lesson.learning_state,
    "completed",
  );
  await f.native.publish(
    owner,
    f.lesson,
    { ...body, base_revision: 2, content: "New curriculum body" },
    "new-source-body-version",
  );
  assert.equal(
    (await f.native.legacy(owner, f.lesson))?.lesson.learning_state,
    "unknown",
  );
  assert.equal(
    (await f.repo.getNativeLesson(owner, f.lesson))?.sourceCompletedVersion,
    f.current,
  );
  assert.equal(
    (await f.native.publication(owner, f.lesson, f.current)).publication
      .content,
    body.content,
  );
  assert.equal((await f.native.legacyPrivate(owner, f.lesson)).enabled, false);
});
async function setup() {
  const repo = new InMemoryLightTickRepository();
  await repo.saveLearningLibrary(owner, {
    binding_id: "synthetic-binding",
    source_revision: 9,
    consent_enabled: true,
    lessons: [],
  });
  await repo.saveLearningPrivate(owner, {
    binding_id: "synthetic-binding",
    source_revision: 7,
    enabled: true,
    lessons: [],
    requests: [],
  });
  await repo.saveActionLink({
    ...owner,
    source_account_id: "legacy-source-alice",
    binding_id: "synthetic-binding",
    phase: "active",
  });
  const native = new NativeLearningService(repo, true),
    migration = new LearningMigrationService(native),
    f = learningMigrationFixture(owner.userId);
  return { repo, native, migration, ...f };
}
async function step(
  f: Awaited<ReturnType<typeof setup>>,
  action: "freeze" | "import" | "verify" | "activate" | "abort",
  prefix = "round-one",
) {
  const a = await f.repo.getLearningAuthority(owner);
  return f.migration.command(
    owner,
    action,
    f.bundle,
    f.digest,
    a?.revision ?? 0,
    prefix + "-" + action,
  );
}
test("sealed migration preserves IDs, old content/draft anchors and terminal receipts; pending requests resolve once before activation", async () => {
  const f = await setup();
  const preview = await f.migration.preflight(owner, f.bundle, f.digest);
  assert.equal(await f.repo.getLearningAuthority(owner), undefined);
  assert.deepEqual(
    preview.pending_resolutions.map((r) => r.status),
    ["applied", "conflict"],
  );
  await step(f, "freeze");
  await assert.rejects(f.native.assertLegacyWrite(owner), { statusCode: 409 });
  await assert.rejects(f.native.privateState(owner, f.lesson, f.current), {
    statusCode: 409,
  });
  await step(f, "import");
  await step(f, "verify");
  const active = await step(f, "activate");
  assert.equal(active.phase, "zook");
  assert.equal(active.epoch, 2);
  const state = await f.native.privateState(owner, f.lesson, f.current);
  assert.equal(state.notes, "Queued phone note");
  assert.equal(state.completed, false);
  assert.equal(state.draftVersion, f.draft);
  assert.equal(
    (await f.native.privateState(owner, f.lesson, f.old)).completedAt,
    null,
  );
  const { lesson_id, ...appliedBody } = f.applied;
  const replay = await f.native.legacy(owner, f.lesson, appliedBody);
  assert.equal(
    replay?.operations.find((r: any) => r.id === f.applied.id)?.status,
    "applied",
  );
  assert.equal(
    (await f.native.privateState(owner, f.lesson, f.current)).revision,
    5,
  );
  assert.equal(
    (await f.native.legacyPrivate(owner, f.lesson)).operations.find(
      (r) => r.id === f.conflicted.id,
    )?.status,
    "conflict",
  );
  await assert.rejects(step(f, "abort"), { statusCode: 409 });
  const write = await f.native.privateCommand(
    owner,
    f.lesson,
    {
      content_version: f.current,
      action: "save",
      base_revision: 5,
      notes: "Native follow-up",
      answers: [],
    },
    "native-after-migration",
  );
  assert.equal(write.draft_version, f.draft);
  await assert.rejects(f.native.assertLegacyWrite(owner), { statusCode: 409 });
});
test("identity, digest, source watermark and unresolved bodies fail preflight without changing authority", async () => {
  const f = await setup();
  await assert.rejects(
    f.migration.preflight(
      { ...owner, userId: "other-target" },
      f.bundle,
      f.digest,
    ),
    { statusCode: 403 },
  );
  await assert.rejects(
    f.migration.preflight(owner, { ...f.bundle, module: "other" }, f.digest),
    { statusCode: 422 },
  );
  const changed = structuredClone(f.bundle);
  changed.source.library_revision++;
  await assert.rejects(f.migration.preflight(owner, changed, digest(changed)), {
    statusCode: 409,
  });
  const missing = structuredClone(f.bundle);
  delete (missing.receipts[1] as any).body;
  await assert.rejects(f.migration.preflight(owner, missing, digest(missing)), {
    statusCode: 409,
  });
  assert.equal(await f.repo.getLearningAuthority(owner), undefined);
});
test("verification detects changed private history; abort before activation restores legacy routing without touching legacy mirrors", async () => {
  const f = await setup();
  await step(f, "freeze");
  await step(f, "import");
  const state = (await f.repo.getNativePrivateState(
    owner,
    f.lesson,
    f.current,
  ))!;
  await f.repo.saveNativePrivateState(
    { ...state, notes: "tampered", revision: state.revision + 1 },
    state.revision,
  );
  await assert.rejects(step(f, "verify"), { statusCode: 409 });
  assert.equal((await f.repo.getLearningAuthority(owner))?.phase, "imported");
  await step(f, "abort");
  assert.equal((await f.repo.getLearningAuthority(owner))?.phase, "legacy");
  assert.equal((await f.repo.getLearningLibrary(owner))?.source_revision, 9);
  assert.deepEqual(
    Object.values(await f.repo.getNativeLearningCounts(owner)),
    [0, 0, 0, 0, 0, 0, 0, 0, 0],
  );
  await f.native.assertLegacyWrite(owner);
  await step(f, "freeze", "round-two");
  assert.equal((await f.repo.getLearningAuthority(owner))?.epoch, 3);
});
test("a receipt persistence failure rolls back imported objects and phase; original import can retry", async () => {
  const f = await setup();
  await step(f, "freeze");
  const original = f.repo.saveOperation.bind(f.repo);
  f.repo.saveOperation = async (row) => {
    if (row.deviceId === "learning-migration") throw Error("receipt injection");
    return original(row);
  };
  await assert.rejects(step(f, "import"), /receipt injection/);
  assert.equal((await f.repo.getLearningAuthority(owner))?.phase, "frozen");
  assert.equal((await f.repo.getNativeLearningCounts(owner)).lessons, 0);
  f.repo.saveOperation = original;
  await step(f, "import");
  assert.equal((await f.repo.getNativeLearningCounts(owner)).lessons, 1);
});
test("private consent is not broadened by reading migration, and unauthorized private payload is rejected", async () => {
  const f = await setup();
  const b = structuredClone(f.bundle);
  b.consent.private = false;
  b.private_states = [];
  b.private_history = [];
  b.receipts = [];
  await f.repo.saveLearningPrivate(owner, {
    binding_id: "synthetic-binding",
    source_revision: 7,
    enabled: false,
    lessons: [],
    requests: [],
  });
  f.bundle = b;
  f.digest = digest(b);
  for (const action of ["freeze", "import", "verify", "activate"] as const)
    await step(f, action);
  assert.equal((await f.native.legacyPrivate(owner, f.lesson)).enabled, false);
  await assert.rejects(f.native.privateState(owner, f.lesson, f.current), {
    statusCode: 403,
  });
  const a = (await f.repo.getLearningAuthority(owner))!;
  await f.native.consent(
    owner,
    { base_revision: a.revision, reading_enabled: true, private_enabled: true },
    "explicit-private-consent",
  );
  assert.equal(
    (await f.native.privateState(owner, f.lesson, f.current)).notes,
    "",
  );
});
