import { test } from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { ParticipationService } from "../../src/modules/lighttick/participation/participation.service.ts";
const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (
  !dsn ||
  new URL(dsn).hostname !== "127.0.0.1" ||
  !new URL(dsn).pathname.startsWith("/grow_web_u1_participation_")
)
  throw Error("Dedicated local participation DB required");
const a = { appId: "lighttick", userId: "user_alice" },
  b = { appId: "lighttick", userId: "user_bob" },
  c = { appId: "lighttick", userId: "user_carol" };
test("invitations serialize creation/consumption, preserve original receipts, reject stale owners and never grant entitlement", async () => {
  await runPostgresMigrations({ connectionString: dsn, log: () => {} });
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool);
  let now = new Date("2026-11-01T00:00:00Z"),
    active = true;
  const identity = async (id: string) => ({
    active,
    joinedAt: id === a.userId ? "2026-10-01T00:00:00Z" : "2026-11-01T00:01:00Z",
    test: false,
  });
  const s = new ParticipationService(
    r,
    ["test-participation-signing-key"],
    identity,
    () => now,
  );
  try {
    for (const o of [a, b, c]) await r.deleteOwnerData(o);
    const created: any = await s.command(a, "invite-original", "create", {});
    assert.deepEqual(
      await s.command(a, "invite-original", "create", {}),
      created,
    );
    assert.equal((await s.read(a)).invitations.length, 1);
    const token = created.path.split("=")[1];
    now = new Date("2026-11-01T00:02:00Z");
    const claim = () => s.command(b, "accept-original", "accept", { token });
    const results = await Promise.all([claim(), claim()]);
    assert.deepEqual(results[0], results[1]);
    assert.equal((await s.read(a)).invitations[0].status, "used");
    assert.deepEqual(
      await s.command(b, "other-accept-key", "accept", { token }),
      { accepted: true },
    );
    await assert.rejects(
      s.command(c, "accept-other-user", "accept", { token }),
      { statusCode: 404 },
    );
    await assert.rejects(
      s.command(a, "revoke-used-key", "revoke", { id: created.invitation.id }),
      { statusCode: 409 },
    );
    await assert.rejects(
      s.command(a, "invite-original", "create", { reward: true }),
      { statusCode: 422 },
    );
    const next: any = await s.command(a, "next-invitation", "create", {});
    await assert.rejects(
      s.command(c, "tampered-token-key", "accept", {
        token: next.path.split("=")[1].slice(0, -1) + "x",
      }),
      { statusCode: 404 },
    );
    await assert.rejects(
      s.command(c, "revoke-foreign-key", "revoke", { id: next.invitation.id }),
      { statusCode: 404 },
    );
    await s.command(a, "revoke-original", "revoke", { id: next.invitation.id });
    assert.equal((await s.read(a)).invitations[0].status, "revoked");
    await assert.rejects(
      s.command(c, "accept-revoked-key", "accept", {
        token: next.path.split("=")[1],
      }),
      { statusCode: 404 },
    );
    await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        s.command(a, "bulk-invitation-" + i, "create", {}),
      ),
    );
    await assert.rejects(s.command(a, "over-limit-key", "create", {}), {
      statusCode: 429,
    });
    assert.equal(
      (await s.read(a)).invitations.filter((i) => i.status === "active").length,
      20,
    );
    active = false;
    await assert.rejects(claim(), { statusCode: 403 });
    active = true;
    assert.equal((await r.getUserSubscription(b))?.planId ?? "free", "free");
  } finally {
    for (const o of [a, b, c]) await r.deleteOwnerData(o);
    await pool.end();
  }
});
test("trial freezes timezone and calendar window, validates explicit consent, preserves versioned feedback, and rolls back failed receipts", async () => {
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool);
  let now = new Date("2026-03-02T23:30:00Z"),
    testAccount = false;
  const identity = async () => ({
      active: true,
      joinedAt: "2026-03-01T00:00:00Z",
      test: testAccount,
    }),
    s = new ParticipationService(r, ["trial-test-key"], identity, () => now);
  try {
    await r.deleteOwnerData(a);
    assert.equal((await s.read(a)).trial, null);
    await assert.rejects(
      s.command(a, "no-consent-key", "enroll", {
        timezone: "America/New_York",
        consent: false,
      }),
      { statusCode: 422 },
    );
    testAccount = true;
    await assert.rejects(
      s.command(a, "test-enroll-key", "enroll", {
        timezone: "UTC",
        consent: true,
      }),
      { statusCode: 403 },
    );
    testAccount = false;
    const original: any = await s.command(a, "enroll-original", "enroll", {
      timezone: "America/New_York",
      consent: true,
    });
    const later: any = await s.command(a, "enroll-repeat-key", "enroll", {
      timezone: "Asia/Shanghai",
      consent: true,
    });
    assert.deepEqual(later, original);
    const body = { day: 7, version: 1, clarity_score: 5, progress_score: 2 };
    await assert.rejects(s.command(a, "early-survey-key", "survey", body), {
      statusCode: 409,
    });
    now = new Date("2026-03-08T05:00:00Z");
    const save = r.saveOperation.bind(r);
    r.saveOperation = async () => {
      throw Error("lost receipt storage");
    };
    await assert.rejects(
      s.command(a, "survey-original", "survey", body),
      /lost receipt storage/,
    );
    assert.equal((await s.read(a)).trial?.version, 1);
    r.saveOperation = save;
    const result = await s.command(a, "survey-original", "survey", body);
    assert.deepEqual(
      await s.command(a, "survey-original", "survey", body),
      result,
    );
    await assert.rejects(s.command(a, "stale-survey-key", "survey", body), {
      statusCode: 409,
    });
    await s.command(a, "update-survey-key", "survey", {
      ...body,
      version: 2,
      progress_score: 4,
    });
    now = new Date("2026-03-15T04:00:00Z");
    await s.command(a, "day14-survey-key", "survey", {
      ...body,
      day: 14,
      version: 3,
    });
    const read = await s.read(a);
    assert.equal(read.trial?.surveys["7"].length, 2);
    assert.equal(read.trial?.surveys["14"].length, 1);
    assert.equal(read.trial?.window.mature, false);
    now = new Date("2026-03-16T04:00:00Z");
    assert.equal((await s.read(a)).trial?.window.mature, true);
    await r.deleteOwnerData(a);
    assert.equal((await s.read(a)).trial, null);
  } finally {
    await r.deleteOwnerData(a);
    await pool.end();
  }
});
test("canonical HTTP registration keeps failed verification from consuming invitation, preserves cookies and owner isolation", async () => {
  const { createApplication } =
    await import("../support/create-test-application.ts");
  const { buildDefaultSeed } =
    await import("../../src/infrastructure/database/prisma/default-seed.ts");
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    seed = buildDefaultSeed(undefined, { includeLightTick: true });
  seed.appUsers.push({
    ...a,
    id: "participation-api-alice",
    status: "ACTIVE",
    accountRegion: "CN",
    joinedAt: new Date(Date.now() - 86400000).toISOString(),
  });
  const app = await createApplication({
    seed,
    lighttickEnabled: true,
    lighttickRepository: r,
    registrationCodeGenerator: () => "246813",
    registrationEmailSender: {
      async sendTemplateEmail() {
        return { provider: "tencent_ses" };
      },
      async sendVerificationCode() {
        return { provider: "tencent_ses" };
      },
    },
  });
  const token = app.services.tokenService.issueAccessToken(
    a.userId,
    "lighttick",
  );
  const call = (
    path: string,
    body: any,
    access = token,
    key = "api-original-key",
  ) =>
    app.app.handle({
      method: "POST",
      path: "/api/v1/" + path,
      headers: {
        "x-app-id": "lighttick",
        authorization: "Bearer " + access,
        "idempotency-key": key,
      },
      body,
      ipAddress: "127.0.0.1",
    } as any);
  let recipient: any;
  try {
    await r.deleteOwnerData(a);
    const invite: any = await call("lighttick/participation/create", {});
    assert.equal(invite.statusCode, 200);
    assert.equal(invite.headers["Cache-Control"], "no-store");
    const secret = invite.body.data.path.split("=")[1];
    const email = "participation-new@example.test";
    assert.equal(
      (await call("auth/register/email-code", { appId: "lighttick", email }))
        .statusCode,
      200,
    );
    assert.equal(
      (
        await call("auth/register", {
          appId: "lighttick",
          email,
          password: "Password12345",
          emailCode: "000000",
          clientType: "web",
        })
      ).statusCode,
      401,
    );
    assert.equal(
      (await app.services.lighttickRuntime.participation!.read(a))
        .invitations[0].status,
      "active",
    );
    const registered: any = await call("auth/register", {
      appId: "lighttick",
      email,
      password: "Password12345",
      emailCode: "246813",
      clientType: "web",
    });
    assert.equal(registered.statusCode, 200, JSON.stringify(registered.body));
    assert.ok(registered.headers["Set-Cookie"]);
    recipient = { appId: "lighttick", userId: registered.body.data.user.id };
    const access = registered.body.data.accessToken;
    assert.equal(
      (
        await call(
          "lighttick/participation/accept",
          { token: secret },
          access,
          "api-accept-original",
        )
      ).statusCode,
      200,
    );
    assert.equal(
      (await app.services.lighttickRuntime.participation!.read(a))
        .invitations[0].status,
      "used",
    );
    const data: any = await call(
      "lighttick/participation/enroll",
      { timezone: "Asia/Shanghai", consent: true },
      access,
      "api-enroll-original",
    );
    assert.equal(data.statusCode, 200);
    const config = JSON.parse(
      (await app.services.appConfigService.getValue(
        "lighttick",
        "admin.delivery_config",
      ))!,
    );
    config.settings.runtimeScope = "core";
    await app.services.appConfigService.setValue(
      "lighttick",
      "admin.delivery_config",
      JSON.stringify(config),
    );
    assert.deepEqual(
      (
        await call(
          "lighttick/participation/enroll",
          { timezone: "Asia/Shanghai", consent: true },
          access,
          "api-enroll-original",
        )
      ).body.data,
      data.body.data,
    );
    const { default: Ajv } = await import("ajv/dist/2020.js");
    const { default: addFormats } = await import("ajv-formats");
    const schemas =
      await import("../../src/generated/openapi/public-contracts.generated.ts");
    const ajv = new Ajv({ strict: false });
    addFormats(ajv);
    for (const [name, res] of [
      ["Create", invite],
      ["Enroll", data],
    ] as const) {
      const check = ajv.compile(
        (schemas as any)["LightTickParticipation" + name + "EnvelopeSchema"],
      );
      assert.ok(
        check(JSON.parse(JSON.stringify(res.body))),
        JSON.stringify(check.errors),
      );
    }
    assert.equal(
      (await r.getUserSubscription(recipient))?.planId ?? "free",
      "free",
    );
  } finally {
    await r.deleteOwnerData(a);
    if (recipient) await r.deleteOwnerData(recipient);
    await pool.end();
  }
});
test("different recipients cannot race a single invitation; expiry, old membership and inactive inviter fail closed", async () => {
  const pool = new Pool({ connectionString: dsn }),
    r = new PostgresLightTickRepository(pool),
    old = { appId: "lighttick", userId: "old_member" };
  let now = new Date("2026-11-01T00:00:00Z"),
    inviterActive = true;
  const s = new ParticipationService(
    r,
    ["race-test-key"],
    async (id) => ({
      active: id !== a.userId || inviterActive,
      joinedAt: [a.userId, old.userId].includes(id)
        ? "2026-10-01T00:00:00Z"
        : "2026-11-01T00:01:00Z",
      test: false,
    }),
    () => now,
  );
  try {
    for (const o of [a, b, c, old]) await r.deleteOwnerData(o);
    const x: any = await s.command(a, "race-create-key", "create", {}),
      token = x.path.split("=")[1];
    now = new Date("2026-11-01T00:02:00Z");
    await assert.rejects(
      s.command(old, "old-member-accept", "accept", { token }),
      { statusCode: 403 },
    );
    inviterActive = false;
    await assert.rejects(
      s.command(b, "inactive-inviter-accept", "accept", { token }),
      { statusCode: 404 },
    );
    inviterActive = true;
    const race = await Promise.allSettled([
      s.command(b, "race-user-b-key", "accept", { token }),
      s.command(c, "race-user-c-key", "accept", { token }),
    ]);
    assert.equal(race.filter((x) => x.status === "fulfilled").length, 1);
    assert.equal((await s.read(a)).invitations[0].status, "used");
    const next: any = await s.command(a, "expired-create-key", "create", {});
    now = new Date("2026-11-09T00:00:00Z");
    assert.equal(
      (await s.read(a)).invitations.find((i) => i.id === next.invitation.id)
        ?.status,
      "expired",
    );
    await assert.rejects(
      s.command(old, "expired-accept-key", "accept", {
        token: next.path.split("=")[1],
      }),
      { statusCode: 404 },
    );
  } finally {
    for (const o of [a, b, c, old]) await r.deleteOwnerData(o);
    await pool.end();
  }
});
