import { test } from "node:test";
import assert from "node:assert/strict";
import {
  trialWindow,
  validateSurvey,
} from "../../src/modules/lighttick/participation/participation.service.ts";
test("two-week surveys use frozen local calendar days across DST and timezone boundaries", () => {
  const t = {
    id: "trial",
    version: 1,
    enrolled_at: "2026-03-02T23:30:00Z",
    timezone: "America/New_York",
    surveys: {},
  };
  assert.equal(trialWindow(t, new Date("2026-03-08T04:59:59Z")).day, 6);
  assert.equal(trialWindow(t, new Date("2026-03-08T05:00:00Z")).day, 7);
  assert.equal(trialWindow(t, new Date("2026-03-15T04:00:00Z")).mature, false);
  assert.equal(trialWindow(t, new Date("2026-03-16T04:00:00Z")).mature, true);
});
test("survey is explicit integer feedback and rejects extra fields or default answers", () => {
  assert.deepEqual(
    validateSurvey({ day: 7, version: 1, clarity_score: 1, progress_score: 5 }),
    { day: 7, version: 1, clarity_score: 1, progress_score: 5 },
  );
  for (const x of [
    { day: 7, version: 1 },
    { day: 8, version: 1, clarity_score: 3, progress_score: 3 },
    { day: 14, version: 1, clarity_score: 1.5, progress_score: 4 },
    { day: 7, version: 1, clarity_score: 1, progress_score: 5, reward: true },
  ])
    assert.throws(() => validateSurvey(x));
});
