import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { KVManager } from "../../src/infrastructure/kv/kv-manager.ts";

const url = process.env.AUTH_RECOVERY_TEST_DATABASE_URL;
const redis = process.env.AUTH_RECOVERY_TEST_REDIS_URL;
if (!url || !new URL(url).pathname.startsWith("/zook_auth_hardening_") || !redis)
  throw new Error("Dedicated AUTH_RECOVERY_TEST_DATABASE_URL and AUTH_RECOVERY_TEST_REDIS_URL are required.");

test("authentication recovery against PostgreSQL and Redis", async suite => {
  const run = Date.now().toString(36);
  let delivery: (email: string) => Promise<void> = async () => {};
  const boot = async () => createApplication({ frogsleepEnabled: true, queueBackend: "memory",
    kvManager: await KVManager.create({ redisUrl: redis }),
    databaseFactory: seed => PostgresDatabase.create(url!, seed), registrationCodeGenerator: () => "123456",
    registrationEmailSender: {
      async sendTemplateEmail() { return { provider: "tencent_ses" as const }; },
      async sendVerificationCode(command) { await delivery(command.email); return { provider: "tencent_ses" as const }; },
    },
  });
  const first = await boot(), second = await boot();
  const request = (runtime: typeof first, path: string, body: unknown) => runtime.app.handle({
    method: "POST", path: `/api/v1/auth/${path}`, headers: {}, body, ipAddress: "198.51.100.20",
  });
  const login = (runtime: typeof first) => runtime.services.authService.login({
    appId: "app_a", account: "alice@example.com", password: "Password1234",
  });
  try {
    await suite.test("provider delivery releases the database transaction across runtimes", async () => {
      let release!: () => void; let signal!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const started = new Promise<void>(resolve => { signal = resolve; });
      delivery = async () => { signal(); await pending; };
      const sending = request(first, "register/email-code", { appId: "app_a", email: `pg-wait-${run}@example.com` });
      await started;
      try {
        const result = await Promise.race([
          request(second, "login", { appId: "app_a", account: "alice@example.com", password: "Password1234", clientType: "app" }),
          new Promise<undefined>(resolve => setTimeout(resolve, 2000)),
        ]);
        assert.equal(result?.statusCode, 200);
      } finally { release(); await sending; delivery = async () => {}; }
    });

    await suite.test("HTTP registration rolls back on session-store failure and can retry the same code", async t => {
      const email = `pg-register-retry-${run}@example.com`;
      assert.equal((await request(first, "register/email-code", { appId: "app_a", email })).statusCode, 200);
      const failure = t.mock.method(first.services.refreshTokenStore, "create", async () => { throw new Error("temporary KV failure"); });
      const body = { appId: "app_a", email, password: "Password1234", emailCode: "123456", clientType: "app" };
      assert.equal((await request(first, "register", body)).statusCode, 500);
      assert.equal(await second.database.findUserByAccount(email), undefined);
      failure.mock.restore();
      assert.equal((await request(second, "register", body)).statusCode, 200);
    });

    await suite.test("HTTP refresh retries after a database read failure without burning the token", async t => {
      const session = await login(first);
      const failure = t.mock.method(first.database, "findUserById", async () => { throw new Error("temporary database failure"); });
      const body = { appId: "app_a", refreshToken: session.refreshToken, clientType: "app" };
      assert.equal((await request(first, "refresh", body)).statusCode, 500);
      failure.mock.restore();
      assert.equal((await request(second, "refresh", body)).statusCode, 200);
    });

    await suite.test("Redis rotation has exactly one winner across independent runtimes", async () => {
      const session = await login(first);
      const outcomes = await Promise.allSettled(Array.from({ length: 8 }, (_, index) =>
        [first, second][index % 2].services.authService.refresh({ appId: "app_a", refreshToken: session.refreshToken })));
      assert.equal(outcomes.filter(value => value.status === "fulfilled").length, 1);
    });

    await suite.test("parallel session writes preserve every Redis index entry", async () => {
      const store = first.services.refreshTokenStore;
      const before = await store.listByUserAndApp("app_a", "user_alice");
      const sessions = await Promise.all(Array.from({ length: 6 }, (_, index) => login([first, second][index % 2])));
      const after = await store.listByUserAndApp("app_a", "user_alice");
      assert.equal(after.length, before.length + sessions.length);
      await first.services.authService.logout({ appId: "app_a", scope: "all" },
        first.services.tokenService.verifyAccessToken(sessions[0].accessToken));
      for (const session of sessions) await assert.rejects(() => second.services.authService.refresh({
        appId: "app_a", refreshToken: session.refreshToken,
      }));
    });

    await suite.test("late failed delivery cannot erase a newer challenge", async () => {
      let fail!: () => void; let signal!: () => void;
      const pending = new Promise<void>((_resolve, reject) => { fail = () => reject(new Error("old delivery failed")); });
      const started = new Promise<void>(resolve => { signal = resolve; });
      let count = 0;
      delivery = async () => { if (++count === 1) { signal(); await pending; } };
      const command = { appId: "app_a", email: `pg-late-delivery-${run}@example.com`, ipAddress: "198.51.100.22", locale: "en", region: "ap-singapore" as const };
      const now = new Date(), later = new Date(now.getTime() + 61_000);
      const old = first.services.authService.registerEmailCode(command, now);
      const rejected = assert.rejects(old, /old delivery failed/);
      await started;
      await second.services.authService.registerEmailCode(command, later);
      fail(); await rejected; delivery = async () => {};
      const session = await second.services.authService.register({ ...command, password: "Password1234", emailCode: "123456" }, later);
      assert.ok(session.accessToken);
    });

    await suite.test("password change revokes old cross-app sessions across runtimes", async () => {
      const old = await second.services.authService.login({ appId: "app_b", account: "alice@example.com", password: "Password1234" });
      await first.services.authService.changePassword({ appId: "app_a", userId: "user_alice", currentPassword: "Password1234", newPassword: "Changed12345" });
      await assert.rejects(() => second.services.authService.assertAccessTokenActive(second.services.tokenService.verifyAccessToken(old.accessToken)));
      await assert.rejects(() => second.services.authService.refresh({ appId: "app_b", refreshToken: old.refreshToken }));
    });
  } finally {
    await first.close(); await second.close();
    await first.services.kvManager.disconnect(); await second.services.kvManager.disconnect();
  }
});
