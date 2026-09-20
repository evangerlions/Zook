import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const repo = join(import.meta.dirname, "../..");

test("admin web exposes the global release update workspace", () => {
  const route = readFileSync(join(repo, "apps/admin-web/app/routes/release-updates.tsx"), "utf8");
  const shell = readFileSync(join(repo, "apps/admin-web/app/components/app-shell.tsx"), "utf8");
  const routes = readFileSync(join(repo, "apps/admin-web/app/routes.ts"), "utf8");
  const api = readFileSync(join(repo, "apps/admin-web/app/lib/admin-api.ts"), "utf8");

  assert.match(routes, /route\("release-updates", "routes\/release-updates\.tsx"\)/);
  assert.match(shell, /to: "\/release-updates"/);
  assert.match(route, /common\.release_updates/);
  assert.match(route, /adminApi\.updateReleaseUpdates/);
  assert.match(route, /adminApi\.restoreReleaseUpdates/);
  assert.match(api, /getReleaseUpdates\(\)/);
  assert.match(api, /updateReleaseUpdates\(config: unknown/);
});
