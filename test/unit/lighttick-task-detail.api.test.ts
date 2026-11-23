import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTaskDetailEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { mapRow } from "../../src/infrastructure/database/postgres/postgres-lighttick-row-mappers.ts";
import type { LightTickRepository } from "../../src/modules/lighttick/lighttick.repository.ts";
import type { LightTickOwner, LightTickTaskRow } from "../../src/modules/lighttick/lighttick.types.ts";
import type { HttpRequest, HttpResponse } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const otherOwner = { ...owner, userId: "user_bob" } as const;
const now = "2026-03-09T04:30:00.000Z";
const timestamps = { version: 1, createdAt: now, updatedAt: now };
const prefix = "/api/v1/lighttick/";
const ajv = new Ajv2020({ strict: false });
addFormats(ajv);
const validate = ajv.compile(LightTickTaskDetailEnvelopeSchema);

async function setup() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, otherOwner.userId]) {
    seed.appUsers.push({
      id: "task-detail-" + userId, appId: owner.appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now,
    });
  }
  const application = await createApplication({ seed, lighttickEnabled: true });
  const { lighttickRuntime, tokenService } = application.services;
  const read = (taskId: string, token: string, method: HttpRequest["method"] = "GET") => application.app.handle({
    method, path: prefix + "tasks/" + taskId, headers: {
      authorization: "Bearer " + token, "x-app-id": owner.appId, "x-lighttick-task-schema": "2",
    },
  });
  return {
    application, read, repository: lighttickRuntime.repository,
    alice: tokenService.issueAccessToken(owner.userId, owner.appId),
    bob: tokenService.issueAccessToken(otherOwner.userId, otherOwner.appId),
  };
}

function persistTask(repository: LightTickRepository, taskOwner: LightTickOwner, id: string, facts: Partial<LightTickTaskRow> = {}) {
  const task: LightTickTaskRow = {
    ...taskOwner, ...timestamps, id, goalId: "goal-history", planId: "plan-history",
    title: "Historical ordinary action", status: "pending", estimatedMinutes: 15, priority: 1, ...facts,
  };
  return repository.saveTask(task, {
    event: {
      ...taskOwner, id: "event-" + id, aggregateType: "task", aggregateId: id, eventType: "task_created",
      aggregateVersion: 1, occurredAt: now, createdAt: now, payload: {},
    },
    change: {
      ...taskOwner, entityType: "task", entityId: id, entityVersion: 1, operation: "upsert", changedAt: now,
    },
  });
}

function validateRead(response: HttpResponse<unknown>) {
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal(response.headers?.["Cache-Control"], "no-store");
  const body = JSON.parse(JSON.stringify(response.body));
  assert.equal(validate(body), true, JSON.stringify(validate.errors));
  return body.data;
}

test("task detail reads original same-owner facts and steps in the account calendar", async () => {
  const { repository, read, alice, bob } = await setup();
  await repository.saveProfile({
    ...owner, ...timestamps, timezone: "America/Los_Angeles", locale: "en", pace: "balanced",
    onboardingState: "completed", notificationPreferences: {}, onboardingDraft: {},
  });
  const task = await persistTask(repository, owner, "task-history", {
    status: "completed", scheduledFor: now, completedAt: now, notes: "Original completed work", actualMinutes: 13,
    executionProgress: { outcome: "Completed the first section", remainingEstimatedMinutes: null },
  });
  await repository.saveTaskStep({
    ...owner, ...timestamps, id: "step-history", taskId: task.id, title: "Draft the first section", completed: true, position: 0,
  });

  assert.deepEqual(validateRead(await read(task.id, alice)), {
    id: task.id, plan_id: task.planId, goal_id: task.goalId, title: task.title, status: "completed",
    scheduled_date: "2026-03-08", completed_at: now, actual_duration_minutes: 13, note: "Original completed work",
    execution_progress: { outcome: "Completed the first section", remaining_estimated_minutes: null },
    steps: [{ id: "step-history", title: "Draft the first section", completed: true, position: 0 }],
  });
  assert.deepEqual(await repository.getTask(owner, task.id), task);
  const missing = await read("task-missing", alice);
  const anotherAccount = await read(task.id, bob);
  assert.equal(missing.statusCode, 404);
  assert.equal(anotherAccount.statusCode, 404);
  assert.equal(anotherAccount.body.code, missing.body.code);

  const nullableStorage = mapRow<Partial<LightTickTaskRow>>({
    scheduled_for: null, completed_at: null, actual_minutes: null, notes: null,
  });
  const undated = await persistTask(repository, owner, "task-undated", nullableStorage);
  assert.deepEqual(validateRead(await read(undated.id, alice)), {
    id: undated.id, plan_id: undated.planId, goal_id: undated.goalId, title: undated.title, status: "pending", steps: [],
  });
  const dated = await persistTask(repository, owner, "task-calendar", { scheduledFor: "2026-03-09" });
  assert.equal(validateRead(await read(dated.id, alice)).scheduled_date, "2026-03-09");
});

test("task detail conceals the complete lesson task when the account reading grant is absent or revoked", async () => {
  const { repository, read, alice, bob } = await setup();
  const lessonSource = {
    route_id: "plan-lesson-history", route_version: 1, lesson_number: 1, lesson_id: "lesson-history",
    content_version: "a".repeat(64), purpose: "review",
  } as const;
  const task = await persistTask(repository, owner, "task-lesson", { lessonSource, notes: "Private lesson result" });
  const missing = await read("task-missing", alice);
  const withoutGrant = await read(task.id, alice);
  assert.equal(withoutGrant.statusCode, 404);
  assert.equal(withoutGrant.body.code, missing.body.code);
  const authority = {
    ...owner, phase: "zook", module: "learning", readingEnabled: true, privateEnabled: false, epoch: 1, revision: 1,
    manifestHash: null, sourceBinding: null, updatedAt: now,
  } as const;
  await repository.saveLearningAuthority(authority, 0);
  assert.deepEqual(validateRead(await read(task.id, alice)).lesson_source, lessonSource);
  assert.equal((await read(task.id, bob)).statusCode, 404);
  await repository.saveLearningAuthority({ ...authority, revision: 2, readingEnabled: false }, 1);
  const revoked = await read(task.id, alice);
  assert.equal(revoked.statusCode, 404);
  assert.equal(revoked.body.code, missing.body.code);
  assert.equal(JSON.stringify(revoked.body).includes("Private lesson result"), false);
  await repository.saveLearningAuthority({ ...authority, revision: 3, phase: "frozen" }, 2);
  assert.equal((await read(task.id, alice)).statusCode, 404);
});

test("task detail permits a guest to read only that guest's existing tasks", async () => {
  const { repository, application, read } = await setup();
  const registered = await persistTask(repository, owner, "task-registered");
  const created = await application.app.handle({
    method: "POST", path: prefix + "account/guest-sessions", headers: { "idempotency-key": "task-detail-guest-create" },
    body: {
      device_id: "task-detail-guest-device", device_secret: "isolated-test-secret-at-least-32-characters", platform: "ios",
      timezone: "Asia/Shanghai", locale: "zh-CN", app_version: "1.0.0",
    },
  });
  assert.equal(created.statusCode, 201);
  const guest = created.body.data as { user_id: string; access_token: string };
  const task = await persistTask(repository, { ...owner, userId: guest.user_id }, "task-guest");
  assert.equal(validateRead(await read(task.id, guest.access_token)).id, task.id);
  assert.equal((await read(registered.id, guest.access_token)).statusCode, 404);
  assert.equal((await read(task.id, guest.access_token, "POST")).statusCode, 403);
});
