import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAdminServer } from "../../apps/admin-web/server.ts";

async function listen(server: ReturnType<typeof createServer>): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Cannot resolve server address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}

test("admin web serves SPA routes and runtime config", async () => {
  const adminServer = createAdminServer({
    defaultAppId: "app_a",
    brandName: "Zook Test Console",
  });
  const admin = await listen(adminServer);

  try {
    const setupResponse = await fetch(`${admin.baseUrl}/setup`);
    const setupHtml = await setupResponse.text();

    assert.equal(setupResponse.status, 200);
    assert.match(setupHtml, /<div id="app"><\/div>/);
    assert.match(setupHtml, /_admin\/runtime-config\.js/);

    const runtimeResponse = await fetch(`${admin.baseUrl}/_admin/runtime-config.js`);
    const runtimeScript = await runtimeResponse.text();

    assert.equal(runtimeResponse.status, 200);
    assert.match(runtimeScript, /app_a/);
    assert.match(runtimeScript, /Zook Test Console/);
  } finally {
    await admin.close();
  }
});

test("admin web proxies API responses and preserves set-cookie", async () => {
  const upstreamServer = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.setHeader("Set-Cookie", "refreshToken=test-token; Path=/api/v1/auth; HttpOnly");
      response.end(
        JSON.stringify({
          code: "OK",
          message: "success",
          data: { status: "ok" },
          requestId: "req_upstream",
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });
  const upstream = await listen(upstreamServer);

  const adminServer = createAdminServer({
    proxyTarget: upstream.baseUrl,
  });
  const admin = await listen(adminServer);

  try {
    const response = await fetch(`${admin.baseUrl}/api/health`);
    const payload = await response.json();

    assert.equal(response.status, 200);
    assert.equal(payload.data.status, "ok");
    assert.deepEqual(response.headers.getSetCookie(), [
      "refreshToken=test-token; Path=/api/v1/auth; HttpOnly",
    ]);
  } finally {
    await admin.close();
    await upstream.close();
  }
});
