import assert from "node:assert/strict";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { type TestContext } from "node:test";
import { resolveAiNovelDebugTraceRoot } from "../../src/modules/ai-novel/ai-novel-debug-trace-path.ts";
import { AiNovelDebugTraceService } from "../../src/modules/ai-novel/ai-novel-debug-trace.service.ts";

function useEnvironment(t: TestContext, values: Record<string, string | undefined>) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  const apply = (entries: Record<string, string | undefined>) => {
    for (const [key, value] of Object.entries(entries)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  apply(values);
  t.after(() => apply(previous));
}

test("local traces keep the original directory despite a persistent storage override", (t) => {
  useEnvironment(t, { APP_ENV: "local", DEPLOY_SLOT: undefined, ZOOK_APP_RUN_DATA_ROOT: "/unused/runtime" });
  assert.equal(resolveAiNovelDebugTraceRoot(false), join(process.cwd(), ".zook", "ai-novel-traces"));
  assert.equal(resolveAiNovelDebugTraceRoot(true), join(process.cwd(), ".zook", "ai-novel-traces"));
});

test("a host dev process keeps the original trace directory", (t) => {
  useEnvironment(t, { APP_ENV: "dev", DEPLOY_SLOT: undefined });
  assert.equal(resolveAiNovelDebugTraceRoot(false), join(process.cwd(), ".zook", "ai-novel-traces"));
});

test("a dev container uses the existing persistent runtime directory", (t) => {
  useEnvironment(t, { APP_ENV: "dev", DEPLOY_SLOT: "dev", ZOOK_APP_RUN_DATA_ROOT: undefined });
  assert.equal(resolveAiNovelDebugTraceRoot(true), "/app/appRunData/ai-novel-traces");
});

test("deployment identity takes precedence over a local app environment", (t) => {
  useEnvironment(t, { APP_ENV: "local", DEPLOY_SLOT: "dev", ZOOK_APP_RUN_DATA_ROOT: "/mounted/runtime" });
  assert.equal(resolveAiNovelDebugTraceRoot(true), "/mounted/runtime/ai-novel-traces");
});

test("the default service writes and recovers traces through the mounted runtime root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zook-trace-runtime-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  useEnvironment(t, { APP_ENV: "dev", DEPLOY_SLOT: "dev", CONTAINER: "1", ZOOK_APP_RUN_DATA_ROOT: root });
  const service = new AiNovelDebugTraceService();
  await service.write({ sessionId: "mounted-session", kind: "kickoff", status: "completed", trace: { messages: [] } });
  assert.equal((await readdir(join(root, "ai-novel-traces"))).length, 1);
  const recovered = await new AiNovelDebugTraceService().read("mounted-session", "kickoff");
  assert.equal(recovered.manifest.captureCount, 1);
  assert.deepEqual(recovered.captures[0]?.trace, { messages: [] });
});

test("an explicit trace root still overrides runtime defaults", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "zook-trace-explicit-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  useEnvironment(t, { APP_ENV: "dev", DEPLOY_SLOT: "dev", CONTAINER: "1", ZOOK_APP_RUN_DATA_ROOT: "/unused/runtime" });
  const service = new AiNovelDebugTraceService(root);
  await service.write({ sessionId: "explicit-session", kind: "kickoff", status: "completed", trace: {} });
  assert.equal((await readdir(root)).length, 1);
});
