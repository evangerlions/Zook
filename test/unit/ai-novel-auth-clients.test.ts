import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("registered macOS providers preserve region policy and require the Apple secret", async () => {
  const runtime = await createApplication();
  try {
    const providers = runtime.app.identityAuth!.thirdParty;
    assert.deepEqual(await providers.capabilities("another_app"), []);
    assert.deepEqual(await providers.capabilities("ai_novel"), [
      { provider: "google", platforms: ["macos"], regions: ["GLOBAL"] },
    ]);
    await assert.rejects(providers.create({ appId: "ai_novel", provider: "google", purpose: "login", clientType: "app" },
      { platform: "macos", region: "CN" }), { code: "AUTH_PROVIDER_UNAVAILABLE" });
    await assert.rejects(providers.create({ appId: "ai_novel", provider: "apple", purpose: "login", clientType: "app" },
      { platform: "macos", region: "GLOBAL" }), { code: "AUTH_PROVIDER_UNAVAILABLE" });

    await runtime.services.commonPasswordConfigService.set("ainovel.auth.apple.private-key", "Test-only Apple key", "test-only-private-material");
    assert.deepEqual(await providers.capabilities("ai_novel"), [
      { provider: "google", platforms: ["macos"], regions: ["GLOBAL"] },
      { provider: "apple", platforms: ["macos"], regions: ["CN", "GLOBAL"] },
    ]);
    const authorization = await providers.create({ appId: "ai_novel", provider: "apple", purpose: "login", clientType: "app" },
      { platform: "macos", region: "GLOBAL" });
    assert.equal(authorization.parameters.clientId, "com.zhizhuokai.orangewrite");
    assert.ok(!JSON.stringify(authorization).includes("test-only-private-material"));
  } finally {
    await runtime.close();
  }
});
