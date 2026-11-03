import assert from "node:assert/strict";
import test from "node:test";
import { startCreditsHttpRuntime, encryptCreditsFixture, decodeCreditsFixture } from "../support/credits-http-runtime.ts";
import type { BillingEnvironment } from "../../src/modules/billing/billing-environment.ts";

async function createFixture() {
  const fixture = await startCreditsHttpRuntime();
  const headers = (environment: BillingEnvironment) => ({
    authorization: `Bearer ${fixture.token}`, "X-App-Id": "ai_novel",
    "X-App-Version": "1.6.0+1060002", "Content-Type": "application/json",
    "X-Billing-Environment": environment,
  });
  const balance = async (environment: BillingEnvironment) => {
    const response = await fetch(fixture.url + "/api/v1/ai_novel/credits", { headers: headers(environment) });
    assert.equal(response.status, 200);
    return (await response.json()).data.remainingMicros as number;
  };
  const chat = async (environment: BillingEnvironment, content = "write") => {
    const response = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", {
      headers: headers(environment), method: "POST",
      body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1",
        modelSelection: { mode: "auto" }, messages: [{ role: "user", content }], stream: true })),
    });
    assert.equal(response.status, 200);
    return (await response.text()).split("\n").filter(line => line.startsWith("data: "))
      .map(line => decodeCreditsFixture(JSON.parse(line.slice(6))))
      .map(event => (event.code === "OK" ? event.data : event) as { type?: string; code?: string });
  };
  return { ...fixture, headers, balance, chat };
}

test("encrypted HTTP streams debit only their requested environment, including concurrent streams", async () => {
  const fixture = await createFixture();
  const { balance, chat } = fixture;
  try {
    assert.equal(await balance("production"), 200_000_000);
    assert.equal(await balance("sandbox"), 200_000_000);
    assert.equal((await chat("sandbox")).at(-1)?.type, "done");
    assert.equal(await balance("sandbox"), 198_600_000);
    assert.equal(await balance("production"), 200_000_000);
    assert.equal((await chat("production")).at(-1)?.type, "done");
    assert.equal(await balance("production"), 198_600_000);
    const results = await Promise.all([chat("sandbox"), chat("production")]);
    assert.ok(results.every(events => events.at(-1)?.type === "done"));
    assert.equal(await balance("sandbox"), 197_200_000);
    assert.equal(await balance("production"), 197_200_000);
    assert.ok((await chat("sandbox", "fail")).some(event => event.code && event.code !== "OK"));
    assert.equal(await balance("sandbox"), 197_200_000);
    assert.equal(await balance("production"), 197_200_000);
    // A failed sandbox stream must release its admission lease in sandbox too.
    assert.equal((await chat("sandbox")).at(-1)?.type, "done");
    assert.equal(await balance("sandbox"), 195_800_000);
    assert.equal(await balance("production"), 197_200_000);
  } finally { await fixture.close(); }
});

test("disconnecting a sandbox stream releases sandbox admission without debiting either environment", async () => {
  const fixture = await createFixture();
  try {
    const abort = new AbortController();
    const response = await fetch(fixture.url + "/api/v1/ai_novel/ai/chat-completions", {
      headers: fixture.headers("sandbox"), method: "POST", signal: abort.signal,
      body: JSON.stringify(encryptCreditsFixture({ sceneKey: "write_turn", agentProtocol: "pi-v1",
        messages: [{ role: "user", content: "disconnect" }], stream: true })),
    });
    assert.equal(response.status, 200);
    await response.body!.getReader().read();
    abort.abort();
    let recovered = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      assert.equal(await fixture.balance("sandbox"), 200_000_000);
      assert.equal(await fixture.balance("production"), 200_000_000);
      const callsBefore = fixture.calls();
      const events = await fixture.chat("sandbox");
      if (fixture.calls() > callsBefore && events.at(-1)?.type === "done") {
        recovered = true;
        break;
      }
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(recovered, true);
    assert.equal(await fixture.balance("sandbox"), 198_600_000);
    assert.equal(await fixture.balance("production"), 200_000_000);
  } finally { await fixture.close(); }
});
