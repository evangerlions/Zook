import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";
import { JOB_FORCED_TOOLS } from "../../src/modules/ai-novel/prompts/ai-novel-system-prompts.ts";
import { SUBMIT_CHAPTERS_TOOL } from "../../src/modules/ai-novel/prompts/import-chapter-segmentation.ts";

type Fixture = Awaited<ReturnType<typeof startCreditsHttpRuntime>>;

async function request(f: Fixture, stream: boolean, version?: string, protocol: string | null = "pi-v1", sceneKey = "import_chapter_segmentation") {
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
  await f.runtime.services.appConfigService.setValue("ai_novel", "ai_novel.import_chapter_segmentation", JSON.stringify({ modelKey: "qwen3.6-plus" }));
  await f.runtime.services.aiNovelModelSelectionConfigService.updateConfig({
    schemaVersion: 1, chat: { default: [{ modelKey: "qwen3.6-plus", weight: 100 }] }, autoFree: { enabled: true },
  });
  return f;
}

for (const stream of [false, true]) {
  test(`HTTP version header gates chapter tools before provider use (stream=${stream})`, async () => {
    const f = await fixture();
    try {
      for (const version of [undefined, "invalid", "1.7.99"]) {
        const records = await request(f, stream, version);
        assert.ok(records.some((record) => record.code === "REQ_INVALID_BODY"), String(version));
      }
      const legacy = await request(f, stream, "1.8.0", null);
      assert.ok(legacy.some((record) => record.code === "REQ_INVALID_BODY"));
      assert.equal(f.calls(), 0, "neither suppliedTools nor context.appVersion bypasses the header gate");
      for (const version of ["1.8.0", "1.8.0+1080000", "1.10.0"]) {
        const records = await request(f, stream, version);
        assert.ok(records.some((record) => stream ? record.type === "done" : record.completion), JSON.stringify(records));
      }
      assert.equal(f.calls(), 3);
      const wire = f.observedToolDefinitions()[0] as Array<{ function: { name: string } }>;
      assert.deepEqual(wire.map((tool) => tool.function.name), ["match", "read_lines", "preview_chapters", "submit_chapters"]);
      assert.doesNotMatch(JSON.stringify(wire), /visibility|minAppVersion|agentProtocol/);
    } finally { await f.close(); await f.runtime.close(); }
  });
}

test("hidden required output tools are rejected without starting an upstream request", async () => {
  const f = await fixture();
  const original = JOB_FORCED_TOOLS.chapter_summary!;
  try {
    JOB_FORCED_TOOLS.chapter_summary = { ...original, visibility: { minAppVersion: "1.8.0" } };
    for (const stream of [false, true]) {
      const records = await request(f, stream, "1.7.1", "pi-v1", "chapter_summary");
      assert.ok(records.some((record) => record.code === "REQ_INVALID_BODY"));
    }
    assert.equal(f.calls(), 0);
  } finally {
    JOB_FORCED_TOOLS.chapter_summary = original;
    await f.close(); await f.runtime.close();
  }
});

test("inclusive maximum version gates both HTTP paths before provider use", async () => {
  const f = await fixture();
  const original = SUBMIT_CHAPTERS_TOOL.visibility;
  try {
    SUBMIT_CHAPTERS_TOOL.visibility = { ...original, maxAppVersion: "1.8.0" };
    for (const stream of [false, true]) {
      const callsBefore = f.calls();
      const rejected = await request(f, stream, "1.8.1");
      assert.ok(rejected.some((record) => record.code === "REQ_INVALID_BODY"));
      assert.equal(f.calls(), callsBefore);
      const accepted = await request(f, stream, "1.8.0+1080099");
      assert.ok(accepted.some((record) => stream ? record.type === "done" : record.completion));
      assert.equal(f.calls(), callsBefore + 1);
    }
    assert.doesNotMatch(JSON.stringify(f.observedToolDefinitions()), /visibility|maxAppVersion/);
  } finally {
    SUBMIT_CHAPTERS_TOOL.visibility = original;
    await f.close(); await f.runtime.close();
  }
});
