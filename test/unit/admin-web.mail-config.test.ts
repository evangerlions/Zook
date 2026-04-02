import assert from "node:assert/strict";
import test from "node:test";

import {
  parseMailConfigText,
  serializeMailDraft,
} from "../../apps/admin-web/app/lib/mail-config.ts";

test("admin web mail raw parser normalizes valid json config", () => {
  const result = parseMailConfigText(`{
    "enabled": true,
    "regions": [
      {
        "region": "ap-guangzhou",
        "sender": {
          "id": "noreply",
          "address": "Zook <noreply@example.com>"
        },
        "templates": [
          {
            "locale": "zh-cn",
            "templateId": 10001,
            "name": "verify-code",
            "subject": "验证码"
          }
        ]
      }
    ]
  }`);

  assert.equal(result.config.enabled, true);
  assert.equal(result.config.regions.length, 2);
  assert.equal(result.config.regions[0]?.region, "ap-guangzhou");
  assert.equal(result.config.regions[0]?.templates[0]?.locale, "zh-CN");
  assert.equal(result.config.regions[0]?.templates[0]?.templateId, 10001);
  assert.equal(result.config.regions[1]?.region, "ap-hongkong");
  assert.deepEqual(result.config.regions[1]?.templates, []);
  assert.equal(result.draft.regions[0]?.templates[0]?.templateId, "10001");
});

test("admin web mail raw parser rejects invalid numeric and duplicate fields", () => {
  assert.throws(
    () => parseMailConfigText(`{
      "enabled": true,
      "regions": [
        {
          "region": "ap-guangzhou",
          "sender": {
            "id": "noreply",
            "address": "noreply@example.com"
          },
          "templates": [
            {
              "locale": "zh-CN",
              "templateId": "10001",
              "name": "verify-code",
              "subject": "验证码"
            }
          ]
        }
      ]
    }`),
    /模板 ID 必须是 number/,
  );

  assert.throws(
    () => parseMailConfigText(`{
      "enabled": true,
      "regions": [
        {
          "region": "ap-guangzhou",
          "sender": {
            "id": "noreply",
            "address": "noreply@example.com"
          },
          "templates": [
            {
              "locale": "zh-CN",
              "templateId": 10001,
              "name": "verify-code",
              "subject": "验证码"
            }
          ]
        },
        {
          "region": "ap-hongkong",
          "sender": {
            "id": "noreply-hk",
            "address": "noreply-hk@example.com"
          },
          "templates": [
            {
              "locale": "en-US",
              "templateId": 10001,
              "name": "verify-code",
              "subject": "Code"
            }
          ]
        }
      ]
    }`),
    /模板 ID 不允许重复/,
  );
});

test("admin web mail form serializer keeps validating string inputs", () => {
  const result = serializeMailDraft({
    enabled: true,
    regions: [
      {
        region: "ap-guangzhou",
        sender: {
          id: "noreply",
          address: "noreply@example.com",
        },
        templates: [
          {
            locale: "zh-CN",
            templateId: "10001",
            name: "verify-code",
            subject: "验证码",
          },
        ],
      },
      {
        region: "ap-hongkong",
        sender: {
          id: "noreply-hk",
          address: "noreply-hk@example.com",
        },
        templates: [
          {
            locale: "en-US",
            templateId: "10002",
            name: "verify-code",
            subject: "Code",
          },
        ],
      },
    ],
  });

  assert.equal(result.regions[0]?.templates[0]?.templateId, 10001);
  assert.equal(result.regions[1]?.templates[0]?.templateId, 10002);
});
