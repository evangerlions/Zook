import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import { ApnsPushDispatcher } from "../../src/services/apns-push-dispatcher.ts";

function base64UrlDecode(input: string): Buffer {
  const padded = input.padEnd(input.length + (4 - (input.length % 4)) % 4, "=");
  return Buffer.from(padded.replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

test("APNs dispatcher signs ES256 JWTs with raw P1363 signatures", async () => {
  const { privateKey } = generateKeyPairSync("ec", {
    namedCurve: "P-256",
  });
  const privateKeyPem = privateKey.export({
    type: "pkcs8",
    format: "pem",
  }).toString();
  let authorizationHeader = "";

  const dispatcher = new ApnsPushDispatcher({
    teamId: "TEAM123456",
    keyId: "KEY1234567",
    bundleId: "com.example.frogsleep",
    privateKeyPem,
    production: false,
  }, {
    fetchImplementation: (async (_url, init) => {
      authorizationHeader = String((init?.headers as Record<string, string>).authorization ?? "");
      return new Response("", { status: 200 });
    }) as typeof fetch,
  });

  await dispatcher.dispatch({
    appId: "frogsleep",
    userId: "user_alice",
    platform: "ios",
    pushToken: "device_token",
    payload: {
      app: "frogsleep",
      type: "focus_buddy_invite",
      title: "Focus invite",
      body: "Alice invited you.",
      data: {},
    },
  });

  const jwt = authorizationHeader.replace(/^bearer\s+/i, "");
  const signature = base64UrlDecode(jwt.split(".")[2] ?? "");
  assert.equal(signature.length, 64);
});
