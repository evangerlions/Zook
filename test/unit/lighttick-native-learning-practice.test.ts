import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { LearningMigrationService } from "../../src/modules/lighttick/learning/learning-migration.service.ts";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
import Ajv2020 from "ajv/dist/2020.js";
import { LightTickPracticeSourceDataSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { receiveLearningProgress } from "../../src/modules/lighttick/actions/action-learning-progress.ts";
const owner = { appId: "lighttick" as const, userId: "native-practice-alice" };
test("native lessons create reviewed practice without a legacy binding; source versions and completion facts stay independent", async () => {
  const repo = new InMemoryLightTickRepository(),
    learning = new NativeLearningService(repo, true),
    actions = new ActionService(
      repo,
      () => new Date("2026-11-03T12:00:00Z"),
      undefined,
      true,
    );
  await learning.saveCollection(
    owner,
    "course-native-practice",
    { base_revision: 0, title: "Native course", archived: false },
    "native-course-practice",
  );
  const body = {
    base_revision: 0,
    collection_id: "course-native-practice",
    number: 1,
    title: "Original source title",
    content: "Original source body",
    references: "",
  };
  const lesson = await learning.publish(
    owner,
    "lesson-native-practice",
    body,
    "native-publish-practice",
  );
  await learning.privateCommand(
    owner,
    lesson.id,
    {
      content_version: lesson.content_version,
      base_revision: 0,
      action: "complete",
    },
    "native-course-finished",
  );
  assert.equal((await actions.readWorkspace(owner)).data.plans.length, 0);
  const command = {
    key: "native-create-practice",
    title: "Review before applying",
    source_kind: "lesson",
    source_id: lesson.id,
    source_version: lesson.content_version,
    date: null,
  };
  const result = (await actions.request(
    owner,
    "POST",
    "/practices",
    command,
  )) as any;
  assert.equal(result.plan.status, "active");
  assert.equal((await actions.readWorkspace(owner)).data.records.length, 0);
  assert.equal(result.plan.practice_source.binding_id, "native-learning");
  const newer = await learning.publish(
    owner,
    lesson.id,
    { ...body, base_revision: 1, content: "Newer source body" },
    "native-source-newer",
  );
  const source = (await actions.request(
    owner,
    "GET",
    "/practices/" + result.plan.id + "/source",
  )) as any;
  assert.equal(source.text, "Original source body");
  assert.equal(source.source_version, lesson.content_version);
  assert.equal(source.current_version, newer.content_version);
  const validate = new Ajv2020({ strict: false }).compile(
    LightTickPracticeSourceDataSchema,
  );
  assert.equal(validate(source), true, JSON.stringify(validate.errors));
  await assert.rejects(
    actions.request(owner, "POST", "/practices", {
      ...command,
      key: "native-stale-source",
    }),
    { statusCode: 409 },
  );
  const feedback = (await actions.request(
    owner,
    "POST",
    "/" + result.plan.id + "/operations",
    {
      key: "native-practice-feedback",
      revision: result.plan.revision,
      action: "practice-feedback",
      feedback: {
        outcome: "unknown",
        result: "One attempt",
        evidence: "Synthetic evidence",
        next_step: "Review a second attempt",
      },
    },
  )) as any;
  assert.equal(feedback.plan.practice_feedback.length, 1);
  assert.equal((await actions.readWorkspace(owner)).data.plans.length, 1);
  assert.equal((await actions.readWorkspace(owner)).data.records.length, 0);
  assert.equal(
    (await learning.privateState(owner, lesson.id, newer.content_version))
      .completed,
    false,
  );
  const authority = (await learning.authority(owner))!;
  await learning.consent(
    owner,
    {
      base_revision: authority.revision,
      reading_enabled: false,
      private_enabled: false,
    },
    "native-practice-revoke",
  );
  assert.equal(
    (
      (await actions.request(
        owner,
        "GET",
        "/practices/" + result.plan.id + "/source",
      )) as any
    ).available,
    false,
  );
  assert.deepEqual(
    await actions.request(owner, "POST", "/practices", command),
    result,
  );
  assert.equal(
    (await actions.readWorkspace(owner)).data.plans[0].practice_feedback?.[0]
      .evidence,
    "Synthetic evidence",
  );
  await assert.rejects(
    actions.request(
      { ...owner, userId: "native-practice-bob" },
      "POST",
      "/practices",
      command,
    ),
    { statusCode: 409 },
  );
});

test("legacy practice source binding and exact publication survive reviewed migration; frozen authority never falls back to an old mirror", async () => {
  const repo = new InMemoryLightTickRepository(),
    native = new NativeLearningService(repo, true),
    migration = new LearningMigrationService(native),
    actions = new ActionService(
      repo,
      () => new Date("2026-11-03T12:00:00Z"),
      undefined,
      true,
    ),
    f = learningMigrationFixture(owner.userId);
  const publication = f.bundle.lessons[0].publications.find(
    (p) => p.content_version === f.current,
  )!;
  await repo.saveActionLink({
    ...owner,
    source_account_id: "legacy-source-alice",
    binding_id: "synthetic-binding",
    phase: "active",
  });
  const link = (await repo.getOwnerActionLink(owner))!;
  const progress = {
    action: "learning-progress",
    action_schema_version: 2,
    binding_id: link.binding_id,
    source_revision: 1,
    observed_at: "2026-11-03T12:00:00Z",
    web_url: "https://synthetic.invalid/grow/",
    plans: [],
  };
  await receiveLearningProgress(actions, link, progress);
  await repo.saveLearningLibrary(owner, {
    binding_id: "synthetic-binding",
    source_revision: 9,
    consent_enabled: true,
    lessons: [
      {
        ...f.bundle.lessons[0],
        ...publication,
        collection_title: "Original course",
      },
    ],
  });
  await repo.saveLearningPrivate(owner, {
    binding_id: "synthetic-binding",
    source_revision: 7,
    enabled: true,
    lessons: [],
    requests: [],
  });
  const { plan } = (await actions.request(owner, "POST", "/practices", {
    key: "legacy-practice-to-migrate",
    title: "Original practice",
    source_kind: "lesson",
    source_id: f.lesson,
    source_version: f.current,
    date: null,
  })) as any;
  for (const action of ["freeze", "import", "verify", "activate"] as const) {
    const a = await repo.getLearningAuthority(owner);
    await migration.command(
      owner,
      action,
      f.bundle,
      f.digest,
      a?.revision ?? 0,
      "practice-migration-" + action,
    );
    if (action === "freeze")
      await assert.rejects(
        receiveLearningProgress(
          actions,
          link,
          { ...progress, source_revision: 2 },
          () => native.assertLegacyWrite(owner),
        ),
        { statusCode: 409 },
      );
    if (action !== "activate")
      assert.equal(
        (
          (await actions.request(
            owner,
            "GET",
            "/practices/" + plan.id + "/source",
          )) as any
        ).available,
        false,
      );
  }
  const source = (await actions.request(
    owner,
    "GET",
    "/practices/" + plan.id + "/source",
  )) as any;
  assert.equal(source.available, true);
  assert.equal(source.text, publication.content);
  assert.equal(source.source_version, f.current);
  assert.equal((await actions.readWorkspace(owner)).data.plans.length, 1);
  assert.equal(
    ((await actions.request(owner, "GET", "/learning-progress")) as any)
      .progress,
    null,
  );
  assert.equal(
    (await actions.readWorkspace(owner)).data.learning_progress
      ?.source_revision,
    1,
  );
});
