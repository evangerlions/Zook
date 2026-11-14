import test from "node:test";
import assert from "node:assert/strict";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { createApplication } from "../support/create-test-application.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { AccountReportService } from "../../src/modules/lighttick/account-reports/account-report.service.ts";
import { summarizeAccountFacts } from "../../src/modules/lighttick/account-reports/account-report.facts.ts";
import { LightTickScopePolicy } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
test("report API: core facts and history, full AI creation, owner isolation, CAS, tombstone replay and guest rejection", async () => {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"])
    seed.appUsers.push({
      id: "report-" + userId,
      appId: "lighttick",
      userId,
      status: "ACTIVE",
      accountRegion: "UNKNOWN",
      joinedAt: new Date().toISOString(),
    });
  const repo = new InMemoryLightTickRepository(),
    app = await createApplication({
      seed,
      lighttickEnabled: true,
      lighttickRepository: repo,
    }),
    runtime = app.services.lighttickRuntime!;
  let full = false;
  runtime.scopePolicy = new LightTickScopePolicy(
    async () =>
      ({
        configValue: JSON.stringify({
          settings: { runtimeScope: full ? "full" : "core" },
        }),
      }) as any,
  );
  runtime.accountReports = new AccountReportService(
    repo,
    { add: async () => ({}) } as any,
    () => runtime.scopePolicy.assertFull(),
    () => new Date("2026-11-14T10:00:00Z"),
    async () =>
      summarizeAccountFacts({
        start: "2026-11-08",
        end: "2026-11-14",
        timezone: "UTC",
        snapshot_at: "2026-11-14T10:00:00Z",
        facts: [],
        action_minutes: 0,
        goal_minutes: 0,
      }),
  );
  const call = (
    method: string,
    path: string,
    body?: unknown,
    user = "user_alice",
  ) =>
    app.app.handle({
      method,
      path: "/api/v1/lighttick/account-reports" + path,
      body,
      headers: {
        "x-app-id": "lighttick",
        ...(user
          ? {
              authorization:
                "Bearer " +
                app.services.tokenService.issueAccessToken(user, "lighttick"),
            }
          : {}),
      },
    } as any);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const check = (name: string, value: unknown) => {
    const valid = ajv.compile(
      (contracts as any)["LightTickAccountReport" + name + "EnvelopeSchema"],
    );
    assert.equal(
      valid(JSON.parse(JSON.stringify(value))),
      true,
      JSON.stringify(valid.errors),
    );
  };
  assert.equal((await call("GET", "", undefined, "")).statusCode, 401);
  assert.equal(
    (
      await call("POST", "", {
        request_key: "api-report-invalid",
        period_days: 6,
        mode: "facts",
      })
    ).statusCode,
    400,
  );
  assert.equal(
    (
      await call("POST", "", {
        request_key: "api-report-invalid",
        period_days: 7,
        mode: "facts",
        retry_of: "",
      })
    ).statusCode,
    400,
  );
  const created = await call("POST", "", {
    request_key: "api-report-0001",
    period_days: 7,
    mode: "facts",
  });
  assert.equal(created.statusCode, 202);
  assert.equal(created.headers?.["Cache-Control"],"no-store");
  check("Detail", created.body);
  const row = created.body.data;
  const page = await call("GET", "");
  check("Page", page.body);
  assert.equal(page.body.data.total, 1);
  assert.equal(
    (
      await call("POST", "", {
        request_key: "api-report-ai-1",
        period_days: 7,
        mode: "ai",
      })
    ).statusCode,
    503,
  );
  full = true;
  const ai = await call("POST", "", {
    request_key: "api-report-ai-1",
    period_days: 7,
    mode: "ai",
  });
  assert.equal(ai.body.data.status, "queued");
  full = false;
  assert.equal(
    (
      await call("POST", "", {
        request_key: "api-report-ai-1",
        period_days: 7,
        mode: "ai",
      })
    ).body.data.id,
    ai.body.data.id,
  );
  assert.equal(
    (await call("POST", "/" + ai.body.data.id + "/cancel", { base_version: 1 }))
      .body.data.status,
    "cancelled",
  );
  assert.equal(
    (await call("GET", "/" + row.id, undefined, "user_bob")).statusCode,
    404,
  );
  assert.equal(
    (await call("DELETE", "/" + row.id, { base_version: 99 })).statusCode,
    409,
  );
  assert.equal(
    (await call("DELETE", "/" + row.id, { base_version: 1, unsupported: true }))
      .statusCode,
    400,
  );
  const deleted = await call("DELETE", "/" + row.id, { base_version: 1 });
  check("Detail", deleted.body);
  assert.equal(deleted.body.data.status, "deleted");
  assert.equal(deleted.body.data.facts, null);
  assert.equal(
    (await call("GET", "/requests/by-key/api-report-0001")).body.data.status,
    "deleted",
  );
  runtime.guestIdentity = {
    getActive: async () => ({ userId: "user_alice" }),
  } as any;
  assert.equal((await call("GET", "")).statusCode, 403);
});
