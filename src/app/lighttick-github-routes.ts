import type { LightTickOwner } from "../modules/lighttick/lighttick.types.ts";
import type { HttpRequest } from "../shared/types.ts";
import { GitHubService } from "../modules/lighttick/github/github.service.ts";
import {
  object,
  fail,
} from "../modules/lighttick/learning/native-learning.validation.ts";
export async function handleGitHubRequest(
  runtime: { github?: GitHubService },
  o: LightTickOwner,
  r: HttpRequest,
  authorize: () => Promise<void>,
) {
  const prefix = "/api/v1/lighttick/account/github";
  if (r.path !== prefix && !r.path.startsWith(prefix + "/")) return;
  const base = runtime.github;
  if (!base) fail(503, "GitHub暂不可用。");
  const s = new GitHubService(
      base.repo,
      base.crypto,
      base.keyId,
      base.queue,
      base.connection,
      authorize,
      base.clock,
    ),
    path = r.path.slice(prefix.length),
    key = r.headers["idempotency-key"] ?? r.headers["Idempotency-Key"] ?? "";
  if (path === "" && r.method === "GET") return s.summary(o);
  if (path === "" && r.method === "PUT")
    return s.configure(o, object(r.body), key);
  const receipt = /^\/receipts\/([a-zA-Z0-9_-]{8,128})$/.exec(path);
  if (receipt && r.method === "GET") return s.receipt(o, receipt[1]);
  const testReceipt = /^\/test-receipts\/([a-zA-Z0-9_-]{8,128})$/.exec(path);
  if (testReceipt && r.method === "GET")
    return s.testReceipt(o, testReceipt[1]);
  const t = /^\/tests\/(githubtest-[a-f0-9]{40})(?:\/(cancel))?$/.exec(path);
  if (path === "/tests" && r.method === "POST")
    return s.createTest(o, object(r.body), key);
  if (t && r.method === "GET" && !t[2]) return s.readTest(o, t[1]);
  if (t?.[2] === "cancel" && r.method === "POST")
    return s.cancelTest(o, t[1], object(r.body), key);
  fail(404, "GitHub接口不存在。");
}
