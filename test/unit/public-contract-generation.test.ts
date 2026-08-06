import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  AiNovelStatisticsSnapshotRequestSchema,
  BodyLogChallengeDataSchema,
  BodyLogProfileUpdateRequestSchema,
  GeneratedPublicContractNames,
} from "../../src/generated/openapi/public-contracts.generated.ts";

const repositoryRoot = fileURLToPath(new URL("../..", import.meta.url));

test("generated public contracts include restored AI Novel and BodyLog schemas", () => {
  assert.ok(GeneratedPublicContractNames.includes("AiNovelStatisticsSnapshotRequest"));
  assert.ok(GeneratedPublicContractNames.includes("BodyLogProfileUpdateRequest"));
  assert.ok(GeneratedPublicContractNames.includes("BodyLogChallengeData"));
  assert.ok(GeneratedPublicContractNames.includes("RegisterBySmsRequest"));

  assert.equal(AiNovelStatisticsSnapshotRequestSchema.type, "object");
  assert.equal(BodyLogProfileUpdateRequestSchema.type, "object");
  assert.equal(BodyLogChallengeDataSchema.type, "object");
});

test("in-repository OpenAPI source reproduces committed runtime contracts", () => {
  const result = spawnSync(
    "python3",
    [
      "build_scripts/generate_public_contracts.py",
      "--repo-root",
      repositoryRoot,
      "--check",
      "--out",
      "src/generated/openapi/public-contracts.generated.ts",
    ],
    {
      cwd: repositoryRoot,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
});
