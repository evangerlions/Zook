import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { ActionService } from "../../src/modules/lighttick/actions/action.service.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { LearningMigrationService } from "../../src/modules/lighttick/learning/learning-migration.service.ts";
import { learningMigrationFixture } from "../support/native-learning-migration-fixture.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  !["localhost", "127.0.0.1"].includes(new URL(dsn).hostname) ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_")
)
  throw Error("Disposable localhost Grow database required");
test("native learning CAS, immutable publications, private history and original receipts survive PostgreSQL reconnect", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    service = new NativeLearningService(repo, true),
    owner = {
      appId: "lighttick" as const,
      userId: "native-learning-pg-" + process.pid,
    };
  try {
    await service.saveCollection(
      owner,
      "collection-native-pg",
      { base_revision: 0, title: "Native", archived: false },
      "collection-native-pg-key",
    );
    await service.saveCollection(
      owner,
      "collection-native-pg",
      { base_revision: 1, title: "Native revised", archived: false },
      "collection-native-pg-edit",
    );
    await assert.rejects(
      service.saveCollection(
        owner,
        "collection-native-pg",
        { base_revision: 1, title: "Stale", archived: false },
        "collection-native-pg-stale",
      ),
      { statusCode: 409 },
    );
    const body = {
      base_revision: 0,
      collection_id: "collection-native-pg",
      number: 1,
      title: "Lesson",
      content: "Original body",
      references: "",
      source_url: "",
    };
    const p = await service.publish(
      owner,
      "lesson-native-pg",
      body,
      "publish-native-pg-key",
    );
    const command = {
      content_version: p.content_version,
      action: "save",
      base_revision: 0,
      notes: "Original note",
      answers: [{ id: "q", prompt: "Question", answer: "Answer" }],
    };
    const saved = await service.privateCommand(
      owner,
      p.id,
      command,
      "native-private-pg-one",
    );
    await service.privateCommand(
      owner,
      p.id,
      {
        content_version: p.content_version,
        action: "position",
        base_revision: 0,
        position: 33,
      },
      "native-position-pg-one",
    );
    const fresh = new NativeLearningService(
      new PostgresLightTickRepository(pool),
      true,
    );
    assert.equal(
      (await fresh.privateState(owner, p.id, p.content_version)).notes,
      "Original note",
    );
    assert.deepEqual(
      await fresh.privateCommand(owner, p.id, command, "native-private-pg-one"),
      saved,
    );
    const actions = new ActionService(
      repo,
      () => new Date("2026-11-03T12:00:00Z"),
      undefined,
      true,
    );
    const practice = (await actions.request(owner, "POST", "/practices", {
      key: "pg-native-practice-create",
      source_kind: "lesson",
      source_id: p.id,
      source_version: p.content_version,
      title: "Apply original lesson",
      date: null,
    })) as any;
    const next = await fresh.publish(
      owner,
      p.id,
      { ...body, base_revision: 1, content: "Changed body" },
      "publish-native-pg-next",
    );
    assert.notEqual(next.content_version, p.content_version);
    const practiceSource = (await actions.request(
      owner,
      "GET",
      "/practices/" + practice.plan.id + "/source",
    )) as any;
    assert.equal(practiceSource.text, "Original body");
    assert.equal(practiceSource.source_version, p.content_version);
    assert.equal(practiceSource.current_version, next.content_version);
    assert.equal(
      (await fresh.privateState(owner, p.id, next.content_version)).notes,
      "",
    );
    assert.equal(
      (await fresh.privateState(owner, p.id, p.content_version)).position,
      33,
    );
    const history = await repo.listLearningHistory(
      owner,
      p.id,
      p.content_version,
      "",
      100,
    );
    assert.deepEqual(
      history.map((r) => r.component),
      ["position", "notes", "initial"],
    );
    const original = repo.saveOperation.bind(repo);
    repo.saveOperation = async () => {
      throw Error("injected receipt failure");
    };
    await assert.rejects(
      service.privateCommand(
        owner,
        p.id,
        {
          content_version: next.content_version,
          action: "complete",
          base_revision: 0,
        },
        "native-failure-complete",
      ),
      /receipt failure/,
    );
    assert.equal(
      await repo.getNativePrivateState(owner, p.id, next.content_version),
      undefined,
    );
    repo.saveOperation = original;
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});
test("synthetic PostgreSQL migration freezes, rolls back failed import, verifies across reconnect and rejects destructive rollback after activation", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    repo = new PostgresLightTickRepository(pool),
    owner = {
      appId: "lighttick" as const,
      userId: "native-migration-pg-" + process.pid,
    };
  const fixture = learningMigrationFixture(owner.userId);
  const service = () =>
    new LearningMigrationService(
      new NativeLearningService(new PostgresLightTickRepository(pool), true),
    );
  const command = async (
    action: "freeze" | "import" | "verify" | "activate" | "abort",
    key = "synthetic-" + action,
  ) => {
    const authority = await repo.getLearningAuthority(owner);
    return service().command(
      owner,
      action,
      fixture.bundle,
      fixture.digest,
      authority?.revision ?? 0,
      key,
    );
  };
  try {
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
    assert.equal(
      (await service().preflight(owner, fixture.bundle, fixture.digest))
        .pending_resolutions.length,
      2,
    );
    assert.equal(await repo.getLearningAuthority(owner), undefined);
    await command("freeze");
    await assert.rejects(service().learning.assertLegacyWrite(owner), {
      statusCode: 409,
    });
    const faulty = new LearningMigrationService(
      new NativeLearningService(repo, true),
    );
    const save = repo.saveOperation.bind(repo);
    repo.saveOperation = async (row) => {
      if (row.deviceId === "learning-migration")
        throw Error("synthetic import crash");
      return save(row);
    };
    await assert.rejects(
      faulty.command(
        owner,
        "import",
        fixture.bundle,
        fixture.digest,
        1,
        "synthetic-import",
      ),
      /synthetic import crash/,
    );
    assert.equal((await repo.getLearningAuthority(owner))?.phase, "frozen");
    assert.equal((await repo.getNativeLearningCounts(owner)).lessons, 0);
    repo.saveOperation = save;
    await command("import");
    await command("verify");
    await command("activate");
    const native = service().learning;
    assert.equal(
      (await native.privateState(owner, fixture.lesson, fixture.current)).notes,
      "Queued phone note",
    );
    assert.equal(
      (await native.privateState(owner, fixture.lesson, fixture.old))
        .completedAt,
      null,
    );
    assert.equal(
      (await native.legacyPrivate(owner, fixture.lesson)).operations.find(
        (r) => r.id === fixture.conflicted.id,
      )?.status,
      "conflict",
    );
    const authority = await repo.getLearningAuthority(owner);
    assert.equal(authority?.epoch, 2);
    await native.privateCommand(
      owner,
      fixture.lesson,
      {
        content_version: fixture.current,
        action: "save",
        base_revision: 5,
        notes: "Post-activation synthetic note",
        answers: [],
      },
      "synthetic-native-new-write",
    );
    await assert.rejects(command("abort"), { statusCode: 409 });
    assert.equal(
      (
        await service().learning.privateState(
          owner,
          fixture.lesson,
          fixture.current,
        )
      ).notes,
      "Post-activation synthetic note",
    );
    assert.equal((await repo.getLearningLibrary(owner))?.source_revision, 9);
  } finally {
    await repo.deleteOwnerData(owner);
    await pool.end();
  }
});
