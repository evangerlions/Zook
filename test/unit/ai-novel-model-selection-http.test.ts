import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";

test("authenticated HTTP catalog and encrypted manual requests route and charge actual model", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "zook-model-selection-http-"));
  const previousRoot = process.env.ZOOK_LOG_DIR, previousLogs = process.env.ZOOK_LOCAL_FILE_LOGS;
  process.env.ZOOK_LOG_DIR = logRoot;
  process.env.ZOOK_LOCAL_FILE_LOGS = "1";
  const fixture = await startCreditsHttpRuntime();
  const headers = { authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel", "Content-Type": "application/json" };
  const catalogUrl = fixture.url + "/api/v1/ai_novel/models";
  const send = async (modelSelection?: unknown) => {
    const response = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", { headers, method: "POST", body: JSON.stringify(encryptCreditsFixture({
      sceneKey: "write_turn", agentProtocol: "pi-v1", stream: true,
      messages: [{ role: "user", content: "write" }], ...(modelSelection === undefined ? {} : { modelSelection }),
    })) });
    const text = await response.text();
    const events = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => decodeCreditsFixture(JSON.parse(line.slice(6)))).map((event) => event.data ?? event);
    return { status: response.status, events };
  };
  try {
    assert.equal((await fetch(catalogUrl)).status, 401);
    const response = await fetch(catalogUrl, { headers });
    assert.equal(response.status, 200);
    const catalog = await response.json();
    assert.deepEqual(catalog.data.models.map((model: { key: string }) => model.key), ["manual-fixture", "qwen3.6-plus"]);
    assert.equal(catalog.data.models[0].cachedInputMultiplier, 0.2);
    assert.ok(!JSON.stringify(catalog.data).includes("apiKey"));
    assert.equal(((await send({ mode: "manual", modelKey: "manual-fixture" })).events.at(-1) as { type?: string } | undefined)?.type, "done");
    assert.deepEqual(fixture.observedModels(), ["manual-fixture"]);
    const balance = await fetch(fixture.url + "/api/v1/ai_novel/credits", { headers }).then((r) => r.json());
    assert.equal(balance.data.remainingMicros, 17_200_000);
    await send();
    assert.deepEqual(fixture.observedModels(), ["manual-fixture", "qwen3.6-plus"]);
    const calls = fixture.calls();
    const denied = await send({ mode: "manual", modelKey: "unknown" });
    assert.equal(fixture.calls(), calls);
    assert.ok(denied.status >= 400 || denied.events.some((event: any) => event.code === "AI_MODEL_NOT_AVAILABLE"));
    const latest = JSON.parse(await readFile(join(logRoot, "api/latest.json"), "utf8"));
    const logs = await readFile(latest.path, "utf8");
    assert.match(logs, /AINovel credits call settled/);
    assert.match(logs, /manual-fixture/);
    console.log(JSON.stringify({ evidence: "model-selection-http", pid: process.pid, url: fixture.url, logFile: latest.path, selectedModels: fixture.observedModels(), providerCalls: fixture.calls() }));
  } finally {
    await fixture.close();
    if (previousRoot === undefined) delete process.env.ZOOK_LOG_DIR; else process.env.ZOOK_LOG_DIR = previousRoot;
    if (previousLogs === undefined) delete process.env.ZOOK_LOCAL_FILE_LOGS; else process.env.ZOOK_LOCAL_FILE_LOGS = previousLogs;
  }
});
