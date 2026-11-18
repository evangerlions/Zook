import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Ajv from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { createApplication } from "../support/create-test-application.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as schemas from "../../src/generated/openapi/public-contracts.generated.ts";
import { GitHubService } from "../../src/modules/lighttick/github/github.service.ts";
import { GitHubClient } from "../../src/modules/lighttick/github/github.client.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";

const ROOT = "account/github";
const TOKEN = "SYNTHETIC_PERSONAL_REPO_TOKEN";
const start = "a".repeat(40);
const directorySha = "b".repeat(40);
const treeSha = "c".repeat(40);
const next = "d".repeat(40);
const response = (data: unknown, status = 200) =>
  Response.json(data, { status });

function remote(platform: "github" | "gitee") {
  const files = new Map<string, string>();
  const writes: string[] = [];
  let head = start;
  let pending: { path: string; content: string }[] = [];
  let giteeInterrupted = false;
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const gitee = platform === "gitee";
    assert.equal(url.hostname, gitee ? "gitee.com" : "api.github.com");
    assert.equal(init?.redirect, "error");
    assert.equal(new Headers(init?.headers).get("Authorization"), (gitee ? "token " : "Bearer ") + TOKEN);
    const path = decodeURIComponent(url.pathname.split("/repos/fixture/course")[1]);
    const method = init?.method;
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (path === "/branches/main") return response({ name: "main", commit: { sha: head } });
    if (path === "/git/ref/heads/main") return response({ ref: "refs/heads/main", object: { type: "commit", sha: head } });
    if (path === "/git/commits/" + head) return response({ tree: { sha: directorySha } });
    if (path === "/git/trees") {
      assert.equal(body.base_tree, directorySha);
      pending = body.tree;
      return response({ sha: treeSha }, 201);
    }
    if (path === "/git/commits" && method === "POST") {
      assert.deepEqual(body.parents, [head]);
      assert.equal(body.tree, treeSha);
      return response({ sha: next }, 201);
    }
    if (path === "/git/refs/heads/main" && method === "PATCH") {
      assert.deepEqual(body, { sha: next, force: false });
      for (const file of pending) files.set(file.path, file.content);
      writes.push("atomic");
      head = next;
      return response({ object: { sha: head } });
    }
    assert.ok(path.startsWith("/contents/"), path);
    const file = path.slice("/contents/".length);
    if (method === "POST") {
      assert.equal(platform, "gitee");
      assert.equal(body.branch, "main");
      assert.equal(files.has(file), false, "should never update an existing snapshot file");
      if (file.endsWith("/README.md") && !giteeInterrupted) {
        giteeInterrupted = true;
        return response({ message: TOKEN }, 503);
      }
      files.set(file, Buffer.from(body.content, "base64").toString());
      writes.push(file.split("/").at(-1)!);
      head = file.endsWith("/README.md") ? next : "e".repeat(40);
      return response({ commit: { sha: head } }, 201);
    }
    assert.equal(url.searchParams.get("ref"), head);
    if (files.has(file)) {
      const text = files.get(file)!;
      return response({
        type: "file", encoding: "base64", sha: directorySha,
        content: Buffer.from(text).toString("base64"),
      });
    }
    const children = [...files].filter(([name]) => name.startsWith(file + "/")).map(([name, markdown]) => ({
      name: name.slice(file.length + 1),
      type: "file",
      sha: createHash("sha1").update("blob " + Buffer.byteLength(markdown) + "\0").update(markdown).digest("hex"),
    }));
    return children.length ? response(children) : response({}, 404);
  };
  return { fetcher, files, writes };
}

for (const platform of ["github", "gitee"] as const) {
  test(`${platform} publishes the formal course, replays safely and reads pinned Markdown for the owner`, async () => {
    const seed = buildDefaultSeed(undefined, { includeLightTick: true });
    for (const userId of ["user_alice", "user_bob"])
      seed.appUsers.push({
        id: "course-repository-" + userId, appId: "lighttick", userId,
        status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString(),
      });
    const app = await createApplication({ seed, lighttickEnabled: true });
    const runtime = app.services.lighttickRuntime!;
    runtime.nativeLearning = new NativeLearningService(runtime.repository, true);
    const settings = runtime.github!;
    const fixture = remote(platform);
    runtime.github = new GitHubService(
      settings.repo, settings.crypto, settings.keyId, settings.queue, new GitHubClient(fixture.fetcher),
    );
    const ajv = addFormats(new Ajv({ strict: false }));
    const call = (
      path: string, method = "GET", body?: unknown, key = "course-repo-default",
      query?: Record<string, string>, user = "user_alice",
    ) => app.app.handle({
      method, path: "/api/v1/lighttick/" + path, query, body,
      headers: {
        authorization: "Bearer " + app.services.tokenService.issueAccessToken(user, "lighttick"),
        "x-app-id": "lighttick", "idempotency-key": key,
      },
    });
    function data(result: Awaited<ReturnType<typeof call>>) {
      assert.equal(result.statusCode, 200, JSON.stringify(result.body));
      return (result.body as { data: any }).data;
    }
    function check(result: Awaited<ReturnType<typeof call>>, schema: object) {
      assert.equal(result.headers["Cache-Control"], "no-store");
      const value = data(result);
      const validate = ajv.compile(schema);
      assert.ok(validate(result.body), JSON.stringify(validate.errors));
      assert.equal(JSON.stringify(result.body).includes(TOKEN), false);
      return value;
    }
    const config = { mode: "custom", base_revision: 0, provider: platform, repository: "fixture/course", branch: "main", token: TOKEN };
    check(await call(ROOT, "PUT", config), schemas.LightTickGitHubSettingsEnvelopeSchema);
    const otherPlatform = platform === "github" ? "gitee" : "github";
    assert.equal((await call(ROOT, "PUT", { ...config, base_revision: 1, provider: otherPlatform, token: null }, "repo-platform-switch")).statusCode, 422);

    const id = "plan-course-repo-fixture";
    const route = "learning/routes/" + id;
    const course = routeFixture();
    data(await call(route, "PUT", { base_revision: 0, ...course }, "repository-create-course"));
    data(await call(route + "/publish", "POST", { base_revision: 1 }, "repository-confirm-outline"));
    data(await call(route + "/lessons/1/publish", "POST", {
      base_revision: 2, base_lesson_revision: 0, lesson_id: "lesson-fixture-repository",
      content: "Published **lesson正文**", references: "Published references",
    }, "repository-confirm-lesson"));
    data(await call(route, "PUT", {
      ...course, brief: { ...course.brief, title: "Private outline draft" }, base_revision: 3,
    }, "repository-save-draft"));
    const publication = ROOT + "/course-publications/" + id;
    const body = { route_revision: 4, settings_revision: 1 };
    const receiptQuery = { route_revision: "4", settings_revision: "1" };
    assert.equal(check(await call(publication, "GET", undefined, undefined, receiptQuery),
      schemas.LightTickGitHubCourseReceiptEnvelopeSchema).publication, null);
    assert.equal((await call(publication, "POST", { ...body, route_revision: 3 })).statusCode, 409);
    if (platform === "gitee") {
      const partial = await call(publication, "POST", body);
      assert.equal(partial.statusCode, 503);
      assert.equal(JSON.stringify(partial.body).includes(TOKEN), false);
      assert.deepEqual(fixture.writes, ["001.md"]);
    }
    const receipt = check(await call(publication, "POST", body), schemas.LightTickGitHubCoursePublicationEnvelopeSchema);
    assert.deepEqual(check(await call(publication, "GET", undefined, undefined, receiptQuery),
      schemas.LightTickGitHubCourseReceiptEnvelopeSchema).publication, receipt);
    assert.equal(receipt.commit, next);
    assert.equal(receipt.provider, platform);
    assert.match(receipt.path, /^lighttick\/courses\/[a-f0-9]+\/[a-f0-9]+\/README\.md$/);
    assert.match(receipt.url, new RegExp(`^https://${platform}\\.com/fixture/course/blob/${next}/`));
    const files = fixture.files;
    assert.equal(files.size, 2);
    assert.match(files.get(receipt.path)!, /Synthetic course[\s\S]*\[First\]\(\.\/001\.md\)/);
    assert.doesNotMatch(files.get(receipt.path)!, /Private outline draft/);
    assert.match(files.get(receipt.path.replace("README.md", "001.md"))!, /Published \*\*lesson正文\*\*/);
    assert.deepEqual(data(await call(publication, "POST", body)), receipt);
    assert.deepEqual(fixture.writes, platform === "gitee" ? ["001.md", "README.md"] : ["atomic"]);
    const dir = check(await call(ROOT + "/contents", "GET", undefined, undefined, {
      settings_revision: "1", path: receipt.path.replace(/\/README\.md$/, ""),
    }), schemas.LightTickGitHubContentsEnvelopeSchema);
    assert.deepEqual(dir.entries, [{ name: "001.md", type: "file" }, { name: "README.md", type: "file" }]);
    const query = { settings_revision: "1", path: receipt.path, commit: receipt.commit };
    assert.equal(check(await call(ROOT + "/contents", "GET", undefined, undefined, query),
      schemas.LightTickGitHubContentsEnvelopeSchema).markdown, files.get(receipt.path));
    assert.equal((await call(ROOT + "/contents", "GET", undefined, undefined, { ...query, path: "../secret.md" })).statusCode, 422);
    assert.equal((await call(ROOT + "/contents", "GET", undefined, undefined, query, "user_bob")).statusCode, 409);
  });
}
