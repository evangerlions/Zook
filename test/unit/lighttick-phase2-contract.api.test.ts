import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";

test("Phase 2 route responses conform to the generated public contracts", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({ id: "phase2_member", appId: "lighttick", userId: "user_alice", status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  const runtime = await createApplication({ seed, lighttickEnabled: true });
  const owner = { appId: "lighttick" as const, userId: "user_alice" };
  const lighttick = runtime.services.lighttickRuntime;
  const headers = { authorization: `Bearer ${runtime.services.tokenService.issueAccessToken(owner.userId, "lighttick")}` };
  const call = (path: string, method: "GET" | "POST" = "GET", body?: unknown, query?: Record<string, string>) => runtime.app.handle({ method, path: `/api/v1/lighttick/${path}`, headers: { ...headers, "idempotency-key": "phase2-chat-0001" }, body, query });
  const ajv = new Ajv2020({ strict: false }); addFormats(ajv);
  const check = (schema: object, data: unknown) => {
    const validate = ajv.compile(schema);
    assert.equal(validate(JSON.parse(JSON.stringify(data))), true, JSON.stringify(validate.errors));
  };
  const goal = await lighttick.goals.create(owner, { title: "Study", constraints: {} });
  const review = await lighttick.reviews.create(owner, goal.id, "week", "2026-08-31", "2026-09-06");
  await lighttick.repository.saveReview({ ...review, output: { recommendations: [{ title: "Study less" }] } });
  for (const [path, schema] of [
    ["execution-facts", contracts.LightTickExecutionFactsDataSchema],
    ["chat/intents", contracts.LightTickChatIntentsDataSchema],
    ["dna/insights", contracts.LightTickDnaInsightsDataSchema],
    ["today/rhythm-suggestion", contracts.LightTickRhythmDataSchema],
    [`reviews/${review.id}/actions`, contracts.LightTickReviewActionsDataSchema],
  ] as const) {
    const result = await call(path); assert.equal(result.statusCode, 200);
    check(schema, result.body.data);
  }
  const body = { goal_id: goal.id, scene: "chat", message: "Help me study" };
  check(contracts.LightTickCoachRunRequestSchema, body);
  const chat = await call("coach-runs", "POST", body); assert.equal(chat.statusCode, 202);
  check(contracts.LightTickRunDataSchema, chat.body.data);
  const messages = await call("chat/messages", "GET", undefined, { goal_id: goal.id });
  assert.equal(messages.statusCode, 200); check(contracts.LightTickChatMessagesDataSchema, messages.body.data);
  const decision = await call(`reviews/${review.id}/actions`, "POST", { action: "accept_all" });
  assert.equal(decision.statusCode, 200); check(contracts.LightTickReviewActionResultSchema, decision.body.data);
  assert.equal((await call(`reviews/${review.id}/actions`, "POST", { action: "accept_all" })).statusCode, 409);
});
