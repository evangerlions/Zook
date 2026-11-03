import assert from "node:assert/strict";
import test from "node:test";
import { createApplication } from "../support/create-test-application.ts";

test("health device endpoints fail closed without durable trust storage rather than accepting device headers", async () => {
  const runtime = await createApplication({ yaoheziEnabled: true, yaoheziHealthEnabled: true });
  const login = await runtime.app.handle({ method: "POST", path: "/api/v1/auth/login", headers: {},
    body: { appId: "yaohezi", account: "alice@example.com", password: "Password1234", clientType: "app" }, ipAddress: "198.51.100.43" });
  const result = await runtime.app.handle({ method: "POST", path: "/api/v1/yaohezi/health/challenges",
    headers: { authorization: `Bearer ${login.body.data.accessToken}`, "x-device-id": "pretend-trusted" }, body: {} });
  assert.equal(result.statusCode, 503);
  assert.equal(result.body.code, "YAOHEZI_HEALTH_STORAGE_REQUIRED");
  await runtime.close();
});

test("account enablement alone never enables health trust routes",async()=>{
  const runtime=await createApplication({yaoheziEnabled:true,yaoheziHealthEnabled:false});
  const response=await runtime.app.handle({method:"POST",path:"/api/v1/yaohezi/health/challenges",headers:{},body:{}});
  assert.equal(response.statusCode,404);assert.equal(response.body.code,"YAOHEZI_DISABLED");await runtime.close();
});
