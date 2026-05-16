import assert from "node:assert/strict";
import test from "node:test";

import {
  parseLlmConfigText,
  serializeLlmDraft,
} from "../../apps/admin-web/app/lib/llm-config.ts";

test("admin web llm raw parser normalizes valid json config", () => {
  const result = parseLlmConfigText(`{
    "enabled": true,
    "defaultModelKey": "kimi2.5",
    "providers": [
      {
        "key": "bailian",
        "label": "阿里云百炼",
        "enabled": true,
        "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        "apiKey": "{{zook.ps.bailian.api_key}}"
      }
    ],
    "models": [
      {
        "key": "kimi2.5",
        "label": "Kimi 2.5",
        "strategy": "fixed",
        "routes": [
          {
            "provider": "bailian",
            "providerModel": "kimi/kimi-k2.5",
            "enabled": true,
            "weight": 100
          }
        ]
      }
    ]
  }`);

  assert.equal(result.config.providers[0]?.baseUrl, "https://dashscope.aliyuncs.com/compatible-mode/v1");
  assert.equal(result.config.providers[0]?.timeoutMs, 30000);
  assert.equal(result.config.models[0]?.kind, "chat");
  assert.equal(result.config.models[0]?.routes[0]?.weight, 100);
  assert.equal(result.draft.providers[0]?.timeoutMs, "30000");
});

test("admin web llm raw parser rejects invalid numeric fields and route sums", () => {
  assert.throws(
    () => parseLlmConfigText(`{
      "enabled": true,
      "defaultModelKey": "kimi2.5",
      "providers": [
        {
          "key": "bailian",
          "label": "阿里云百炼",
          "enabled": true,
          "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "apiKey": "mock-bailian-api-key",
          "timeoutMs": "30000"
        }
      ],
      "models": [
        {
          "key": "kimi2.5",
          "label": "Kimi 2.5",
          "strategy": "fixed",
          "routes": [
            {
              "provider": "bailian",
              "providerModel": "kimi/kimi-k2.5",
              "enabled": true,
              "weight": 100
            }
          ]
        }
      ]
    }`),
    /timeoutMs 必须是正数/,
  );

  assert.throws(
    () => parseLlmConfigText(`{
      "enabled": true,
      "defaultModelKey": "kimi2.5",
      "providers": [
        {
          "key": "bailian",
          "label": "阿里云百炼",
          "enabled": true,
          "baseUrl": "https://dashscope.aliyuncs.com/compatible-mode/v1",
          "apiKey": "mock-bailian-api-key",
          "timeoutMs": 30000
        }
      ],
      "models": [
        {
          "key": "kimi2.5",
          "label": "Kimi 2.5",
          "strategy": "auto",
          "routes": [
            {
              "provider": "bailian",
              "providerModel": "kimi/kimi-k2.5",
              "enabled": true,
              "weight": 70
            }
          ]
        }
      ]
    }`),
    /weight 合计必须等于 100/,
  );
});

test("admin web llm form serializer keeps validating string inputs", () => {
  const result = serializeLlmDraft({
    enabled: true,
    defaultModelKey: "kimi2.5",
    providers: [
      {
        key: "bailian",
        label: "阿里云百炼",
        enabled: true,
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1/",
        apiKey: "mock-bailian-api-key",
        timeoutMs: "30000",
      },
    ],
    models: [
      {
        key: "kimi2.5",
        label: "Kimi 2.5",
        kind: "chat",
        strategy: "fixed",
        routes: [
          {
            provider: "bailian",
            providerModel: "kimi/kimi-k2.5",
            enabled: true,
            weight: "100",
          },
        ],
      },
    ],
  });

  assert.equal(result.providers[0]?.timeoutMs, 30000);
  assert.equal(result.models[0]?.routes[0]?.weight, 100);
  assert.equal(result.defaultModelKey, "kimi2.5");
});
