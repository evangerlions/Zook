import test from "node:test";
import assert from "node:assert/strict";
import { PersonalModelDispatcher } from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";

const cfg = {
  base_url: "https://model.example/v1",
  model_name: "synthetic-model",
  api_key: "synthetic-key",
};
const owner = { appId: "lighttick", userId: "personal-stream-synthetic" };

function request() {
  return {
    modelKey: "lighttick.personal",
    messages: [{ role: "user", content: "Return one JSON object." }],
    usageOwner: owner,
    providerOptions: { zookLightTickModelSelection: { mode: "personal", revision: 1 } },
  } as any;
}

function dispatcher(streamTransport: any, platform?: any) {
  return new PersonalModelDispatcher(
    { credentials: async () => cfg, assertCurrent: async () => {} } as any,
    platform ?? {
      complete: async () => {
        throw Error("platform must not be used for a personal selection");
      },
      completeViaStream: async () => {
        throw Error("platform must not be used for a personal selection");
      },
    },
    undefined,
    undefined,
    streamTransport,
  );
}

const sse = (events: any[]) =>
  events.map((e) => "data: " + JSON.stringify(e) + "\n\n").join("");

test("personal streaming yields deltas and assembles the full text", async () => {
  const body = sse([
    { choices: [{ delta: { content: '{"lessons":' } }] },
    { choices: [{ delta: { content: "[1]}" } }] },
    { choices: [{ delta: {}, finish_reason: "stop" }] },
    { choices: [], usage: { prompt_tokens: 3, completion_tokens: 4, total_tokens: 7 } },
  ]);
  const seen: string[] = [];
  const result = await dispatcher(async () =>
    new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
  ).completeViaStream(request(), {
    onContentDelta: (delta, full) => {
      seen.push(delta);
      assert.ok(full.endsWith(delta));
    },
  });

  assert.equal(result.text, '{"lessons":[1]}');
  assert.equal(result.provider, "personal");
  assert.equal(result.finishReason, "stop");
  assert.deepEqual(seen, ['{"lessons":', "[1]}"]);
  assert.equal(result.usage?.totalTokens, 7);
});

test("a gateway that ignores stream:true falls back to buffered JSON", async () => {
  const result = await dispatcher(async () =>
    new Response(
      JSON.stringify({
        choices: [{ message: { content: "buffered course" }, finish_reason: "stop" }],
        usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    ),
  ).completeViaStream(request(), { onContentDelta: () => assert.fail("no deltas expected") });

  assert.equal(result.text, "buffered course");
  assert.equal(result.finishReason, "stop");
});

test("a truncated personal stream is rejected as an incomplete response", async () => {
  const body = sse([
    { choices: [{ delta: { content: "half a course" } }] },
    { choices: [{ delta: {}, finish_reason: "length" }] },
  ]);
  await assert.rejects(
    dispatcher(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    ).completeViaStream(request()),
    { statusCode: 502 },
  );
});

test("an empty personal stream is rejected instead of producing a blank draft", async () => {
  const body = sse([{ choices: [{ delta: {}, finish_reason: "stop" }] }]);
  await assert.rejects(
    dispatcher(async () =>
      new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }),
    ).completeViaStream(request()),
    { statusCode: 502 },
  );
});

test("a personal failure never falls back to the platform model", async () => {
  let platformCalls = 0;
  const d = dispatcher(
    async () => {
      throw Error("MODEL_RESPONSE_FAILED_HTTP_500");
    },
    {
      complete: async () => {
        platformCalls++;
        throw Error("must not be reached");
      },
      completeViaStream: async () => {
        platformCalls++;
        throw Error("must not be reached");
      },
    },
  );
  await assert.rejects(d.completeViaStream(request()), { statusCode: 502 });
  assert.equal(platformCalls, 0);
});

test("a platform selection delegates streaming to the platform capability", async () => {
  let streamed = 0;
  const result = await dispatcher(
    async () => {
      throw Error("personal transport must not run for a platform selection");
    },
    {
      complete: async () => {
        throw Error("buffered platform completion must not be used when streaming exists");
      },
      completeViaStream: async (_request: any, options: any) => {
        streamed++;
        options?.onContentDelta?.("x", "x");
        return { text: "x", provider: "platform", providerModel: "m", finishReason: "stop" };
      },
    },
  ).completeViaStream({
    ...request(),
    providerOptions: { zookLightTickModelSelection: { mode: "platform", revision: 0 } },
  } as any);

  assert.equal(streamed, 1);
  assert.equal(result.text, "x");
});
