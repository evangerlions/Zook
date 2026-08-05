import assert from "node:assert/strict";
import test from "node:test";
import { resolveAccountRegionAccessPolicy } from "../../src/modules/app-registry/account-region-access-policy.ts";

test("Android and Web require a concrete product region", () => {
  assert.deepEqual(resolveAccountRegionAccessPolicy("android", "CN"), {
    platform: "android",
    productRegion: "CN",
  });
  assert.deepEqual(resolveAccountRegionAccessPolicy("WEB", "global"), {
    platform: "web",
    productRegion: "GLOBAL",
  });
  assert.equal(resolveAccountRegionAccessPolicy("android", "UNKNOWN"), undefined);
  assert.equal(resolveAccountRegionAccessPolicy("web", undefined), undefined);
});

test("Apple and unknown platforms are not authoritative", () => {
  for (const platform of ["ios", "ipados", "macos", "desktop", undefined]) {
    assert.equal(resolveAccountRegionAccessPolicy(platform, "CN"), undefined);
  }
});
