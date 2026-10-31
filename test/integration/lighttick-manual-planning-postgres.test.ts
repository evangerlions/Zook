import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { readFileSync } from "node:fs";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LocalAdoptionService } from "../../src/modules/lighttick/manual/local-adoption.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
const url = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!url) throw Error("A disposable LIGHTTICK_TEST_DATABASE_URL is required.");
const fixture = JSON.parse(
  readFileSync(
    new URL(
      "../../api-contracts/fixtures/lighttick/native-manual-loop.json",
      import.meta.url,
    ),
    "utf8",
  ),
);
const clock = () => new Date("2026-10-31T04:00:00Z");
test("manual cloud transactions on real PostgreSQL: CAS, concurrency, rollback, reconnect, source ownership and deletion", async (t) => {
  await runPostgresMigrations({ connectionString: url, log: () => {} });
  const pool = new Pool({ connectionString: url, max: 8 }),
    repo = new PostgresLightTickRepository(pool),
    o = {
      appId: "lighttick",
      userId: "native-manual-pg-" + Date.now(),
    } as const;
  try {
    const s = new ManualPlanningService(repo, clock),
      p = await s.create(o, "manual-pg-create", fixture.draft);
    await t.test(
      "draft is inert and illegal editing has no partial effect",
      async () => {
        assert.equal((await repo.listTasks(o)).length, 0);
        await assert.rejects(() =>
          s.update(o, p.id, "manual-pg-bad-edit", {
            ...fixture.draft,
            base_version: 1,
            period_end: "2026-02-30",
          }),
        );
        assert.equal((await s.get(o, p.id)).version, 1);
      },
    );
    const cmd = { base_version: p.version, goal_base_version: p.goal_version };
    await t.test(
      "same-key concurrent confirm returns the durable receipt once",
      async () => {
        const results = await Promise.all(
          Array.from({ length: 6 }, () =>
            new ManualPlanningService(
              new PostgresLightTickRepository(pool),
              clock,
            ).confirm(o, p.id, "manual-pg-confirm", cmd),
          ),
        );
        for (const r of results) assert.deepEqual(r, results[0]);
        assert.equal((await repo.listTasks(o)).length, 2);
        assert.equal(
          (await new LightTickTodayService(repo, clock).get(o)).executableTasks
            .length,
          1,
        );
      },
    );
    await t.test(
      "reconnect and lost-response replay keep the same IDs and reject stale/new requests",
      async () => {
        const next = new ManualPlanningService(
          new PostgresLightTickRepository(pool),
          clock,
        );
        assert.deepEqual(
          await next.confirm(o, p.id, "manual-pg-confirm", cmd),
          (await repo.getOperation(o, "manual-pg-confirm"))!.resultPayload,
        );
        await assert.rejects(
          () => next.confirm(o, p.id, "manual-pg-other", cmd),
          { statusCode: 409 },
        );
        await assert.rejects(() => next.get({ ...o, userId: "other" }, p.id), {
          statusCode: 404,
        });
        assert.equal(
          (await repo.listTasks(o)).find((a) => !a.scheduledFor)
            ?.estimatedMinutes,
          null,
        );
      },
    );
    await t.test(
      "materialization failure rolls back tasks, goal, plan and operation",
      async () => {
        const draft = await s.create(o, "manual-pg-rollback-create", {
          ...fixture.draft,
          title: "Rollback goal",
        });
        const save = repo.saveTask.bind(repo);
        let n = 0;
        repo.saveTask = async (...a) => {
          if (++n === 2) throw Error("injected second write failure");
          return save(...a);
        };
        await assert.rejects(() =>
          s.confirm(o, draft.id, "manual-pg-rollback", {
            base_version: 1,
            goal_base_version: 1,
          }),
        );
        repo.saveTask = save;
        assert.equal((await repo.getPlan(o, draft.id))?.status, "proposed");
        assert.equal(
          await repo.getOperation(o, "manual-pg-rollback"),
          undefined,
        );
        assert.equal((await repo.listTasks(o)).length, 2);
      },
    );
    const input = { ...fixture.adoption, workspace_id: o.userId };
    await t.test(
      "concurrent adoption maps one source once and preserves original completion/reflection timestamps",
      async () => {
        const results = await Promise.all(
          ["local-pg-one", "local-pg-two", "local-pg-three"].map((k) =>
            new LocalAdoptionService(
              new PostgresLightTickRepository(pool),
              clock,
            ).adopt(o, k, input),
          ),
        );
        assert.deepEqual(results[0].mappings, results[1].mappings);
        assert.equal((await repo.listTasks(o)).length, 3);
        const task = (await repo.listTasks(o)).find(
          (a) => a.title === input.actions[0].title,
        )!;
        assert.equal(task.estimatedMinutes, null);
        assert.equal(task.completedAt, input.actions[0].completed_at);
        assert.equal(
          (await repo.listReflections(o))[0].createdAt,
          input.reflections[0].created_at,
        );
      },
    );
    await t.test(
      "another owner cannot claim a source, including a race",
      async () => {
        const other = { ...o, userId: o.userId + "-other" };
        await assert.rejects(
          () =>
            new LocalAdoptionService(repo, clock).adopt(
              other,
              "local-pg-foreign",
              input,
            ),
          { statusCode: 409 },
        );
        assert.equal((await repo.listGoals(other)).length, 0);
      },
    );
    await t.test(
      "deletion clears content, receipts and identities while retaining opaque anti-resurrection tombstones",
      async () => {
        await repo.deleteOwnerData(o);
        assert.equal((await repo.listTasks(o)).length, 0);
        assert.equal((await repo.listReflections(o)).length, 0);
        assert.equal(await repo.getOperation(o, "local-pg-one"), undefined);
        const result = await pool.query(
          "SELECT user_id,cloud_id,payload_hash,source_payload,deleted FROM zook_lighttick_local_claims WHERE source_payload->>'title'=$1",
          [input.goals[0].title],
        );
        assert.equal(result.rows.length, 0);
        await assert.rejects(
          () =>
            new LocalAdoptionService(repo, clock).adopt(
              o,
              "local-pg-after-delete",
              input,
            ),
          { statusCode: 410 },
        );
      },
    );

    await t.test(
      "draft order becomes deterministic Today priority on real rows",
      async () => {
        const ordered = { ...o, userId: o.userId + "-ordered" };
        const service = new ManualPlanningService(repo, clock);
        try {
          const first = {
              ...fixture.draft.tasks[0],
              id: "first",
              title: "Z first in my order",
            },
            second = {
              ...fixture.draft.tasks[0],
              id: "second",
              title: "A second in my order",
            };
          const draft = await service.create(ordered, "manual-order-create", {
            ...fixture.draft,
            tasks: [first, second],
          });
          await service.confirm(ordered, draft.id, "manual-order-confirm", {
            base_version: draft.version,
            goal_base_version: draft.goal_version,
          });
          assert.equal(
            (await new LightTickTodayService(repo, clock).get(ordered))
              .primaryTask?.title,
            first.title,
          );
        } finally {
          await repo.deleteOwnerData(ordered);
        }
      },
    );
    await t.test(
      "two different owners racing for the same source produce exactly one formal owner",
      async () => {
        const a = { ...o, userId: o.userId + "-race-a" },
          b = { ...o, userId: o.userId + "-race-b" },
          source = { ...fixture.adoption, workspace_id: o.userId + "-race" };
        try {
          const result = await Promise.allSettled([
            new LocalAdoptionService(
              new PostgresLightTickRepository(pool),
              clock,
            ).adopt(a, "local-race-one", source),
            new LocalAdoptionService(
              new PostgresLightTickRepository(pool),
              clock,
            ).adopt(b, "local-race-two", source),
          ]);
          assert.equal(
            result.filter((r) => r.status === "fulfilled").length,
            1,
          );
          assert.equal(
            result.filter(
              (r) => r.status === "rejected" && r.reason.statusCode === 409,
            ).length,
            1,
          );
          const counts = await Promise.all([
            repo.listTasks(a),
            repo.listTasks(b),
          ]);
          assert.deepEqual(counts.map((x) => x.length).sort(), [0, 1]);
        } finally {
          await repo.deleteOwnerData(a);
          await repo.deleteOwnerData(b);
        }
      },
    );
    await t.test(
      "a concurrently inserted foreign operation receipt forces full rollback",
      async () => {
        const collided = { ...o, userId: o.userId + "-receipt-race" },
          otherRepo = new PostgresLightTickRepository(pool),
          service = new ManualPlanningService(repo, clock),
          saveGoal = repo.saveGoal.bind(repo);
        const key = "manual-pg-late-collision";
        try {
          repo.saveGoal = async (row, write, version) => {
            const saved = await saveGoal(row, write, version);
            if (row.userId === collided.userId)
              await otherRepo.saveOperation({
                ...collided,
                operationId: key,
                deviceId: "other-domain",
                entityType: "other",
                entityId: "other",
                action: "other.command",
                payloadHash: "different-request",
                requestPayload: {},
                resultPayload: { unrelated: true },
                status: "accepted",
                createdAt: clock().toISOString(),
                updatedAt: clock().toISOString(),
              });
            return saved;
          };
          await assert.rejects(
            () => service.create(collided, key, fixture.draft),
            { statusCode: 409 },
          );
          assert.equal((await repo.listPlans(collided)).length, 0);
          assert.equal((await repo.listGoals(collided)).length, 0);
          assert.equal(
            (await repo.getOperation(collided, key))?.action,
            "other.command",
          );
        } finally {
          repo.saveGoal = saveGoal;
          await repo.deleteOwnerData(collided);
        }
      },
    );
  } finally {
    await repo.deleteOwnerData(o);
    await pool.end();
  }
});
