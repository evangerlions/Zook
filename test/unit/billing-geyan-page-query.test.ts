import assert from "node:assert/strict";
import test from "node:test";
import { parseGeyanPageResult, queryGeyanInPage, type GeyanPageResult } from "../../src/modules/billing-accounts/manual/geyan-page-query.ts";
const valid = (): GeyanPageResult => ({ authenticated: true, responses: [
  { businessCode: "ct-login", status: 200, errno: 0, remainderNum: 1430 },
  { businessCode: "ct-login-h5", status: 200, errno: 0, remainderNum: 0 },
] });
test("GeYan query keeps APP/H5 quotas separate and accepts genuine zero", () => {
  const sample = parseGeyanPageResult(valid());
  assert.deepEqual(sample.metrics.map(m => [m.kind, m.remaining, m.unit]), [["geyan_app_remaining", 1430, "次"], ["geyan_h5_remaining", 0, "次"]]);
});
test("HTTP 200 auth errors, missing and invalid quotas never become a successful balance", () => {
  assert.throws(() => parseGeyanPageResult({ authenticated: false, responses: [] }), /登录/);
  for (const change of [102, 1]) { const r = valid(); r.responses[0].errno = change; assert.equal(parseGeyanPageResult(r).status, "error"); }
  for (const value of [undefined, null, "1430", -1, Infinity, 1.5]) { const r = valid(); r.responses[0].remainderNum = value; assert.equal(parseGeyanPageResult(r).status, "error"); }
  const duplicate = valid(); duplicate.responses[1] = duplicate.responses[0]; assert.equal(parseGeyanPageResult(duplicate).status, "error");
});
test("page JS uses same-origin cookies, refreshes token, and returns no authentication data", async () => {
  const original = globalThis.fetch; const requests: { path: string; init: RequestInit }[] = [];
  globalThis.fetch = (async (path: string, init: RequestInit) => {
    requests.push({ path, init });
    if (requests.length === 1) return Response.json({ errno: 0, data: { result: 0, data: { token: "private-token" } } });
    return Response.json({ errno: 0, data: { remainderNum: requests.length === 2 ? 1430 : 0, freezeNum: 99 } }, { headers: { token: "rotated-token" } });
  }) as typeof fetch;
  try {
    const result = await queryGeyanInPage();
    assert.equal(parseGeyanPageResult(result).status, "ok");
    assert.equal(JSON.stringify(result).includes("token"), false);
    assert.equal(JSON.stringify(result).includes("freezeNum"), false);
    assert.ok(requests.every(r => r.init.credentials === "same-origin" && r.init.redirect === "error" && r.init.signal));
    assert.equal((requests[1].init.headers as any).token, "private-token");
    assert.equal((requests[2].init.headers as any).token, "rotated-token");
    assert.deepEqual(requests.slice(1).map(r => JSON.parse(r.init.body as string).businessCode), ["ct-login", "ct-login-h5"]);
  } finally { globalThis.fetch = original; }
});
test("provider 5xx is a query failure, not a signal to resubmit saved credentials", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => new Response("upstream unavailable", { status: 502 })) as typeof fetch;
  try { assert.equal(parseGeyanPageResult(await queryGeyanInPage()).status, "error"); }
  finally { globalThis.fetch = original; }
});
