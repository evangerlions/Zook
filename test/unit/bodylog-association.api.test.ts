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
        paths: ["/i/*"],
      }],
    },
  });
});
