import test from "node:test";
import assert from "node:assert/strict";
import {
  buildLightTickPublicConfiguration,
  growWebUrl,
} from "../../src/modules/lighttick/lighttick-public-config.ts";
test("native Grow URL has one reviewed configuration source, explicit namespace and environment-safe origin", () => {
  assert.equal(
    growWebUrl("https://web.example/grow/", "online"),
    "https://web.example/grow/",
  );
  assert.equal(
    growWebUrl("http://127.0.0.1:58631/grow/", "local"),
    "http://127.0.0.1:58631/grow/",
  );
  for (const value of [
    "https://user:password@web.example/grow/",
    "https://web.example/",
    "https://web.example/grow/?token=x",
    "https://web.example/grow/#mobile/practice",
    "http://remote.example/grow/",
    "javascript:alert(1)",
  ])
    assert.equal(growWebUrl(value, "local"), null);
  assert.equal(growWebUrl("http://localhost/grow/", "online"), null);
  const record = {
    id: "synthetic-delivery",
    appId: "lighttick",
    configKey: "admin.delivery_config",
    configValue: JSON.stringify({
      enabled: true,
      settings: { growWebUrl: "https://web.example/grow/" },
    }),
    updatedAt: "2026-11-03T00:00:00Z",
  };
  assert.equal(
    buildLightTickPublicConfiguration(true, record, "online").grow_web_url,
    "https://web.example/grow/",
  );
  assert.equal(
    buildLightTickPublicConfiguration(false, record, "online").grow_web_url ??
      null,
    null,
  );
  assert.equal(
    buildLightTickPublicConfiguration(true, undefined, "online").grow_web_url ??
      null,
    null,
  );
});
