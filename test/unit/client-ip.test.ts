import assert from "node:assert/strict";
import test from "node:test";

import { resolveClientAddress } from "../../src/infrastructure/http/client-ip.ts";

test("untrusted peers cannot spoof the client address with X-Forwarded-For", () => {
  assert.deepEqual(
    resolveClientAddress("203.0.113.7", "198.51.100.9", "10.0.0.2"),
    { ipAddress: "198.51.100.9", trustedProxy: false },
  );
});

test("trusted peers resolve the nearest untrusted address from the forwarded chain", () => {
  assert.deepEqual(
    resolveClientAddress(
      "192.0.2.99, 203.0.113.7, 10.0.0.2",
      "::ffff:127.0.0.1",
      "10.0.0.2",
    ),
    { ipAddress: "203.0.113.7", trustedProxy: true },
  );
});

test("invalid forwarded addresses are ignored", () => {
  assert.deepEqual(
    resolveClientAddress("private-text", "127.0.0.1"),
    { ipAddress: "127.0.0.1", trustedProxy: true },
  );
});
