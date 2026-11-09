import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import {
  AesGcmPayloadCryptoService,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { PersonalModelService } from "../../src/modules/lighttick/personal-model/personal-model.service.ts";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
const owner = { appId: "lighttick" as const, userId: "personal-routing" },
  clock = () => new Date("2026-11-05T08:00:00Z");
function setup() {
  let now = new Date("2026-11-05T08:00:00Z");
  const time = () => new Date(now),
    repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue(),
    settings = new PersonalModelService(
      repo,
      new AesGcmPayloadCryptoService(
        new StaticAesGcmEncryptionKeyResolver({
          fixture: Buffer.alloc(32, 9).toString("base64"),
        }),
      ),
      async () => "fixture",
      queue,
      async () => {},
      time,
    ),
    calls: any[] = [],
    platformCalls: any[] = [];
  const dispatcher = new PersonalModelDispatcher(
    settings,
    {
      complete: async (req: any) => {
        platformCalls.push(req);
        return {
          provider: "synthetic-platform",
          providerModel: "platform-model",
          modelKey: "platform",
          text: JSON.stringify(routeFixture().document),
        };
      },
    },
    (async (url: string, init: RequestInit) => {
      const b = JSON.parse(String(init.body));
      calls.push({ url, body: b });
      const course = b.messages.some((m: any) =>
        m.content.includes("Draft a formal curriculum"),
      );
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(
                  course
                    ? routeFixture().document
                    : {
                        tasks: [
                          {
                            title: "Selected personal plan",
                            estimated_minutes: 10,
                          },
                        ],
                      },
                ),
              },
              finish_reason: "stop",
            },
          ],
        }),
      );
    }) as any,
  );
  const body = {
    base_revision: 0,
    mode: "personal",
    base_url: "https://model.example/v1",
    model_name: "owner-selected-model",
    api_key: "SYNTHETIC_PRIVATE_KEY",
  };
  return {
    repo,
    queue,
    settings,
    dispatcher,
    calls,
    platformCalls,
    body,
    clock: time,
    advance: () => {
      now = new Date(now.getTime() + 86400000);
    },
  };
}
test("course worker pins owner model selection at creation, keeps older platform work and refuses changed personal revisions", async () => {
  const f = setup(),
    native = new NativeLearningService(f.repo, true, f.clock),
    work = new LearningWorkService(new LearningRouteService(native), f.queue),
    runner = new LearningWorkRunner(work, f.dispatcher, {
      readFile: async () => {
        throw Error("no file");
      },
      fetchUrl: async () => {
        throw Error("no URL");
      },
    }),
    request = {
      kind: "route_draft",
      route_id: "plan-personal-routing",
      base_revision: 0,
      brief: routeFixture().brief,
    };
  const old = await work.create(owner, request, "platform-work-original");
  await f.settings.configure(owner, f.body, "settings-original");
  const selected = await work.create(owner, request, "personal-work-original");
  assert.deepEqual(
    (await work.store.get(owner, selected.id))?.input.model_selection,
    { mode: "personal", revision: 1 },
  );
  await runner.execute(owner, old.id);
  assert.equal((await work.read(owner, old.id)).status, "succeeded");
  assert.equal(f.platformCalls.length, 1);
  await runner.execute(owner, selected.id);
  const done = await work.read(owner, selected.id);
  assert.equal(done.status, "succeeded");
  assert.equal(done.output?.provider, "personal");
  assert.equal(done.output?.model, f.body.model_name);
  assert.equal(f.calls[0].body.model, f.body.model_name);
  assert.equal(f.platformCalls.length, 1);
  f.advance();
  const stale = await work.create(owner, request, "stale-personal-work");
  await f.settings.configure(
    owner,
    { ...f.body, base_revision: 1, model_name: "new-model" },
    "settings-changed",
  );
  await runner.execute(owner, stale.id);
  assert.equal((await work.read(owner, stale.id)).status, "failed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.platformCalls.length, 1);
});
test("planning creates and executes a real draft with the selected owner model, without platform fallback", async () => {
  const f = setup();
  await f.settings.configure(owner, f.body, "settings-original");
  const goal = await new LightTickGoalService(f.repo, clock).create(owner, {
      title: "Synthetic selected plan",
      constraints: { weekly_available_minutes: 30 },
    }),
    planning = new LightTickPlanningService(f.repo, clock);
  const created = await planning.command(
    owner,
    "planning-create",
    "create",
    undefined,
    { goal_id: goal.id },
  );
  const ready = await planning.command(
    owner,
    "planning-context",
    "context",
    created.session.id,
    {
      base_version: created.session.version,
      fields: {
        period_start: { value: "2026-11-05", source: "user" },
        period_end: { value: "2026-11-11", source: "confirmed" },
      },
    },
  );
  const started = await planning.command(
    owner,
    "planning-draft",
    "drafts",
    ready.session.id,
    {
      base_version: ready.session.version,
      context_revision: ready.session.contextRevision,
      deep_planning: true,
    },
  );
  assert.deepEqual(started.run!.inputContext.model_selection, {
    mode: "personal",
    revision: 1,
  });
  const done = await new LightTickAiRunner(f.repo, f.dispatcher, clock).execute(
    owner,
    started.run!.id,
    "week_plan",
  );
  assert.equal(done.status, "succeeded");
  assert.equal(done.provider, "personal");
  assert.equal(done.model, f.body.model_name);
  assert.equal(f.calls[0].body.model, f.body.model_name);
  assert.equal(f.platformCalls.length, 0);
  assert.equal(
    (await planning.get(owner, created.session.id)).status,
    "draft_ready",
  );
});
