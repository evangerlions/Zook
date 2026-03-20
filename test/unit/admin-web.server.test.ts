import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import { createAdminServer } from "../../apps/admin-web/server.ts";

async function listen(server: ReturnType<typeof createServer>): Promise<{ baseUrl: string; close: () => Promise<void> }> {
  await new Promise<void>((resolve, reject) => {
    const handleError = (error: Error) => {
      server.off("listening", handleListening);
      reject(error);
    };
    const handleListening = () => {
      server.off("error", handleError);
      resolve();
    };

    server.once("error", handleError);
    server.once("listening", handleListening);
    server.listen(0);
  });
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

test("admin web serves SPA routes and runtime config", async (t) => {
  const adminServer = createAdminServer({
    defaultAppId: "app_a",
    brandName: "Zook Test Console",
  });
  let admin;

  try {
    admin = await listen(adminServer);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      t.skip("Socket listen is not permitted in the current test sandbox.");
      return;
    }
    throw error;
  }

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

test("admin web proxies API responses and preserves set-cookie", async (t) => {
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
  let upstream;

  try {
    upstream = await listen(upstreamServer);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      t.skip("Socket listen is not permitted in the current test sandbox.");
      return;
    }
    throw error;
  }

  const adminServer = createAdminServer({
    proxyTarget: upstream.baseUrl,
  });
  let admin;

  try {
    admin = await listen(adminServer);
  } catch (error) {
    await upstream.close();

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      t.skip("Socket listen is not permitted in the current test sandbox.");
      return;
    }
    throw error;
  }

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

test("admin web basic auth protects pages and proxy routes while keeping internal health public", async (t) => {
  const upstreamServer = createServer((request, response) => {
    if (request.url === "/api/health") {
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json; charset=utf-8");
      response.end(
        JSON.stringify({
          code: "OK",
          message: "success",
          data: { status: "ok" },
          requestId: "req_upstream_auth",
        }),
      );
      return;
    }

    response.statusCode = 404;
    response.end("not found");
  });
  let upstream;

  try {
    upstream = await listen(upstreamServer);
  } catch (error) {
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      t.skip("Socket listen is not permitted in the current test sandbox.");
      return;
    }
    throw error;
  }

  const adminServer = createAdminServer({
    proxyTarget: upstream.baseUrl,
    basicAuth: {
      username: "admin",
      password: "AdminPass123!",
      realm: "Zook Admin Test",
    },
  });
  let admin;

  try {
    admin = await listen(adminServer);
  } catch (error) {
    await upstream.close();

    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error.code === "EPERM" || error.code === "EACCES")
    ) {
      t.skip("Socket listen is not permitted in the current test sandbox.");
      return;
    }
    throw error;
  }

  try {
    const healthResponse = await fetch(`${admin.baseUrl}/_admin/health`);
    const healthPayload = await healthResponse.json();

    assert.equal(healthResponse.status, 200);
    assert.equal(healthPayload.data.status, "ok");

    const unauthorizedPage = await fetch(`${admin.baseUrl}/setup`, {
      redirect: "manual",
    });
    assert.equal(unauthorizedPage.status, 401);
    assert.match(unauthorizedPage.headers.get("www-authenticate") ?? "", /Basic realm="Zook Admin Test"/);

    const authorizedHeaders = {
      Authorization: `Basic ${Buffer.from("admin:AdminPass123!").toString("base64")}`,
    };

    const authorizedPage = await fetch(`${admin.baseUrl}/setup`, {
      headers: authorizedHeaders,
    });
    const authorizedHtml = await authorizedPage.text();

    assert.equal(authorizedPage.status, 200);
    assert.match(authorizedHtml, /<div id="app"><\/div>/);

    const authorizedApi = await fetch(`${admin.baseUrl}/api/health`, {
      headers: authorizedHeaders,
    });
    const authorizedPayload = await authorizedApi.json();

    assert.equal(authorizedApi.status, 200);
    assert.equal(authorizedPayload.data.status, "ok");
  } finally {
    await admin.close();
    await upstream.close();
  }
});
