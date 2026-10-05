import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";

test("fresh HTTP settles successful calls without client confirmation; failures and disconnects stay free", async () => {
  const logRoot = await mkdtemp(join(tmpdir(), "zook-credits-http-"));
  const previousLogs = process.env.ZOOK_LOCAL_FILE_LOGS;
  const previousRoot = process.env.ZOOK_LOG_DIR;
  process.env.ZOOK_LOCAL_FILE_LOGS = "1";
  process.env.ZOOK_LOG_DIR = logRoot;
  const fixture = await startCreditsHttpRuntime();
  const headers = { authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel", "Content-Type": "application/json", "Accept-Language": "zh-CN" };
  const api = async (path: string, body?: object) => {
    const response = await fetch(fixture.url + "/api/v1/ai_novel/" + path, { headers, method: body ? "POST" : "GET", ...(body ? { body: JSON.stringify(body) } : {}) });
    return { status: response.status, ...await response.json() };
  };
  const chat = async (jobId: string, content = "write") => {
    const response = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", { headers, method: "POST", body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1", messages: [{ role: "user", content }], context: { billingJobId: jobId }, stream: true })) });
    const text = await response.text();
    const events = text.split("\n").filter((line) => line.startsWith("data: ")).map((line) => decodeCreditsFixture(JSON.parse(line.slice(6)))).map((event) => event.data ?? event);
    return { status: response.status, events };
  };
  try {
    assert.equal((await fetch(fixture.url + "/api/v1/ai_novel/credits", { headers: { "X-App-Id": "ai_novel" } })).status, 401);
    assert.equal((await api("credits")).data.remainingMicros, 20_000_000);

    const first = await chat("client-choice-ignored");
    assert.equal(first.status, 200);
    assert.ok(first.events.some((event: any) => event.type === "content_delta"));
    assert.equal((first.events.at(-1) as any).type, "done");
    assert.equal((await api("credits")).data.remainingMicros, 18_600_000);
    // Same client ID cannot waive cost, collide with accounting or defer settlement.
    await chat("client-choice-ignored");
    assert.equal((await api("credits")).data.remainingMicros, 17_200_000);
    for (const outcome of ["success", "failure", "cancelled"]) {
      assert.equal((await api("credits/jobs/finish", { jobId: "client-choice-ignored", outcome })).status, 404);
    }
    assert.equal((await api("credits")).data.remainingMicros, 17_200_000);
    await chat("failed", "fail");
    assert.equal((await api("credits")).data.remainingMicros, 17_200_000);
    await chat("failed"); // Each successful retry has its own server-owned request.
    assert.equal((await api("credits")).data.remainingMicros, 15_800_000);
    const abort = new AbortController();
    const disconnect = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", { headers, method: "POST", signal: abort.signal, body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1", messages: [{ role: "user", content: "disconnect" }], stream: true })) });
    await disconnect.body!.getReader().read();
    abort.abort();
    // No client cleanup API. Natural server stream cleanup must free admission.
    let recovered;
    for (let attempt = 0; attempt < 30; attempt++) {
      recovered = await chat("recovered");
      if (recovered.events.at(-1)?.type === "done") break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(recovered?.events.at(-1)?.type, "done");
    assert.equal((await api("credits")).data.remainingMicros, 14_400_000);
    await chat("exhaust", "exhaust");
    const callsBefore = fixture.calls();
    const denied = await chat("denied");
    assert.equal(fixture.calls(), callsBefore);
    assert.deepEqual(denied.events.slice(-2).map((e: any) => e.type), ["client_action", "done"]);
    assert.ok(denied.events.slice(0, -2).every((e: any) => e.type === "content_delta"));
    const deniedText = denied.events.slice(0, -2).map((event: any) => event.text).join("");
    for (const [path, body] of [
      ["ai/chat-completions", { sceneKey: "write_turn", messages: [{ role: "user", content: "write" }], context: { billingJobId: "complete-denied" }, stream: false }],
      ["ai/embeddings", { sceneKey: "memory_embedding", input: ["memory"], context: { billingJobId: "embed-denied" } }],
    ] as const) {
      const response = await api(path, encryptCreditsFixture(body));
      const payload = decodeCreditsFixture(response);
      assert.equal(payload.code, "AINOVEL_QUOTA_INSUFFICIENT");
      assert.equal(payload.message, deniedText);
      assert.equal((payload.data as any)?.clientAction?.name, "open_membership");
      assert.equal((payload.data as any)?.clientAction?.arguments?.reason, "quota_insufficient");
    }
    assert.equal(fixture.calls(), callsBefore);
    assert.equal((await api("credits")).data.remainingMicros, 0);
    const latest = JSON.parse(await readFile(join(logRoot, "api/latest.json"), "utf8"));
    const logs = await readFile(latest.path, "utf8");
    assert.match(logs, /AINovel credits call settled/);
    assert.match(logs, /AINovel credits admission denied/);
    console.log(JSON.stringify({ evidence: "credits-http", pid: process.pid, url: fixture.url, logFile: latest.path, providerCalls: fixture.calls() }));
  } finally {
    await fixture.close();
    if (previousLogs === undefined) delete process.env.ZOOK_LOCAL_FILE_LOGS; else process.env.ZOOK_LOCAL_FILE_LOGS = previousLogs;
    if (previousRoot === undefined) delete process.env.ZOOK_LOG_DIR; else process.env.ZOOK_LOG_DIR = previousRoot;
  }
});
