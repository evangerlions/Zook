import assert from "node:assert/strict";
import test from "node:test";
import { projectCycleHandoffs, readCycleHandoffs } from "../../src/modules/lighttick/lighttick-cycle-handoffs.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { LightTickGoalRow, LightTickPlanRow } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "cycle-owner" } as const;
const timestamps = { version: 1, createdAt: "2026-03-01T12:00:00Z", updatedAt: "2026-03-01T12:00:00Z" };
const goal = (id: string, status = "active"): LightTickGoalRow => ({
  ...owner, ...timestamps, id, title: id, status, constraints: {},
});
const plan = (id: string, goalId: string, overrides: Partial<LightTickPlanRow> = {}): LightTickPlanRow => ({
  ...owner, ...timestamps, id, goalId, granularity: "week", status: "active", source: "manual_native",
  periodStart: "2026-03-02", periodEnd: "2026-03-08", proposal: { manual_schema: 1 }, ...overrides,
});

test("cycle handoff uses the latest started manual cycle and includes weekends in D−2 through the end", () => {
  const goals = [goal("second-goal"), goal("first-goal"), goal("paused-goal", "paused"), goal("closed-goal", "completed")];
  const plans = [
    plan("older-plan", "first-goal", { periodStart: "2026-03-01" }),
    plan("not-started", "third-goal", { periodStart: "2026-03-07" }),
    plan("second-plan", "second-goal"),
    plan("first-plan", "first-goal"),
    plan("paused-plan", "paused-goal"),
    plan("closed-plan", "closed-goal"),
  ];
  const allGoals = [...goals, goal("third-goal")];
  assert.deepEqual(projectCycleHandoffs(allGoals, plans, "2026-03-05"), []);
  for (const businessDate of ["2026-03-06", "2026-03-07", "2026-03-08"]) {
    assert.deepEqual(projectCycleHandoffs(goals, plans, businessDate).map(({ planId, state }) => [planId, state]),
      [["first-plan", "ending_soon"], ["second-plan", "ending_soon"]]);
  }
  assert.equal(projectCycleHandoffs([goal("third-goal")], plans, "2026-03-06").length, 0);
  assert.equal(projectCycleHandoffs(goals, plans, "2026-03-09")[0]?.state, "ended");
});

test("eligible next-cycle drafts are editable, and confirmed ordinary future cycles supersede the handoff", () => {
  const goals = [goal("practice")];
  const current = plan("current", "practice");
  const future = { periodStart: "2026-03-09", periodEnd: "2026-03-15" };
  const learning = plan("course", "practice", { ...future, source: "learning_schedule" });
  const daily = plan("daily", "practice", { ...future, source: "deterministic_template", granularity: "day" });
  const unrelated = plan("other-goal", "fitness", future);
  const shortDraft = plan("short-draft", "practice", {
    periodStart: "2026-03-09", periodEnd: "2026-03-09", status: "proposed", updatedAt: "2026-03-05T00:00:00Z",
  });
  const overlappingDraft = plan("overlap", "practice", { ...future, periodStart: "2026-03-08", status: "proposed" });
  const inaccessibleDraft = plan("legacy", "practice", { ...future, proposal: {}, status: "proposed" });
  const base = [current, learning, daily, unrelated, shortDraft, overlappingDraft, inaccessibleDraft];
  assert.equal(projectCycleHandoffs(goals, base, "2026-03-10")[0]?.state, "ended");
  const draft = plan("draft-next", "practice", { ...future, status: "proposed" });
  assert.equal(projectCycleHandoffs(goals, [...base, draft], "2026-03-06")[0]?.nextDraftId, shortDraft.id);
  assert.deepEqual(projectCycleHandoffs(goals, [...base, draft], "2026-03-10"), [{
    goalId: "practice", goalTitle: "practice", planId: "current", periodStart: "2026-03-02",
    periodEnd: "2026-03-08", state: "next_draft_pending", nextDraftId: "draft-next",
  }]);
  const confirmed = plan("confirmed-next", "practice", { ...future, source: "local_adoption" });
  assert.deepEqual(projectCycleHandoffs(goals, [...base, draft, confirmed], "2026-03-06"), []);
  assert.deepEqual(projectCycleHandoffs(goals, [...base, draft, confirmed], "2026-03-10"), []);
});

test("Today falls back to UTC for a legacy invalid account timezone", async () => {
  const repository = new InMemoryLightTickRepository();
  await repository.saveProfile({
    ...owner, ...timestamps, timezone: "Invalid/Timezone", locale: "en", pace: "balanced",
    onboardingState: "completed", notificationPreferences: {}, onboardingDraft: {},
  });
  const today = await new LightTickTodayService(repository, () => new Date("2026-03-06T18:00:00Z")).get(owner);
  assert.equal(today.businessDate, "2026-03-06");
  assert.equal(today.timezone, "UTC");
  assert.equal(today.cycleHandoffs, undefined);
});

test("conversational handoff links only the owning session's current nonexpired draft", async () => {
  const repository = new InMemoryLightTickRepository();
  const goals = [goal("practice")];
  const current = plan("first-ai-plan", "practice", { source: "ai", proposal: { planning_session_id: "session-start" } });
  const next = { source: "ai", periodStart: "2026-03-09", periodEnd: "2026-03-15", status: "proposed" };
  const draft = plan("new-draft", "practice", { ...next, proposal: { planning_session_id: "session-next", previous_plan_id: current.id } });
  const outdated = plan("outdated-draft", "practice", { ...next, updatedAt: "2026-03-07T12:00:00Z", proposal: draft.proposal });
  const foreign = plan("foreign-draft", "practice", { ...next, periodStart: "2026-03-10", proposal: { planning_session_id: "session-foreign" } });
  const baseSession = { ...owner, ...timestamps, goalId: "practice", threadId: "conversation", status: "draft_ready" as const,
    context: {}, contextRevision: 1, clarificationRounds: 0, questions: [], draftRevision: 1, draftExpiresAt: "2026-03-11T12:00:00Z" };
  await repository.savePlanningSession({ ...baseSession, id: "session-next", draftPlanId: draft.id });
  await repository.savePlanningSession({ ...baseSession, userId: "other-owner", id: "session-foreign", draftPlanId: foreign.id });
  const before = await readCycleHandoffs(repository, owner, goals, [current, foreign, outdated, draft], "2026-03-08", "2026-03-08T12:00:00Z");
  assert.deepEqual(before, [{ goalId: "practice", goalTitle: "practice", planId: current.id, periodStart: current.periodStart,
    periodEnd: current.periodEnd, state: "next_draft_pending", nextDraftId: draft.id, planningKind: "conversational", nextPlanningSessionId: "session-next" }]);
  const expired = await readCycleHandoffs(repository, owner, goals, [current, foreign, draft], "2026-03-12", "2026-03-12T12:00:00Z");
  assert.equal(expired[0]?.state, "ended");
  assert.equal(expired[0]?.nextDraftId, undefined);
  assert.equal(expired[0]?.planningKind, "conversational");
  assert.deepEqual(await readCycleHandoffs(repository, owner, goals, [current, { ...draft, status: "active" }],
    "2026-03-08", "2026-03-08T12:00:00Z"), []);
});
