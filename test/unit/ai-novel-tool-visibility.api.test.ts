import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";
import { JOB_FORCED_TOOLS } from "../../src/modules/ai-novel/prompts/ai-novel-system-prompts.ts";

type Fixture = Awaited<ReturnType<typeof startCreditsHttpRuntime>>;

async function request(f: Fixture, stream: boolean, version?: string, protocol: string | null = "pi-v1", sceneKey = "chapter_summary") {
  const response = await fetch(`${f.url}/api/v1/ai_novel/ai/chat-completions`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${f.token}`, "X-App-Id": "ai_novel", "Content-Type": "application/json",
      ...(version === undefined ? {} : { "X-App-Version": version }),
    },
    body: JSON.stringify(encryptCreditsFixture({
      sceneKey, stream, ...(protocol ? { agentProtocol: protocol } : {}),
      messages: [{ role: "user", content: "visibility-fixture" }],
      context: { suppliedTools: ["match", "read_lines", "preview_chapters", "submit_chapters"], appVersion: "99.0.0" },
    })),
  });
  const text = await response.text();
  const records = text.includes("data: ")
    ? text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => decodeCreditsFixture(JSON.parse(line.slice(6))))
    : [decodeCreditsFixture(JSON.parse(text))];
  return records.map((record) => record.data ?? record);
}

async function fixture() {
  const f = await startCreditsHttpRuntime();
  await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig({
    schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] }, autoFree: { enabled: true },
  });
  return f;
}


for (const stream of [false, true]) {
  test(`HTTP header controls required-tool version range (stream=${stream})`, async () => {
    const f = await fixture();
    const original = JOB_FORCED_TOOLS.chapter_summary!;
    JOB_FORCED_TOOLS.chapter_summary = { ...original, visibility: { minAppVersion: "1.8.0", maxAppVersion: "1.9.0" } };
    try {
      for (const version of [undefined, "invalid", "1.7.99", "1.9.1"]) {
        const records = await request(f, stream, version);
        assert.ok(records.some(record => record.code === "REQ_INVALID_BODY"), String(version));
      }
      assert.equal(f.calls(), 0, "context.appVersion cannot bypass header bounds");
      const records = await request(f, stream, "1.8.0+1080000");
      // The existing streaming-only double omits the forced result tool on completion.
      // Its upstream-format error proves the valid header reached the provider.
      assert.ok(records.some(record => stream ? record.type === "done" : record.code === "AI_UPSTREAM_RESPONSE_INVALID"), JSON.stringify(records));
      assert.equal(f.calls(), stream ? 1 : 2);
    } finally {
      JOB_FORCED_TOOLS.chapter_summary = original;
      await f.close(); await f.runtime.close();
    }
  });
}
