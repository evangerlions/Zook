import assert from "node:assert/strict";
import test from "node:test";
import { InMemoryCache } from "../../src/infrastructure/cache/redis/in-memory-cache.ts";
import { InMemoryKVBackend, KVManager } from "../../src/infrastructure/kv/kv-manager.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { VersionedAppConfigService } from "../../src/services/versioned-app-config.service.ts";
import {
  CommonEmailConfigService,
  TENCENT_SECRET_ID_PASSWORD_KEY,
  TENCENT_SECRET_KEY_PASSWORD_KEY,
} from "../../src/services/common-email-config.service.ts";
import { CommonPasswordConfigService } from "../../src/services/common-password-config.service.ts";
import { PasswordManager } from "../../src/services/password-manager.ts";
import { TencentSesRegistrationEmailSender } from "../../src/services/tencent-ses-registration-email.service.ts";

test("verification emails append the code into the subject line", async () => {
  const kvManager = await KVManager.create({ backend: new InMemoryKVBackend() });
  const database = new InMemoryDatabase();
  const appConfigService = new VersionedAppConfigService(database, new InMemoryCache(), kvManager);
  const passwordManager = new PasswordManager(kvManager);
  const commonPasswordConfigService = new CommonPasswordConfigService(passwordManager);
  const commonEmailConfigService = new CommonEmailConfigService(appConfigService, commonPasswordConfigService);

  await commonPasswordConfigService.set(TENCENT_SECRET_ID_PASSWORD_KEY, "Tencent SecretId", "sid-demo");
  await commonPasswordConfigService.set(TENCENT_SECRET_KEY_PASSWORD_KEY, "Tencent SecretKey", "sk-demo");
  await appConfigService.setValue(
    "common",
    "common.email_service_regions",
    JSON.stringify({
      enabled: true,
      regions: [
        {
          region: "ap-guangzhou",
          sender: {
            id: "default",
            address: "noreply@example.com",
          },
          templates: [
            {
              locale: "zh-CN",
              templateId: 100001,
              name: "verify-code",
              subject: "验证码",
            },
          ],
        },
      ],
    }),
    "seed-email-service",
  );

  const previousFetch = globalThis.fetch;
  let capturedBody: Record<string, unknown> | undefined;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    capturedBody = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
    return new Response(JSON.stringify({
      Response: {
        RequestId: "req-ses-001",
        MessageId: "msg-ses-001",
      },
    }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
      },
    });
  }) as typeof fetch;

  try {
    const sender = new TencentSesRegistrationEmailSender(commonEmailConfigService);
    const result = await sender.sendVerificationCode({
      appName: "应用 A",
      email: "alice@example.com",
      code: "123456",
      locale: "zh-CN",
      region: "ap-guangzhou",
      expireMinutes: 10,
      templateName: "verify-code",
    });

    assert.equal(result.requestId, "req-ses-001");
    assert.equal(capturedBody?.Subject, "验证码 - 123456");
  } finally {
    globalThis.fetch = previousFetch;
  }
});
