import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("BodyLog association document is public and limited to invitation paths", async () => {
  const runtime = await createApplication();
  const response = await runtime.app.handle({
    method: "GET",
    path: "/.well-known/apple-app-site-association",
    headers: {},
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.contentType, "application/json");
  assert.deepEqual(response.body, {
    applinks: {
      apps: [],
      details: [{
        appID: "LTN9Y4UXN3.com.youwoai.habittap",
        paths: ["/i/*", "/invite/*", "/b/*", "/g/*", "/invite-code"],
      }],
    },
  });
});

test("legacy invitation paths remain associated", async () => {
  const runtime = await createApplication();
  const response = await runtime.app.handle({method:"GET",path:"/.well-known/apple-app-site-association",headers:{}});
  const paths = (response.body as any).applinks.details[0].paths;
  assert.ok(paths.includes("/invite/*"));
  assert.ok(paths.includes("/invite-code"));
});

test("invitation browser handoff is explicit, same-origin, and does not attribute", async () => {
  const runtime = await createApplication();
  for (const [path,query,link] of [
    ["/i/safe-token",{},"bodylog://invite/safe-token"],
    ["/invite/legacy-token",{},"bodylog://invite/legacy-token"],
    ["/b/pair_123",{},"bodylog://buddy/pair_123"],
    ["/g/group_123",{token:"group-token"},"bodylog://group/group_123?token=group-token"],
    ["/invite-code",{code:"ABC234"},"bodylog://invite-code/ABC234"],
  ] as const) {
    const response = await runtime.app.handle({method:"GET",path,query,headers:{}});
    assert.equal(response.statusCode,200);
    assert.match(response.contentType!,/text\/html/);
    let html="";for await(const chunk of response.streamBody!)html+=chunk;
    assert.ok(html.includes(link));
    assert.ok(!html.includes('http-equiv="refresh"'));
    assert.equal(response.headers?.["Referrer-Policy"],"no-referrer");
    assert.equal(response.headers?.["Cache-Control"],"no-store");
  }
});

test("malformed group and short-code handoff cannot become an injected app link", async () => {
  const runtime = await createApplication();
  for (const [path,query] of [["/g/group_123",{}],["/invite-code",{code:'"><script>'}],["/i/bad%22token",{}]] as const) {
    const response=await runtime.app.handle({method:"GET",path,query,headers:{}});
    assert.notEqual(response.statusCode,200);
  }
});
