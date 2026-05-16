import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../../src/app.module.ts";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";

test("createApplication resolves the migration database url before postgres bootstrap", async () => {
  const originalDirectUrl = process.env.DIRECT_URL;
  const originalDatabaseUrl = process.env.DATABASE_URL;
  const postgresDatabaseClass = PostgresDatabase as typeof PostgresDatabase & {
    create: typeof PostgresDatabase.create;
  };
  const originalCreate = postgresDatabaseClass.create;
  let receivedConnectionString: string | undefined;
  let receivedMigrationConnectionString: string | undefined;

  process.env.DIRECT_URL = "postgresql://migrator:secret@127.0.0.1:5432/zook_dev?schema=public";
  delete process.env.DATABASE_URL;
  postgresDatabaseClass.create = async (connectionString, seed, options = {}) => {
    receivedConnectionString = connectionString;
    receivedMigrationConnectionString = options.migrationConnectionString;
    return new InMemoryDatabase(seed) as unknown as PostgresDatabase;
  };

  try {
    const runtime = await createApplication({
      databaseUrl: "postgresql://app:secret@127.0.0.1:5432/zook_dev?schema=public",
      queueBackend: "memory",
    });

    assert.ok(runtime.database);
    assert.equal(
      receivedConnectionString,
      "postgresql://app:secret@127.0.0.1:5432/zook_dev?schema=public",
    );
    assert.equal(
      receivedMigrationConnectionString,
      "postgresql://migrator:secret@127.0.0.1:5432/zook_dev?schema=public",
    );
  } finally {
    postgresDatabaseClass.create = originalCreate;
    if (originalDirectUrl === undefined) {
      delete process.env.DIRECT_URL;
    } else {
      process.env.DIRECT_URL = originalDirectUrl;
    }

    if (originalDatabaseUrl === undefined) {
      delete process.env.DATABASE_URL;
    } else {
      process.env.DATABASE_URL = originalDatabaseUrl;
    }
  }
});

test("api health exposes the current runtime version", async () => {
  const previousVersion = process.env.APP_VERSION;
  process.env.APP_VERSION = "20260412_002";

  try {
    const runtime = await createApplication({
      queueBackend: "memory",
      databaseFactory: (seed) => new InMemoryDatabase(seed),
    });

    const response = await runtime.app.handle({
      method: "GET",
      path: "/api/health",
      headers: {},
      requestId: "req_health_version",
    } as never);

    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.body.data, {
      status: "ok",
      version: "20260412_002",
    });
  } finally {
    if (previousVersion === undefined) {
      delete process.env.APP_VERSION;
    } else {
      process.env.APP_VERSION = previousVersion;
    }
  }
});

test("createApplication resolves sms sender credentials from common password workspace", async () => {
  const previousSmsSdkAppId = process.env.TENCENT_SMS_SDK_APP_ID;
  const previousSmsTemplateId = process.env.TENCENT_SMS_TEMPLATE_ID;
  const previousSmsSignName = process.env.TENCENT_SMS_SIGN_NAME;
  const previousCaptchaAppId = process.env.TENCENT_CAPTCHA_APP_ID;
  const previousCaptchaAppSecret = process.env.TENCENT_CAPTCHA_APP_SECRET_KEY;
  const previousAccessTokenSecret = process.env.AUTH_ACCESS_TOKEN_SECRET;
  const previousFetch = globalThis.fetch;

  process.env.TENCENT_SMS_SDK_APP_ID = "1400849632";
  process.env.TENCENT_SMS_TEMPLATE_ID = "1907577";
  process.env.TENCENT_SMS_SIGN_NAME = "智卓凯科技";
  process.env.TENCENT_CAPTCHA_APP_ID = "197005223";
  process.env.TENCENT_CAPTCHA_APP_SECRET_KEY = "captcha-app-secret";
  process.env.AUTH_ACCESS_TOKEN_SECRET = "integration-secret-for-sms-sender";

  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const passwordManager = new PasswordManager(kvManager);
  await passwordManager.set("common-passwords", "tencent.secret_id", "Tencent Secret ID", "shared-secret-id");
  await passwordManager.set("common-passwords", "tencent.secret_key", "Tencent Secret Key", "shared-secret-key");

  let capturedAuthorization = "";
  let capturedBody = "";
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedAuthorization = String((init?.headers as Record<string, string>).Authorization ?? "");
    capturedBody = String(init?.body ?? "");
    return new Response(JSON.stringify({
      Response: {
        RequestId: "req_sms_password_workspace",
        SendStatusSet: [
          {
            SerialNo: "serial_sms_password_workspace",
            Code: "Ok",
            Message: "send success",
          },
        ],
      },
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }) as typeof fetch;

  try {
    const runtime = await createApplication({
      kvManager,
      serviceName: "api",
      databaseFactory: (seed) => new InMemoryDatabase(seed),
    });

    const result = await runtime.services.smsVerificationSender.sendVerificationCode({
      phoneNumber: "18710100985",
      code: "123456",
      expireMinutes: 10,
    });

    assert.equal(result.requestId, "req_sms_password_workspace");
    assert.match(capturedAuthorization, /^TC3-HMAC-SHA256 Credential=shared-secret-id\//);
    const parsedBody = JSON.parse(capturedBody) as Record<string, unknown>;
    assert.equal(parsedBody.SignName, "智卓凯科技");
    assert.equal(parsedBody.SmsSdkAppId, "1400849632");
    assert.equal(parsedBody.TemplateId, "1907577");
  } finally {
    globalThis.fetch = previousFetch;

    if (previousSmsSdkAppId === undefined) {
      delete process.env.TENCENT_SMS_SDK_APP_ID;
    } else {
      process.env.TENCENT_SMS_SDK_APP_ID = previousSmsSdkAppId;
    }

    if (previousSmsTemplateId === undefined) {
      delete process.env.TENCENT_SMS_TEMPLATE_ID;
    } else {
      process.env.TENCENT_SMS_TEMPLATE_ID = previousSmsTemplateId;
    }

    if (previousSmsSignName === undefined) {
      delete process.env.TENCENT_SMS_SIGN_NAME;
    } else {
      process.env.TENCENT_SMS_SIGN_NAME = previousSmsSignName;
    }

    if (previousCaptchaAppId === undefined) {
      delete process.env.TENCENT_CAPTCHA_APP_ID;
    } else {
      process.env.TENCENT_CAPTCHA_APP_ID = previousCaptchaAppId;
    }

    if (previousCaptchaAppSecret === undefined) {
      delete process.env.TENCENT_CAPTCHA_APP_SECRET_KEY;
    } else {
      process.env.TENCENT_CAPTCHA_APP_SECRET_KEY = previousCaptchaAppSecret;
    }

    if (previousAccessTokenSecret === undefined) {
      delete process.env.AUTH_ACCESS_TOKEN_SECRET;
    } else {
      process.env.AUTH_ACCESS_TOKEN_SECRET = previousAccessTokenSecret;
    }
  }
});
