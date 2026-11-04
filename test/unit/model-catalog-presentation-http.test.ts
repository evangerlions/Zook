import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsHttpRuntime } from "../support/credits-http-runtime.ts";

test("versioned app configuration reaches the authenticated model directory over HTTP", async () => {
  const fixture = await startCreditsHttpRuntime();
  try {
    const metadata = { modelKey: "manual-fixture", label: "Display model", description: "Model introduction", badge: "Preview",
      localIcon: "kimi", onlineIcon: "https://cdn.example.com/icon.png", sortOrder: -1 };
    await fixture.runtime.services.aiNovelModelSelectionConfigService.updateConfig({
      schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] }, catalog: [metadata],
    });
    const read = async () => {
      const response = await fetch(fixture.url + "/api/v1/ai_novel/models", {
        headers: { authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel" },
      });
      assert.equal(response.status, 200);
      return (await response.json()).data.models;
    };
    const rows = await read();
    assert.equal(rows[0].key, "manual-fixture");
    for (const field of ["label", "description", "badge", "localIcon", "onlineIcon"] as const) {
      assert.equal(rows[0][field], metadata[field]);
    }
    assert.equal(rows[0].inputMultiplier, 2);
    await fixture.runtime.services.aiNovelModelSelectionConfigService.updateConfig({
      schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] }, catalog: [{ ...metadata, enabled: false }],
    });
    assert.deepEqual((await read()).map((row: { key: string }) => row.key), ["qwen3.6-plus"]);
    assert.equal(fixture.calls(), 0);
  } finally { await fixture.close(); }
});
