import test from "node:test";
import assert from "node:assert/strict";
import { dashscopeThinkingOptions } from "../../src/modules/lighttick/personal-model/personal-model-thinking.ts";
import {
  PersonalModelDispatcher,
  selectionOption,
} from "../../src/modules/lighttick/personal-model/personal-model.dispatcher.ts";
const url = "https://coding.dashscope.aliyuncs.com/v1";

test("DashScope Qwen hybrid generation honors the scene's disabled thinking", () => {
  for (const model of ["qwen3.7-plus", "qwen3.7-plus-2026-05-26"])
    assert.deepEqual(
      dashscopeThinkingOptions(url, model, { enable_thinking: false }),
      { enable_thinking: false },
    );
});

test("no-thinking adaptation never overrides other models, domains or caller choices", () => {
  assert.deepEqual(dashscopeThinkingOptions(url, "qwen3.7-plus"), {});
  assert.deepEqual(
    dashscopeThinkingOptions(url, "qwen3.7-plus", { enable_thinking: true }),
    {},
  );
  assert.deepEqual(
    dashscopeThinkingOptions(url, "glm-5.3", { enable_thinking: false }),
    {},
  );
  assert.deepEqual(
    dashscopeThinkingOptions(
      "https://coding.dashscope.aliyuncs.com.example/v1",
      "qwen3.7-plus",
      { enable_thinking: false },
    ),
    {},
  );
});

test("personal completion sends enable_thinking=false at the HTTP body top level", async () => {
  let body: any;
  const cfg = {
    base_url: url,
    model_name: "qwen3.7-plus",
    api_key: "SYNTHETIC_TEST_VALUE",
  };
  const dispatcher = new PersonalModelDispatcher(
    {
      credentials: async () => cfg,
      assertCurrent: async () => {},
    } as any,
    {
      complete: async () => {
        throw Error("must not fall back");
      },
    },
    (async (_url, init) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          choices: [
            { finish_reason: "stop", message: { content: '{"ok":true}' } },
          ],
        }),
      );
    }) as any,
  );
  await dispatcher.complete({
    modelKey: "unused",
    messages: [{ role: "user", content: "Return JSON" }],
    usageOwner: { appId: "lighttick", userId: "synthetic" },
    providerOptions: {
      ...selectionOption({ mode: "personal", revision: 1 }),
      enable_thinking: false,
      response_format: { type: "json_object" },
    },
  });
  assert.equal(body.enable_thinking, false);
  assert.deepEqual(body.response_format, { type: "json_object" });
  assert.equal(body.stream, false);
});
