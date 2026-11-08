import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import {
  AesGcmPayloadCryptoService,
  StaticAesGcmEncryptionKeyResolver,
} from "../../src/services/aes-gcm-payload-crypto.service.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { GitHubService } from "../../src/modules/lighttick/github/github.service.ts";
import {
  GitHubClient,
  githubFields,
} from "../../src/modules/lighttick/github/github.client.ts";
import { GitHubTestRunner } from "../../src/modules/lighttick/github/github-test.runner.ts";
const o = { appId: "lighttick" as const, userId: "synthetic-github" };
const ref = (branch = "main") =>
  new Response(
    JSON.stringify({
      ref: "refs/heads/" + branch,
      object: { type: "commit", sha: "a".repeat(40) },
    }),
    { headers: { "Content-Type": "application/json" } },
  );
function setup(fetcher: typeof fetch = async () => ref()) {
  const repo = new InMemoryLightTickRepository(),
    queue = new InMemoryJobQueue();
  let now = new Date("2026-11-06T08:00:00Z");
  const s = new GitHubService(
    repo,
    new AesGcmPayloadCryptoService(
      new StaticAesGcmEncryptionKeyResolver({
        fixture: Buffer.alloc(32, 7).toString("base64"),
      }),
    ),
    async () => "fixture",
    queue,
    new GitHubClient(fetcher),
    undefined,
    () => now,
  );
  const body = {
    base_revision: 0,
    mode: "custom",
    repository: "fixture/content",
    branch: "main",
    token: "SYNTHETIC_GITHUB_TOKEN",
  };
  return {
    repo,
    queue,
    s,
    body,
    setNow: (date: string) => {
      now = new Date(date);
    },
  };
}
test("GitHub save checks read-only outside locks, encrypts, CAS/replays and retains null token", async () => {
  let calls = 0,
    inside = false;
  const { repo, s, body } = setup(async (raw, init) => {
    assert.equal(inside, false);
    calls++;
    assert.equal(init?.method, "GET");
    assert.equal(init?.redirect, "error");
    assert.equal(
      String(raw),
      "https://api.github.com/repos/fixture/content/git/ref/heads/main",
    );
    return ref();
  });
  const tx = repo.transaction.bind(repo);
  repo.transaction = (o, fn) =>
    tx(o, async () => {
      const old = inside;
      inside = true;
      try {
        return await fn();
      } finally {
        inside = old;
      }
    });
  const first = await s.configure(o, body, "github-original");
  assert.equal(calls, 1);
  assert.equal(first.configured, true);
  assert.equal(
    JSON.stringify(await repo.github.get(o)).includes(body.token),
    false,
  );
  assert.equal(
    JSON.stringify(await repo.getOperation(o, "github-original")).includes(
      body.token,
    ),
    false,
  );
  assert.deepEqual(await s.configure(o, body, "github-original"), first);
  assert.equal(calls, 1);
  assert.deepEqual(await s.receipt(o, "github-original"), first);
  assert.equal((await s.summary({ ...o, userId: "other" })).revision, 0);
  await s.configure(
    o,
    { ...body, base_revision: 1, token: null },
    "github-retain",
  );
  assert.equal(calls, 2);
  assert.equal(
    (await s.credentials(o, { mode: "custom", revision: 2 })).token,
    body.token,
  );
  await assert.rejects(
    s.configure(o, { ...body, token: "DIFFERENT" }, "github-original"),
    { statusCode: 409 },
  );
  await assert.rejects(s.configure(o, body, "github-stale"), {
    statusCode: 409,
  });
  await s.configure(
    o,
    {
      base_revision: 2,
      mode: "default",
      repository: null,
      branch: null,
      token: null,
    },
    "github-clear",
  );
  assert.equal((await repo.github.get(o))?.secret, null);
  assert.equal((await s.summary(o)).configured, false);
  assert.deepEqual(await s.configure(o, body, "github-original"), first);
});
test("GitHub rejects remote failures, invalid refs and receipt crash without saving configuration", async () => {
  const bad = setup(
    async () => new Response("provider-secret-body", { status: 403 }),
  );
  await assert.rejects(bad.s.configure(o, bad.body, "github-failed"), {
    statusCode: 422,
  });
  assert.equal(await bad.repo.github.get(o), undefined);
  for (const patch of [
    { repository: "https://evil.test/repo" },
    { branch: "../main" },
    { branch: "main.lock" },
    { branch: "a//b" },
    { token: "bad\r\nheader" },
  ])
    assert.throws(() => githubFields({ ...bad.body, ...patch }), {
      statusCode: 422,
    });
  const { repo, s, body } = setup();
  const save = repo.saveOperation.bind(repo);
  repo.saveOperation = async () => {
    throw Error("synthetic crash");
  };
  await assert.rejects(s.configure(o, body, "github-crash"));
  assert.equal(await repo.github.get(o), undefined);
  repo.saveOperation = save;
  await s.configure(o, body, "github-crash");
});
test("GitHub draft tests do not activate settings; exact original replays terminal and removes temporary ciphertext", async () => {
  let calls = 0;
  const { repo, s, body } = setup(async () => {
    calls++;
    return ref();
  });
  const b = {
    settings_revision: 0,
    config: {
      repository: body.repository,
      branch: body.branch,
      token: body.token,
    },
  };
  const t = await s.createTest(o, b, "github-test-original");
  assert.equal((await s.summary(o)).revision, 0);
  assert.equal(
    JSON.stringify(await repo.getOperation(o, "github-test-original")).includes(
      body.token,
    ),
    false,
  );
  const runner = new GitHubTestRunner(s);
  await runner.execute(o, t.id);
  assert.equal(calls, 1);
  assert.equal(
    (await s.testReceipt(o, "github-test-original")).status,
    "succeeded",
  );
  assert.equal((await repo.github.test(o, t.id))?.draft_secret, null);
  assert.equal(
    (await s.createTest(o, b, "github-test-original")).status,
    "succeeded",
  );
  assert.equal(calls, 1);
  await assert.rejects(
    s.createTest(
      o,
      { ...b, config: { ...b.config, branch: "other" } },
      "github-test-original",
    ),
    { statusCode: 409 },
  );
  await assert.rejects(s.readTest({ ...o, userId: "other" }, t.id), {
    statusCode: 404,
  });
});
test("GitHub running cancellation fences late success and scrubs credentials", async () => {
  let release!: () => void, started!: () => void;
  const begun = new Promise<void>((r) => {
    started = r;
  });
  const { repo, s, body } = setup(async () => {
    started();
    await new Promise<void>((r) => {
      release = r;
    });
    return ref();
  });
  const t = await s.createTest(
    o,
    {
      settings_revision: 0,
      config: {
        repository: body.repository,
        branch: body.branch,
        token: body.token,
      },
    },
    "github-live-test",
  );
  const run = new GitHubTestRunner(s).execute(o, t.id);
  await begun;
  const running = await s.readTest(o, t.id);
  const b = { base_revision: running.revision };
  const result = await s.cancelTest(o, t.id, b, "github-cancel");
  release();
  await run;
  assert.equal((await s.readTest(o, t.id)).status, "cancelled");
  assert.equal((await repo.github.test(o, t.id))?.draft_secret, null);
  assert.deepEqual(await s.cancelTest(o, t.id, b, "github-cancel"), result);
});
test("GitHub stale revisions and crash recovery never publish invalid success; recovery is bounded", async () => {
  const { repo, s, body, setNow } = setup();
  await s.configure(o, body, "github-save");
  const t = await s.createTest(
    o,
    { settings_revision: 1 },
    "github-saved-test",
  );
  await s.configure(
    o,
    {
      base_revision: 1,
      mode: "default",
      repository: null,
      branch: null,
      token: null,
    },
    "github-clear",
  );
  await new GitHubTestRunner(s).execute(o, t.id);
  assert.equal((await s.readTest(o, t.id)).error_code, "SETTINGS_CHANGED");
  const b = {
    settings_revision: 2,
    config: {
      repository: body.repository,
      branch: body.branch,
      token: body.token,
    },
  };
  const next = await s.createTest(o, b, "github-recover-test"),
    row = (await repo.github.test(o, next.id))!;
  await repo.github.saveTest(
    {
      ...row,
      revision: 2,
      status: "running",
      attempt: 3,
      fence: "expired",
      lease_until: "2026-11-06T07:00:00Z",
    },
    1,
  );
  setNow("2026-11-06T09:00:00Z");
  await new GitHubTestRunner(s).execute(o, next.id);
  assert.equal((await s.readTest(o, next.id)).error_code, "RECOVERY_EXHAUSTED");
  assert.equal((await repo.github.test(o, next.id))?.draft_secret, null);
});
test("GitHub fixed-host client rejects redirect, wrong branch, malformed content and already aborted signals", async () => {
  const c = {
    repository: "fixture/content",
    branch: "topic/a",
    token: "SYNTHETIC_GITHUB_TOKEN",
  };
  let calls = 0;
  const client = new GitHubClient(async (raw, init) => {
    calls++;
    assert.ok(String(raw).endsWith("/heads/topic/a"));
    assert.equal(init?.redirect, "error");
    return ref("topic/a");
  });
  await client.check(c);
  assert.equal(calls, 1);
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(client.check(c, controller.signal));
  assert.equal(calls, 1);
  for (const r of [
    new Response("", { status: 302 }),
    ref("wrong"),
    new Response("{}", { headers: { "Content-Type": "text/html" } }),
  ])
    await assert.rejects(new GitHubClient(async () => r).check(c));
});
