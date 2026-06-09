import assert from "node:assert/strict";
import test from "node:test";

import { adminApi } from "../../apps/admin-web/app/lib/admin-api.ts";
import {
  formatMailCallbackCellValue,
  MAIL_CALLBACK_EVENT_OPTIONS,
  resolveMailCallbackEventColor,
} from "../../apps/admin-web/app/lib/mail-callback-events.ts";

test("admin web mail callback event helper covers all Tencent SES events", () => {
  const values = MAIL_CALLBACK_EVENT_OPTIONS
    .map((item) => item.value)
    .filter(Boolean);

  assert.deepEqual(values, [
    "delivered",
    "dropped",
    "bounce",
    "open",
    "click",
    "spamreport",
    "unsubscribe",
    "deferred",
  ]);
  assert.equal(resolveMailCallbackEventColor("delivered"), "success");
  assert.equal(resolveMailCallbackEventColor("click"), "blue");
  assert.equal(resolveMailCallbackEventColor("bounce"), "error");
  assert.equal(resolveMailCallbackEventColor("deferred"), "orange");
});

test("admin web mail callback table helper renders empty cells consistently", () => {
  assert.equal(formatMailCallbackCellValue(undefined), "—");
  assert.equal(formatMailCallbackCellValue(""), "—");
  assert.equal(formatMailCallbackCellValue(123456), "123456");
});

test("admin web mail callback API client sends event and email filters", async () => {
  const originalFetch = globalThis.fetch;
  let requestedPath = "";
  globalThis.fetch = (async (input: string | URL | Request) => {
    requestedPath = typeof input === "string" ? input : input.toString();
    return new Response(JSON.stringify({
      code: "OK",
      message: "ok",
      data: {
        app: {},
        items: [],
      },
      requestId: "req_test",
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  try {
    await adminApi.getEmailDeliveryEvents({
      event: "click",
      email: "reader@example.com",
      limit: 100,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(
    requestedPath,
    "/api/v1/admin/apps/common/email-service/events?event=click&email=reader%40example.com&limit=100",
  );
});
