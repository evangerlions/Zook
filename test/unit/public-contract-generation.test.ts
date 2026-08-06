import assert from "node:assert/strict";
import test from "node:test";
import {
  AiNovelStatisticsSnapshotRequestSchema,
  BodyLogChallengeDataSchema,
  BodyLogProfileUpdateRequestSchema,
  GeneratedPublicContractNames,
} from "../../src/generated/openapi/public-contracts.generated.ts";

test("generated public contracts include restored AI Novel and BodyLog schemas", () => {
  assert.ok(GeneratedPublicContractNames.includes("AiNovelStatisticsSnapshotRequest"));
  assert.ok(GeneratedPublicContractNames.includes("BodyLogProfileUpdateRequest"));
  assert.ok(GeneratedPublicContractNames.includes("BodyLogChallengeData"));
  assert.ok(GeneratedPublicContractNames.includes("RegisterBySmsRequest"));

  assert.equal(AiNovelStatisticsSnapshotRequestSchema.type, "object");
  assert.equal(BodyLogProfileUpdateRequestSchema.type, "object");
  assert.equal(BodyLogChallengeDataSchema.type, "object");
});
