import assert from "node:assert/strict";
import test from "node:test";
import { inBillingEnvironment } from "../../src/modules/billing/billing-environment.ts";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";

test("online review streams settle in sandbox while a concurrent Web request uses production", async () => {
  const f = await startCreditsHttpRuntime(0, "online");
  try {
    const admin = f.runtime.services.adminConsoleService;
    const config = JSON.parse((await admin.getConfig("ai_novel")).rawJson);
    config.billing = { ...config.billing, revenueCat: { sandboxAppUserIds: ["user_alice"] } };
    await admin.updateConfig("ai_novel", JSON.stringify(config));
    await inBillingEnvironment("sandbox", () => f.runtime.database.upsertAiNovelBillingMembership({
      appId: "ai_novel", userId: "user_alice", active: true, state: "active", tier: "plus", planKey: "plus_yearly",
      expiresAt: "2099-01-01T00:00:00Z", autoRenew: true, source: "app_store", managementUrl: null,
      lastSyncedAt: new Date().toISOString(), accountDeletedAt: null,
      creditWindowAnchorAt: "2026-09-23T00:00:00Z",
    }));
    const headers = (platform: string) => ({ authorization: `Bearer ${f.token}`, "X-App-Id": "ai_novel", "X-Platform": platform,
      "X-App-Version": "1.7.0+1070000", "Content-Type": "application/json", "X-Billing-Environment": "production" });
    const balance = async (platform: string) => {
      const response = await fetch(f.url + "/api/v1/ai_novel/credits", { headers: headers(platform) });
      assert.equal(response.status, 200);
      return (await response.json()).data.remainingMicros as number;
    };
    const chat = async (platform: string) => {
      const response = await fetch(f.url + "/api/v1/ai_novel/ai/chat-completions", {
        method: "POST", headers: headers(platform), body: JSON.stringify(encryptCreditsFixture({
          sceneKey: "write_turn", agentProtocol: "pi-v1", modelSelection: { mode: "auto" },
          messages: [{ role: "user", content: "write" }], stream: true,
        })),
      });
      assert.equal(response.status, 200);
      const events = (await response.text()).split("\n").filter(line => line.startsWith("data: "))
        .map(line => decodeCreditsFixture(JSON.parse(line.slice(6))));
      assert.equal((events.at(-1)?.data as { type?: string })?.type, "done");
    };
    const beforeSandbox = await balance("ios"), beforeProduction = await balance("web");
    await chat("ios");
    assert.equal(await balance("ios"), beforeSandbox - 1_400_000);
    assert.equal(await balance("web"), beforeProduction);
    await Promise.all([chat("ios"), chat("web")]);
    assert.equal(await balance("ios"), beforeSandbox - 2_800_000);
    assert.equal(await balance("web"), beforeProduction - 1_400_000);
  } finally { await f.close(); await f.runtime.close(); }
});
