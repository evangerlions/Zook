import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { FcmPushDispatcher } from "../../src/services/fcm-push-dispatcher.ts";

test("FCM dispatcher sends LightTick safe data and invokes product-scoped invalidation", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const requests: Array<{ url: string; body: string }> = []; let invalidated = 0;
  const dispatcher = new FcmPushDispatcher({ projectId: "lighttick-dev", clientEmail: "push@example.test", privateKeyPem }, {
    fetchImplementation: (async (url, init) => {
      requests.push({ url: String(url), body: String(init?.body ?? "") });
      if (String(url).includes("oauth2.googleapis.com"))
        return new Response(JSON.stringify({ access_token: "access", expires_in: 3600 }), { status: 200 });
      return new Response(JSON.stringify({ error: { status: "NOT_FOUND", message: "entity not found" } }), { status: 404 });
    }) as typeof fetch,
  });

  await dispatcher.dispatch({ appId: "lighttick", userId: "user-1", platform: "android", pushToken: "invalid-token",
    payload: { app: "lighttick", type: "daily_tasks", title: "Today", body: "Open LightTick",
      data: { type: "daily_tasks", sync: "true" } }, invalidateToken: async () => { invalidated++; } });

  assert.equal(requests.length, 2);
  assert.match(requests[1]!.url, /lighttick-dev\/messages:send$/);
  const providerBody = JSON.parse(requests[1]!.body);
  assert.equal(providerBody.message.data.app, "lighttick");
  assert.equal(providerBody.message.data.sync, "true");
  assert.equal(providerBody.message.notification.title, "Today");
  assert.equal(invalidated, 1);
});
