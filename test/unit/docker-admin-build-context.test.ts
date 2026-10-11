import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

test("Docker admin build inputs contain the shared OpenRouter route validator", async () => {
  const root = resolve(import.meta.dirname, "../..");
  const dockerfile = readFileSync(join(root, "Dockerfile"), "utf8");
  const stage = dockerfile.split("AS admin-build")[1].split("FROM node:22-alpine AS runtime")[0];
  const replica = mkdtempSync(join(tmpdir(), "zook-admin-context-"));
  const workdir = join(replica, "app/apps/admin-web");
  mkdirSync(workdir, { recursive: true });
  try {
    // Materialize the repository COPY inputs, without access to the original src tree.
    for (const line of stage.split("\n")) {
      const match = /^COPY (\S+) (\S+)$/.exec(line.trim());
      if (!match) continue; // Package manifests have multiple source arguments.
      const [, source, destination] = match;
      const target = destination.startsWith("/")
        ? join(replica, destination.slice(1)) : resolve(workdir, destination);
      mkdirSync(dirname(target), { recursive: true });
      cpSync(join(root, source), target, {
        recursive: true,
        filter: (path) => !path.split("/").some((part) => ["node_modules", "build", ".react-router"].includes(part)),
      });
    }
    const { normalizeRoutes } = await import(pathToFileURL(join(workdir, "app/lib/llm-route-config.ts")).href);
    const policy = { provider: { order: ["deepinfra"], allow_fallbacks: true } };
    const route = { provider: "openrouter", providerModel: "deepseek/deepseek-v4-flash", enabled: true, weight: 100, openRouter: policy };
    assert.deepEqual(normalizeRoutes([route], "flash", new Set(["openrouter"]))[0].openRouter, policy);
    assert.throws(() => normalizeRoutes([{ ...route, provider: "bailian" }], "flash", new Set(["bailian"])), /仅允许/);
  } finally {
    rmSync(replica, { recursive: true, force: true });
  }
});
