import test from "node:test";
import assert from "node:assert/strict";
import { FocusService } from "../../src/modules/lighttick/focus/focus.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
const owner = { appId: "lighttick" as const, userId: "user_alice" };
test("focus excludes pauses, caps unattended time, requires explicit confirmation and deduplicates save", async () => {
  let now = Date.parse("2026-11-14T10:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    s = new FocusService(repo, () => new Date(now));
  const started = await s.start(owner, {
    request_key: "focus-start-001",
    kind: "focus",
    title: "Read",
    planned_seconds: 60,
  });
  now += 20000;
  const paused = await s.command(owner, started.session!.id, {
    request_key: "focus-pause-001",
    base_version: 1,
    action: "pause",
  });
  assert.equal(paused.session!.elapsed_seconds, 20);
  now += 120000;
  assert.equal((await s.current(owner)).session!.elapsed_seconds, 20);
  await s.command(owner, started.session!.id, {
    request_key: "focus-resume-001",
    base_version: 2,
    action: "resume",
  });
  now += 3600000;
  const due = (await s.current(owner)).session!;
  assert.equal(due.elapsed_seconds, 60);
  assert.equal(due.reminder_due, true);
  assert.equal(due.actual_seconds, null);
  const body = {
    request_key: "focus-finish-001",
    base_version: 3,
    action: "finish",
    actual_seconds: 55,
    notes: "Confirmed",
  };
  const saved = await s.command(owner, due.id, body);
  assert.equal(saved.session!.actual_seconds, 55);
  assert.equal(saved.session!.status, "saved");
  assert.equal((await s.current(owner)).session, null);
  assert.deepEqual(await s.command(owner, due.id, body), saved);
  assert.deepEqual(
    await s.command(
      owner,
      due.id,
      Object.fromEntries(Object.entries(body).reverse()),
    ),
    saved,
  );
  assert.equal((await s.history(owner, {})).total, 1);
  await assert.rejects(
    () => s.command(owner, due.id, { ...body, actual_seconds: 54 }),
    { statusCode: 409 },
  );
  assert.equal(
    (await repo.focus.summary(owner, "2026-11-14", "2026-11-14")).seconds,
    55,
  );
});
test("focus and breaks share one active slot; snooze and dismissal do not save work", async () => {
  let now = Date.parse("2026-11-14T10:00:00Z");
  const repo = new InMemoryLightTickRepository(),
    s = new FocusService(repo, () => new Date(now));
  const first = await s.start(owner, {
    request_key: "focus-active-001",
    kind: "focus",
    title: "Work",
    planned_seconds: 60,
  });
  await assert.rejects(
    () =>
      s.start(owner, {
        request_key: "break-active-001",
        kind: "break",
        title: "Rest",
        planned_seconds: 60,
      }),
    { statusCode: 409 },
  );
  now += 61000;
  await s.command(owner, first.session!.id, {
    request_key: "focus-snooze-001",
    base_version: 1,
    action: "snooze",
  });
  assert.equal((await s.current(owner)).session!.reminder_due, false);
  now += 300001;
  assert.equal((await s.current(owner)).session!.reminder_due, true);
  await s.command(owner, first.session!.id, {
    request_key: "focus-dismiss-001",
    base_version: 2,
    action: "dismiss_reminder",
  });
  assert.equal((await s.current(owner)).session!.reminder_due, false);
  await s.command(owner, first.session!.id, {
    request_key: "focus-discard-001",
    base_version: 3,
    action: "discard",
  });
  const rest = await s.start(owner, {
    request_key: "break-start-001",
    kind: "break",
    title: "Rest",
    planned_seconds: 60,
  });
  now += 60000;
  await s.command(owner, rest.session!.id, {
    request_key: "break-finish-001",
    base_version: 1,
    action: "finish",
    actual_seconds: 60,
    notes: "",
  });
  assert.equal(
    (await repo.focus.summary(owner, "2026-11-14", "2026-11-14")).seconds,
    0,
  );
  assert.equal((await repo.listTasks(owner)).length, 0);
  assert.equal(
    (await s.history({ ...owner, userId: "user_bob" }, {})).total,
    0,
  );
});

test("focus preference receipts are stable, stale writes fail and rollback releases the active slot", async () => {
  const repo = new InMemoryLightTickRepository(),
    s = new FocusService(repo, () => new Date("2026-11-14T10:00:00Z"));
  assert.equal((await s.current(owner)).preferences.revision, 0);
  assert.equal(await repo.focus.preferences(owner), undefined);
  const input = {
    request_key: "focus-prefs-001",
    base_version: 0,
    focus_minutes: 15,
    break_minutes: 3,
    reminders_enabled: false,
  };
  const first = await s.preferences(owner, input);
  assert.deepEqual(await s.preferences(owner, input), first);
  await assert.rejects(
    () => s.preferences(owner, { ...input, request_key: "focus-prefs-002" }),
    { statusCode: 409 },
  );
  await assert.rejects(
    repo.transaction(owner, async () => {
      await s.start(owner, {
        request_key: "focus-rollback-001",
        kind: "focus",
        title: "Rollback",
      });
      throw Error("rollback");
    }),
  );
  assert.equal((await s.current(owner)).session, null);
  await assert.rejects(() => s.byRequest(owner, "focus-rollback-001"), {
    statusCode: 404,
  });
  const results = await Promise.allSettled([
    s.start(owner, {
      request_key: "focus-race-001",
      kind: "focus",
      title: "A",
    }),
    s.start(owner, {
      request_key: "focus-race-002",
      kind: "break",
      title: "B",
    }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
});
